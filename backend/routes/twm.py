"""
AutoAttend AI v2.0 — TWM (Tutor Ward Meeting) routes

Endpoints:
  POST   /api/twm/start                    — start TWM session
  PUT    /api/twm/{session_id}/mark-student — mark one student
  POST   /api/twm/{session_id}/mark-bulk   — mark many students
  POST   /api/twm/{session_id}/mark-all-present — shortcut
  POST   /api/twm/{session_id}/end         — end session
  GET    /api/twm/dashboard                — core tutor view
  GET    /api/twm/session/{session_id}/report — session report
  GET    /api/twm/ward-combined-report     — aggregated attendance from all teachers
  POST   /api/twm/send-report-to-ward      — push personalised reports
  GET    /api/twm/history                  — past sessions
"""

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    Capsule,
    CapsuleInteraction,
    SessionStatus,
    Subject,
    TutorAssignment,
    TWMAttendance,
    TWMSession,
    User,
    get_db,
)
from utils.auth_utils import teacher_or_above
from utils.notification_utils import send_push_to_many

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/twm", tags=["twm"])

THRESHOLD = 75  # attendance warning threshold


# ── Pydantic schemas ────────────────────────────────────────────────


class StartTWMRequest(BaseModel):
    date: date
    notes: Optional[str] = None
    academic_year: str = Field(..., min_length=4, max_length=20)


class MarkStudentRequest(BaseModel):
    student_id: int
    status: str = "present"
    note: Optional[str] = None


class MarkBulkRequest(BaseModel):
    records: list[MarkStudentRequest]


class SendReportRequest(BaseModel):
    session_id: int
    student_ids: list[int]


# ── Helpers ─────────────────────────────────────────────────────────


def _get_ward_student_ids(tutor_id: int, academic_year: str, db: Session) -> list[int]:
    """Active ward student IDs for this tutor + academic year."""
    return [
        a.student_id
        for a in db.query(TutorAssignment)
        .filter(
            TutorAssignment.tutor_id == tutor_id,
            TutorAssignment.academic_year == academic_year,
            TutorAssignment.is_active.is_(True),
        )
        .all()
    ]


def _student_attendance_summary(student_id: int, db: Session) -> dict:
    """Per-subject + overall attendance summary for a student."""
    records = (
        db.query(
            AttendanceSession.subject_id,
            Subject.name.label("subject_name"),
            Subject.code.label("subject_code"),
            AttendanceSession.teacher_id,
            AttendanceRecord.status,
        )
        .join(AttendanceRecord, AttendanceRecord.session_id == AttendanceSession.id)
        .join(Subject, Subject.id == AttendanceSession.subject_id)
        .filter(AttendanceRecord.student_id == student_id)
        .all()
    )

    by_subject: dict[int, dict] = {}
    for r in records:
        sid = r.subject_id
        if sid not in by_subject:
            teacher = db.query(User.name).filter(User.id == r.teacher_id).scalar() or ""
            by_subject[sid] = {
                "subject_id": sid,
                "subject_name": r.subject_name,
                "subject_code": r.subject_code,
                "teacher_name": teacher,
                "present": 0,
                "total": 0,
            }
        by_subject[sid]["total"] += 1
        if r.status in (AttendanceStatus.present, AttendanceStatus.late):
            by_subject[sid]["present"] += 1

    subjects = []
    for s in by_subject.values():
        s["pct"] = round(s["present"] / s["total"] * 100, 1) if s["total"] else 0
        subjects.append(s)

    total_sessions = sum(s["total"] for s in subjects)
    total_present = sum(s["present"] for s in subjects)
    overall_pct = round(total_present / total_sessions * 100, 1) if total_sessions else 0
    needs_attention = overall_pct < THRESHOLD

    return {
        "subjects": subjects,
        "overall_pct": overall_pct,
        "needs_attention": needs_attention,
    }


def _attendance_status_label(pct: float) -> str:
    if pct >= THRESHOLD:
        return "safe"
    if pct >= 60:
        return "warning"
    if pct >= 50:
        return "critical"
    return "detained"


# ═══════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════


@router.post("/start")
def start_twm(
    body: StartTWMRequest,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    tutor_id = current_user["id"]

    # Check for existing active TWM session
    active = (
        db.query(TWMSession)
        .filter(
            TWMSession.tutor_id == tutor_id,
            TWMSession.status == SessionStatus.active,
        )
        .first()
    )
    if active:
        raise HTTPException(400, "You already have an active TWM session.")

    ward_ids = _get_ward_student_ids(tutor_id, body.academic_year, db)
    if not ward_ids:
        raise HTTPException(404, "No active ward students found for this academic year.")

    session = TWMSession(
        tutor_id=tutor_id,
        academic_year=body.academic_year,
        date=body.date,
        start_time=datetime.now().time().replace(microsecond=0),
        notes=body.notes,
        status=SessionStatus.active,
    )
    db.add(session)
    db.flush()

    # Create absent records for all ward students
    for sid in ward_ids:
        db.add(
            TWMAttendance(
                session_id=session.id,
                student_id=sid,
                status=AttendanceStatus.absent,
            )
        )
    db.commit()
    db.refresh(session)

    # Build ward student list
    students = []
    for sid in ward_ids:
        u = db.query(User).filter(User.id == sid).first()
        if u:
            students.append(
                {
                    "student_id": u.id,
                    "name": u.name,
                    "roll_number": u.roll_number,
                    "status": "absent",
                }
            )

    return {
        "session_id": session.id,
        "date": str(session.date),
        "start_time": str(session.start_time),
        "ward_students": students,
        "total": len(students),
    }


@router.put("/{session_id}/mark-student")
def mark_student(
    session_id: int,
    body: MarkStudentRequest,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = (
        db.query(TWMSession)
        .filter(
            TWMSession.id == session_id,
            TWMSession.tutor_id == current_user["id"],
        )
        .first()
    )
    if not sess:
        raise HTTPException(404, "TWM session not found.")
    if sess.status != SessionStatus.active:
        raise HTTPException(400, "Session is not active.")

    rec = (
        db.query(TWMAttendance)
        .filter(
            TWMAttendance.session_id == session_id,
            TWMAttendance.student_id == body.student_id,
        )
        .first()
    )
    if not rec:
        raise HTTPException(404, "Student not in this TWM session.")

    try:
        rec.status = AttendanceStatus(body.status)
    except ValueError:
        raise HTTPException(400, f"Invalid status: {body.status}")
    rec.marked_at = func.now()
    if body.note is not None:
        rec.note = body.note
    db.commit()

    return {"ok": True, "student_id": body.student_id, "status": body.status}


@router.post("/{session_id}/mark-bulk")
def mark_bulk(
    session_id: int,
    body: MarkBulkRequest,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = (
        db.query(TWMSession)
        .filter(
            TWMSession.id == session_id,
            TWMSession.tutor_id == current_user["id"],
        )
        .first()
    )
    if not sess:
        raise HTTPException(404, "TWM session not found.")
    if sess.status != SessionStatus.active:
        raise HTTPException(400, "Session is not active.")

    updated = 0
    for item in body.records:
        rec = (
            db.query(TWMAttendance)
            .filter(
                TWMAttendance.session_id == session_id,
                TWMAttendance.student_id == item.student_id,
            )
            .first()
        )
        if rec:
            try:
                rec.status = AttendanceStatus(item.status)
            except ValueError:
                continue
            rec.marked_at = func.now()
            if item.note is not None:
                rec.note = item.note
            updated += 1
    db.commit()
    return {"ok": True, "updated": updated, "total": len(body.records)}


@router.post("/{session_id}/mark-all-present")
def mark_all_present(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = (
        db.query(TWMSession)
        .filter(
            TWMSession.id == session_id,
            TWMSession.tutor_id == current_user["id"],
        )
        .first()
    )
    if not sess:
        raise HTTPException(404, "TWM session not found.")
    if sess.status != SessionStatus.active:
        raise HTTPException(400, "Session is not active.")

    count = (
        db.query(TWMAttendance)
        .filter(TWMAttendance.session_id == session_id)
        .update(
            {
                TWMAttendance.status: AttendanceStatus.present,
                TWMAttendance.marked_at: func.now(),
            }
        )
    )
    db.commit()
    return {"ok": True, "marked_present": count}


@router.post("/{session_id}/end")
def end_twm(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = (
        db.query(TWMSession)
        .filter(
            TWMSession.id == session_id,
            TWMSession.tutor_id == current_user["id"],
        )
        .first()
    )
    if not sess:
        raise HTTPException(404, "TWM session not found.")
    if sess.status != SessionStatus.active:
        raise HTTPException(400, "Session is already ended.")

    sess.status = SessionStatus.ended
    sess.end_time = datetime.now().time().replace(microsecond=0)
    db.commit()

    # Summary
    recs = db.query(TWMAttendance).filter(TWMAttendance.session_id == session_id).all()
    present = sum(1 for r in recs if r.status in (AttendanceStatus.present, AttendanceStatus.late))
    absent = len(recs) - present

    return {
        "session_id": session_id,
        "status": "ended",
        "present": present,
        "absent": absent,
        "total": len(recs),
    }


@router.get("/dashboard")
def twm_dashboard(
    academic_year: Optional[str] = None,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    tutor_id = current_user["id"]

    # Determine academic year — default to latest assignment year
    if not academic_year:
        latest = (
            db.query(TutorAssignment.academic_year)
            .filter(TutorAssignment.tutor_id == tutor_id, TutorAssignment.is_active.is_(True))
            .order_by(TutorAssignment.assigned_at.desc())
            .first()
        )
        academic_year = latest[0] if latest else ""

    if not academic_year:
        return {"ward_students": [], "summary": {}, "recent_twm_sessions": []}

    ward_ids = _get_ward_student_ids(tutor_id, academic_year, db)
    if not ward_ids:
        return {"ward_students": [], "summary": {}, "recent_twm_sessions": []}

    # Build ward student list with attendance info
    ward_students = []
    counts = {"safe": 0, "warning": 0, "critical": 0, "detained": 0, "needs_attention": 0}

    for sid in ward_ids:
        u = db.query(User).filter(User.id == sid).first()
        if not u:
            continue
        att = _student_attendance_summary(sid, db)

        # Last TWM attendance status
        last_twm = (
            db.query(TWMAttendance.status)
            .join(TWMSession, TWMSession.id == TWMAttendance.session_id)
            .filter(
                TWMAttendance.student_id == sid,
                TWMSession.tutor_id == tutor_id,
            )
            .order_by(TWMSession.date.desc())
            .first()
        )

        label = _attendance_status_label(att["overall_pct"])
        counts[label] += 1
        if att["needs_attention"]:
            counts["needs_attention"] += 1

        ward_students.append(
            {
                "student_id": u.id,
                "name": u.name,
                "roll_number": u.roll_number,
                "section": u.section.name if u.section_id and u.section else "",
                "overall_pct": att["overall_pct"],
                "per_subject": att["subjects"],
                "needs_attention": att["needs_attention"],
                "attendance_status": label,
                "last_twm_attendance_status": last_twm[0].value if last_twm else None,
            }
        )

    # Recent TWM sessions
    recent_sessions = (
        db.query(TWMSession)
        .filter(TWMSession.tutor_id == tutor_id)
        .order_by(TWMSession.date.desc())
        .limit(5)
        .all()
    )
    recent_list = []
    for s in recent_sessions:
        recs = db.query(TWMAttendance).filter(TWMAttendance.session_id == s.id).all()
        present = sum(
            1 for r in recs if r.status in (AttendanceStatus.present, AttendanceStatus.late)
        )
        recent_list.append(
            {
                "session_id": s.id,
                "date": str(s.date),
                "status": s.status.value,
                "present_count": present,
                "total": len(recs),
                "notes": s.notes,
            }
        )

    return {
        "academic_year": academic_year,
        "ward_students": ward_students,
        "summary": {
            "total_ward": len(ward_students),
            **counts,
        },
        "recent_twm_sessions": recent_list,
    }


@router.get("/session/{session_id}/report")
def session_report(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = (
        db.query(TWMSession)
        .filter(
            TWMSession.id == session_id,
            TWMSession.tutor_id == current_user["id"],
        )
        .first()
    )
    if not sess:
        raise HTTPException(404, "TWM session not found.")

    recs = db.query(TWMAttendance).filter(TWMAttendance.session_id == session_id).all()
    students = []
    for r in recs:
        u = db.query(User).filter(User.id == r.student_id).first()
        att = _student_attendance_summary(r.student_id, db)
        students.append(
            {
                "student_id": r.student_id,
                "name": u.name if u else "",
                "roll_number": u.roll_number if u else "",
                "twm_status": r.status.value,
                "twm_note": r.note,
                "marked_at": str(r.marked_at) if r.marked_at else None,
                "overall_pct": att["overall_pct"],
                "needs_attention": att["needs_attention"],
                "attendance_status": _attendance_status_label(att["overall_pct"]),
                "per_subject": att["subjects"],
            }
        )

    present = sum(1 for s in students if s["twm_status"] in ("present", "late"))

    # ── ClassPulse engagement (last 7 days) for ward students ────────
    classpulse = {
        "capsules_opened": 0,
        "quizzes_attempted": 0,
        "quizzes_passed": 0,
        "engagement_pct": 0.0,
        "most_failed_capsule": None,
    }
    try:
        ward_ids = [r.student_id for r in recs]
        if ward_ids:
            cutoff = datetime.now(tz=UTC) - timedelta(days=7)
            inters = (
                db.query(CapsuleInteraction)
                .filter(
                    CapsuleInteraction.student_id.in_(ward_ids),
                    CapsuleInteraction.first_opened_at.isnot(None),
                    CapsuleInteraction.first_opened_at >= cutoff,
                )
                .all()
            )
            opened = len(inters)
            attempted = sum(1 for i in inters if i.quiz_attempted)
            passed = sum(1 for i in inters if i.quiz_passed)

            # most-failed capsule (failed quizzes ↑)
            from collections import Counter

            fail_counter = Counter(
                i.capsule_id for i in inters if i.quiz_attempted and not i.quiz_passed
            )
            most_failed = None
            if fail_counter:
                cap_id, fcnt = fail_counter.most_common(1)[0]
                cap = db.query(Capsule).filter(Capsule.id == cap_id).first()
                if cap:
                    most_failed = {
                        "capsule_id": cap.id,
                        "title": cap.title,
                        "fail_count": fcnt,
                    }

            engagement_pct = round((opened / (len(ward_ids) * 5)) * 100, 1) if ward_ids else 0.0
            classpulse = {
                "capsules_opened": opened,
                "quizzes_attempted": attempted,
                "quizzes_passed": passed,
                "engagement_pct": min(engagement_pct, 100.0),
                "most_failed_capsule": most_failed,
            }
    except Exception:
        # ClassPulse engagement is a supplementary widget; if its aggregation
        # fails, fall back to the zeroed defaults rather than failing the
        # whole dashboard. Logged for visibility.
        logger.warning("Failed to compute ClassPulse engagement for TWM dashboard", exc_info=True)

    return {
        "session_id": sess.id,
        "date": str(sess.date),
        "start_time": str(sess.start_time),
        "end_time": str(sess.end_time) if sess.end_time else None,
        "status": sess.status.value,
        "notes": sess.notes,
        "present": present,
        "total": len(students),
        "students": students,
        "classpulse_engagement": classpulse,
    }


@router.get("/ward-combined-report")
def ward_combined_report(
    academic_year: str = Query(...),
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    tutor_id = current_user["id"]
    ward_ids = _get_ward_student_ids(tutor_id, academic_year, db)
    if not ward_ids:
        raise HTTPException(404, "No ward students found for this academic year.")

    result = []
    for sid in ward_ids:
        u = db.query(User).filter(User.id == sid).first()
        if not u:
            continue
        att = _student_attendance_summary(sid, db)
        result.append(
            {
                "student_id": u.id,
                "name": u.name,
                "roll_number": u.roll_number,
                "subjects": att["subjects"],
                "overall_pct": att["overall_pct"],
                "needs_attention": att["needs_attention"],
                "attendance_status": _attendance_status_label(att["overall_pct"]),
            }
        )

    return result


@router.post("/send-report-to-ward")
def send_report_to_ward(
    body: SendReportRequest,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    tutor_id = current_user["id"]

    sess = (
        db.query(TWMSession)
        .filter(
            TWMSession.id == body.session_id,
            TWMSession.tutor_id == tutor_id,
        )
        .first()
    )
    if not sess:
        raise HTTPException(404, "TWM session not found.")

    sent_count = 0
    for sid in body.student_ids:
        u = db.query(User).filter(User.id == sid).first()
        if not u:
            continue
        att = _student_attendance_summary(sid, db)

        # Build personalized message
        parts = []
        for subj in att["subjects"]:
            flag = "⚠️" if subj["pct"] < THRESHOLD else ""
            parts.append(f"{subj['subject_code']}-{subj['pct']}%{flag}")
        subject_str = ", ".join(parts) if parts else "No data"
        overall_flag = "⚠️" if att["needs_attention"] else ""
        msg = f"📊 Your attendance report from TWM: {subject_str}, Total-{att['overall_pct']}%{overall_flag}. See your tutor."

        sent = send_push_to_many(
            user_ids=[sid],
            title="TWM Attendance Report",
            body=msg,
            db=db,
            data={"type": "twm_report", "session_id": body.session_id},
        )
        sent_count += sent

    # Mark session report as sent
    sess.auto_report_sent = True
    db.commit()

    return {"ok": True, "sent": sent_count, "total_selected": len(body.student_ids)}


@router.get("/history")
def twm_history(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    tutor_id = current_user["id"]
    q = db.query(TWMSession).filter(TWMSession.tutor_id == tutor_id)
    if from_date:
        q = q.filter(TWMSession.date >= from_date)
    if to_date:
        q = q.filter(TWMSession.date <= to_date)
    sessions = q.order_by(TWMSession.date.desc()).all()

    result = []
    for s in sessions:
        recs = db.query(TWMAttendance).filter(TWMAttendance.session_id == s.id).all()
        present = sum(
            1 for r in recs if r.status in (AttendanceStatus.present, AttendanceStatus.late)
        )
        result.append(
            {
                "session_id": s.id,
                "date": str(s.date),
                "start_time": str(s.start_time),
                "end_time": str(s.end_time) if s.end_time else None,
                "status": s.status.value,
                "present": present,
                "total": len(recs),
                "notes": s.notes,
                "auto_report_sent": s.auto_report_sent,
            }
        )
    return result
