"""
AutoAttend AI v2.0 — Student Portal Routes (PROMPT 7)

GET  /api/student/portal/dashboard           student_only   master dashboard
GET  /api/student/portal/attendance-forecast  student_only   per-subject forecast
GET  /api/student/portal/my-tutor            student_only   tutor info
GET  /api/student/portal/my-timetable        student_only   weekly section timetable
POST /api/student/portal/dispute-attendance  student_only   dispute absent mark
GET  /api/student/portal/my-disputes         student_only   list own disputes
GET  /api/teacher/disputes/pending           teacher+       pending disputes for teacher
POST /api/teacher/disputes/{dispute_id}/resolve  teacher+   resolve a dispute
"""

import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from config import settings
from database import (
    AttendanceDispute,
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    DisputeStatus,
    LeaveRequest,
    LeaveRequestStatus,
    MarkedBy,
    Section,
    SessionStatus,
    Subject,
    Timetable,
    TutorAssignment,
    User,
    UserRole,
    get_db,
)
from utils.auth_utils import require_recent_auth, student_only, teacher_or_above
from utils.audit_helpers import audit_admin_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Student Portal"])


# ── helpers ──────────────────────────────────────────────────────────

_THRESHOLD = settings.ATTENDANCE_THRESHOLD  # 75.0

def _current_academic_year() -> str:
    now = datetime.now(tz=timezone.utc)
    y = now.year
    return f"{y - 1}-{str(y)[-2:]}" if now.month < 6 else f"{y}-{str(y + 1)[-2:]}"


def _attendance_status_label(pct: float) -> str:
    if pct >= _THRESHOLD:
        return "safe"
    if pct >= _THRESHOLD - 10:
        return "warning"
    if pct >= _THRESHOLD - 25:
        return "critical"
    return "detained"


def _today_day_name() -> str:
    return date.today().strftime("%A").lower()


# ═══════════════════════════════════════════════════════════════════════
# GET /api/student/portal/dashboard
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/portal/dashboard")
def student_dashboard(
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    sid = current_user["id"]
    student = db.query(User).filter(User.id == sid).first()
    if not student:
        raise HTTPException(404, "Student not found.")

    # ── Attendance summary per subject ──
    subjects = (
        db.query(Subject)
        .filter(
            Subject.course_id == student.course_id,
            Subject.semester == student.semester,
        )
        .all()
    )

    attendance_summary = []
    low_attendance_subjects = []
    for subj in subjects:
        session_ids = [
            s.id for s in db.query(AttendanceSession.id).filter(
                AttendanceSession.subject_id == subj.id,
                AttendanceSession.status == SessionStatus.ended,
            ).all()
        ]
        total_sessions = len(session_ids)
        if not session_ids:
            attendance_summary.append({
                "subject_id": subj.id,
                "subject_name": subj.name,
                "subject_code": subj.code,
                "total_sessions": 0,
                "present": 0,
                "absent": 0,
                "percentage": 0,
                "status_label": "safe",
                "can_afford_to_miss": 0,
                "sessions_needed": 0,
            })
            continue

        present = db.query(func.count(AttendanceRecord.id)).filter(
            AttendanceRecord.session_id.in_(session_ids),
            AttendanceRecord.student_id == sid,
            AttendanceRecord.status.in_([AttendanceStatus.present, AttendanceStatus.late]),
        ).scalar() or 0
        absent = total_sessions - present
        pct = round(present / total_sessions * 100, 1) if total_sessions else 0

        # Forecast
        total_lectures = subj.total_lectures if subj.total_lectures else 40
        sessions_remaining = max(0, total_lectures - total_sessions)
        needed_total = math.ceil(_THRESHOLD * total_lectures / 100)
        sessions_needed = max(0, needed_total - present)
        can_afford = max(0, sessions_remaining - sessions_needed)

        entry = {
            "subject_id": subj.id,
            "subject_name": subj.name,
            "subject_code": subj.code,
            "total_sessions": total_sessions,
            "present": present,
            "absent": absent,
            "percentage": pct,
            "status_label": _attendance_status_label(pct),
            "can_afford_to_miss": can_afford,
            "sessions_needed": sessions_needed,
        }
        attendance_summary.append(entry)
        if pct < _THRESHOLD:
            low_attendance_subjects.append(entry)

    # ── Today's timetable ──
    day_name = _today_day_name()
    today_timetable = []
    if student.section_id:
        entries = (
            db.query(Timetable, Subject)
            .outerjoin(Subject, Timetable.subject_id == Subject.id)
            .filter(
                Timetable.section_id == student.section_id,
                Timetable.day_of_week == day_name,
            )
            .order_by(Timetable.start_time)
            .all()
        )
        for tt, subj in entries:
            today_timetable.append({
                "timetable_id": tt.id,
                "subject_name": subj.name if subj else "TWM",
                "subject_code": subj.code if subj else "TWM",
                "start_time": str(tt.start_time)[:5] if tt.start_time else None,
                "end_time": str(tt.end_time)[:5] if tt.end_time else None,
                "room": tt.room,
                "is_lab": tt.is_lab,
                "is_twm": tt.is_twm,
                "color_tag": tt.color_tag,
                "period_number": tt.period_number,
            })

    # ── Recent records (last 5) ──
    recent_records = (
        db.query(AttendanceRecord, AttendanceSession, Subject)
        .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .filter(AttendanceRecord.student_id == sid)
        .order_by(AttendanceSession.date.desc(), AttendanceSession.start_time.desc())
        .limit(5)
        .all()
    )
    recent_list = [{
        "record_id": rec.id,
        "session_id": sess.id,
        "date": str(sess.date),
        "subject_name": subj.name,
        "subject_code": subj.code,
        "status": rec.status.value,
        "marked_by": rec.marked_by.value if rec.marked_by else None,
        "can_dispute": (
            rec.status == AttendanceStatus.absent
            and sess.date >= date.today() - timedelta(days=7)
        ),
    } for rec, sess, subj in recent_records]

    # ── Pending leave requests ──
    pending_leaves = db.query(func.count(LeaveRequest.id)).filter(
        LeaveRequest.student_id == sid,
        LeaveRequest.status == LeaveRequestStatus.pending,
    ).scalar() or 0

    # ── Tutor info ──
    year = _current_academic_year()
    tutor_info = None
    assignment = db.query(TutorAssignment).filter(
        TutorAssignment.student_id == sid,
        TutorAssignment.academic_year == year,
        TutorAssignment.is_active.is_(True),
    ).first()
    if assignment:
        tutor = db.query(User).filter(User.id == assignment.tutor_id).first()
        if tutor:
            tutor_info = {
                "tutor_id": tutor.id,
                "name": tutor.name,
                "email": tutor.email,
                "phone": tutor.phone,
            }

    # ── Upcoming sessions (next 3 from timetable after current time) ──
    upcoming = []
    now_time = datetime.now().time()
    for slot in today_timetable:
        if slot["start_time"] and slot["start_time"] > str(now_time)[:5]:
            upcoming.append(slot)
            if len(upcoming) >= 3:
                break

    return {
        "student_name": student.name,
        "roll_number": student.roll_number,
        "semester": student.semester,
        "attendance_summary": sorted(attendance_summary, key=lambda x: x["percentage"]),
        "low_attendance_subjects": low_attendance_subjects,
        "today_timetable": today_timetable,
        "recent_records": recent_list,
        "pending_leave_requests": pending_leaves,
        "tutor_info": tutor_info,
        "upcoming_sessions": upcoming,
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/student/portal/attendance-forecast
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/portal/attendance-forecast")
def student_forecast(
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    sid = current_user["id"]
    student = db.query(User).filter(User.id == sid).first()
    if not student:
        raise HTTPException(404, "Student not found.")

    subjects = db.query(Subject).filter(
        Subject.course_id == student.course_id,
        Subject.semester == student.semester,
    ).all()

    forecasts = []
    for subj in subjects:
        session_ids = [
            s.id for s in db.query(AttendanceSession.id).filter(
                AttendanceSession.subject_id == subj.id,
                AttendanceSession.status == SessionStatus.ended,
            ).all()
        ]
        total = len(session_ids)
        if not session_ids:
            continue

        present = db.query(func.count(AttendanceRecord.id)).filter(
            AttendanceRecord.session_id.in_(session_ids),
            AttendanceRecord.student_id == sid,
            AttendanceRecord.status.in_([AttendanceStatus.present, AttendanceStatus.late]),
        ).scalar() or 0

        pct = round(present / total * 100, 1) if total else 0
        total_lectures = subj.total_lectures if subj.total_lectures else 40
        sessions_remaining = max(0, total_lectures - total)
        needed_total = math.ceil(_THRESHOLD * total_lectures / 100)
        sessions_needed = max(0, needed_total - present)
        can_afford = max(0, sessions_remaining - sessions_needed)
        on_track = sessions_needed <= sessions_remaining

        forecasts.append({
            "subject_id": subj.id,
            "subject_name": subj.name,
            "subject_code": subj.code,
            "attended": present,
            "total_so_far": total,
            "current_pct": pct,
            "total_lectures": total_lectures,
            "sessions_remaining": sessions_remaining,
            "sessions_needed": sessions_needed,
            "can_afford_to_miss": can_afford,
            "on_track": on_track,
            "status_label": _attendance_status_label(pct),
        })

    return {
        "student_id": sid,
        "student_name": student.name,
        "forecasts": sorted(forecasts, key=lambda f: f["current_pct"]),
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/student/portal/my-tutor
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/portal/my-tutor")
def my_tutor(
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    sid = current_user["id"]
    year = _current_academic_year()
    assignment = db.query(TutorAssignment).filter(
        TutorAssignment.student_id == sid,
        TutorAssignment.academic_year == year,
        TutorAssignment.is_active.is_(True),
    ).first()
    if not assignment:
        return {"tutor": None}

    tutor = db.query(User).filter(User.id == assignment.tutor_id).first()
    if not tutor:
        return {"tutor": None}

    return {
        "tutor": {
            "tutor_id": tutor.id,
            "name": tutor.name,
            "email": tutor.email,
            "phone": tutor.phone,
        }
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/student/portal/my-timetable
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/portal/my-timetable")
def my_timetable(
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    sid = current_user["id"]
    student = db.query(User).filter(User.id == sid).first()
    if not student or not student.section_id:
        return {"timetable": []}

    entries = (
        db.query(Timetable, Subject)
        .outerjoin(Subject, Timetable.subject_id == Subject.id)
        .filter(Timetable.section_id == student.section_id)
        .order_by(Timetable.day_of_week, Timetable.start_time)
        .all()
    )

    timetable = []
    for tt, subj in entries:
        timetable.append({
            "timetable_id": tt.id,
            "day": tt.day_of_week.value if tt.day_of_week else None,
            "subject_name": subj.name if subj else "TWM",
            "subject_code": subj.code if subj else "TWM",
            "start_time": str(tt.start_time)[:5] if tt.start_time else None,
            "end_time": str(tt.end_time)[:5] if tt.end_time else None,
            "room": tt.room,
            "is_lab": tt.is_lab,
            "is_twm": tt.is_twm,
            "color_tag": tt.color_tag,
            "period_number": tt.period_number,
            "teacher_name": None,
        })
        # Fetch teacher name
        if tt.teacher_id:
            teacher = db.query(User.name).filter(User.id == tt.teacher_id).first()
            if teacher:
                timetable[-1]["teacher_name"] = teacher[0]

    return {"timetable": timetable}


# ═══════════════════════════════════════════════════════════════════════
# POST /api/student/portal/dispute-attendance
# ═══════════════════════════════════════════════════════════════════════

class DisputeRequest(BaseModel):
    session_id: int
    reason: str = Field(..., min_length=5, max_length=1000)
    proof_note: Optional[str] = Field(None, max_length=500)


@router.post("/student/portal/dispute-attendance", status_code=201)
def dispute_attendance(
    body: DisputeRequest,
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    sid = current_user["id"]

    # Verify session exists
    session = db.query(AttendanceSession).filter(
        AttendanceSession.id == body.session_id
    ).first()
    if not session:
        raise HTTPException(404, "Session not found.")

    # Must be within 7 days
    if session.date < date.today() - timedelta(days=7):
        raise HTTPException(400, "Cannot dispute attendance older than 7 days.")

    # Student must have an absent record for this session
    record = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == body.session_id,
        AttendanceRecord.student_id == sid,
        AttendanceRecord.status == AttendanceStatus.absent,
    ).first()
    if not record:
        raise HTTPException(400, "You can only dispute sessions where you are marked absent.")

    # Check no duplicate pending dispute
    existing = db.query(AttendanceDispute).filter(
        AttendanceDispute.student_id == sid,
        AttendanceDispute.session_id == body.session_id,
        AttendanceDispute.status == DisputeStatus.pending,
    ).first()
    if existing:
        raise HTTPException(400, "You already have a pending dispute for this session.")

    dispute = AttendanceDispute(
        student_id=sid,
        session_id=body.session_id,
        reason=body.reason,
        proof_note=body.proof_note,
    )
    db.add(dispute)
    db.commit()
    db.refresh(dispute)

    # Notify teacher
    try:
        from utils.notification_utils import send_push_to_many
        student = db.query(User).filter(User.id == sid).first()
        send_push_to_many(
            [session.teacher_id],
            "Attendance Dispute Filed",
            f"{student.name} disputes absent mark for {session.date}",
            db,
            data={"type": "dispute", "dispute_id": str(dispute.id)},
        )
    except Exception:
        logger.warning("Failed to send dispute notification to teacher.")

    return {
        "dispute_id": dispute.id,
        "status": dispute.status.value,
        "message": "Dispute submitted. Your teacher will be notified.",
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/student/portal/my-disputes
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/portal/my-disputes")
def my_disputes(
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    sid = current_user["id"]
    disputes = (
        db.query(AttendanceDispute, AttendanceSession, Subject)
        .join(AttendanceSession, AttendanceDispute.session_id == AttendanceSession.id)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .filter(AttendanceDispute.student_id == sid)
        .order_by(AttendanceDispute.created_at.desc())
        .all()
    )

    return [{
        "dispute_id": d.id,
        "session_id": d.session_id,
        "date": str(sess.date),
        "subject_name": subj.name,
        "subject_code": subj.code,
        "reason": d.reason,
        "proof_note": d.proof_note,
        "status": d.status.value,
        "resolution_note": d.resolution_note,
        "resolved_at": str(d.resolved_at) if d.resolved_at else None,
        "created_at": str(d.created_at) if d.created_at else None,
    } for d, sess, subj in disputes]


# ═══════════════════════════════════════════════════════════════════════
# GET /api/teacher/disputes/pending — Teacher sees pending disputes
# ═══════════════════════════════════════════════════════════════════════

@router.get("/teacher/disputes/pending")
def teacher_pending_disputes(
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    tid = current_user["id"]
    disputes = (
        db.query(AttendanceDispute, AttendanceSession, Subject, User)
        .join(AttendanceSession, AttendanceDispute.session_id == AttendanceSession.id)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .join(User, AttendanceDispute.student_id == User.id)
        .filter(
            AttendanceSession.teacher_id == tid,
            AttendanceDispute.status == DisputeStatus.pending,
        )
        .order_by(AttendanceDispute.created_at.desc())
        .all()
    )

    return [{
        "dispute_id": d.id,
        "session_id": d.session_id,
        "date": str(sess.date),
        "subject_name": subj.name,
        "subject_code": subj.code,
        "student_id": u.id,
        "student_name": u.name,
        "roll_number": u.roll_number,
        "reason": d.reason,
        "proof_note": d.proof_note,
        "created_at": str(d.created_at) if d.created_at else None,
    } for d, sess, subj, u in disputes]


# ═══════════════════════════════════════════════════════════════════════
# POST /api/teacher/disputes/{dispute_id}/resolve
# ═══════════════════════════════════════════════════════════════════════

class ResolveDisputeRequest(BaseModel):
    action: str = Field(..., pattern="^(approve|reject)$")
    note: Optional[str] = Field(None, max_length=500)


@router.post("/teacher/disputes/{dispute_id}/resolve")
def resolve_dispute(
    dispute_id: int,
    body: ResolveDisputeRequest,
    request: Request,
    current_user: dict = Depends(teacher_or_above),
    _recent: dict = Depends(require_recent_auth(15)),
    db: Session = Depends(get_db),
):
    tid = current_user["id"]

    dispute = db.query(AttendanceDispute).filter(AttendanceDispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(404, "Dispute not found.")
    if dispute.status != DisputeStatus.pending:
        raise HTTPException(400, "Dispute already resolved.")

    # Verify teacher owns the session
    session = db.query(AttendanceSession).filter(AttendanceSession.id == dispute.session_id).first()
    if not session:
        raise HTTPException(404, "Session not found.")
    if current_user["role"] == "teacher" and session.teacher_id != tid:
        raise HTTPException(403, "Not your session.")

    if body.action == "approve":
        # Update attendance record to present via manual override
        record = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == dispute.session_id,
            AttendanceRecord.student_id == dispute.student_id,
        ).first()
        if record:
            record.status = AttendanceStatus.present
            record.marked_by = MarkedBy.manual
            record.marked_at = datetime.now(tz=timezone.utc)

        # Recalculate session present_count
        new_present = (
            db.query(AttendanceRecord)
            .filter(
                AttendanceRecord.session_id == dispute.session_id,
                AttendanceRecord.status == AttendanceStatus.present,
            )
            .count()
        )
        session.present_count = new_present

        dispute.status = DisputeStatus.resolved
        dispute.resolution_note = body.note or "Approved by teacher."
    else:
        dispute.status = DisputeStatus.rejected
        dispute.resolution_note = body.note or "Rejected by teacher."

    dispute.resolved_by = tid
    dispute.resolved_at = datetime.now(tz=timezone.utc)

    db.commit()

    audit_admin_action(
        f"dispute.{body.action}",
        request=request,
        current_user=current_user,
        db=db,
        target_id=dispute.id,
        before={"status": "pending"},
        after={"status": dispute.status.value,
               "student_id": dispute.student_id,
               "session_id": dispute.session_id,
               "note": (body.note or "")[:200]},
    )

    # Notify student
    try:
        from utils.notification_utils import send_push_to_many
        action_label = "approved" if body.action == "approve" else "rejected"
        send_push_to_many(
            [dispute.student_id],
            f"Dispute {action_label.capitalize()}",
            f"Your attendance dispute for {session.date} has been {action_label}.",
            db,
            data={"type": "dispute_resolved", "dispute_id": str(dispute.id)},
        )
    except Exception:
        logger.warning("Failed to send dispute resolution notification.")

    return {
        "dispute_id": dispute.id,
        "status": dispute.status.value,
        "message": f"Dispute {body.action}d successfully.",
    }
