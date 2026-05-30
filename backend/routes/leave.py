"""
AutoAttend AI v2.0 — Digital Leave Request routes

Student endpoints:
  POST   /api/leave/apply                  — apply for leave
  GET    /api/leave/my-requests            — own leave requests
  DELETE /api/leave/{leave_id}/cancel      — cancel pending request

Tutor / HOD endpoints:
  GET    /api/leave/pending                — pending requests for wards / dept
  GET    /api/leave/history                — leave history with filters
  POST   /api/leave/{leave_id}/approve     — approve + auto-update attendance
  POST   /api/leave/{leave_id}/reject      — reject with note
  GET    /api/leave/summary                — dashboard counts
"""

import logging
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import settings
from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    LeaveRequest,
    LeaveRequestStatus,
    LeaveType,
    TutorAssignment,
    User,
    UserRole,
    get_db,
)
from utils.auth_utils import any_authenticated, require_recent_auth, student_only, teacher_or_above
from utils.audit_helpers import audit_admin_action
from utils.notification_utils import send_push_to_many

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/leave", tags=["leave"])


# ── Pydantic schemas ────────────────────────────────────────────────

class ApplyLeaveRequest(BaseModel):
    leave_type: str
    from_date: date
    to_date: date
    reason: str = Field(..., min_length=3, max_length=2000)
    document_url: Optional[str] = None
    # S3 key returned by POST /api/uploads/leave-document (issues #45 / #116).
    # Kept optional + additive so existing clients without uploads still work.
    document_s3_key: Optional[str] = Field(None, max_length=500)


class ReviewNoteBody(BaseModel):
    note: Optional[str] = None


# ── Helpers ─────────────────────────────────────────────────────────

def _current_academic_year() -> str:
    now = datetime.now(tz=timezone.utc)
    y = now.year
    if now.month < 6:
        return f"{y - 1}-{str(y)[-2:]}"
    return f"{y}-{str(y + 1)[-2:]}"


def _find_tutor_for_student(student_id: int, db: Session) -> Optional[int]:
    """Find active tutor for student in current academic year."""
    year = _current_academic_year()
    assignment = (
        db.query(TutorAssignment)
        .filter(
            TutorAssignment.student_id == student_id,
            TutorAssignment.academic_year == year,
            TutorAssignment.is_active.is_(True),
        )
        .first()
    )
    return assignment.tutor_id if assignment else None


def _find_hod_for_student(student_id: int, db: Session) -> Optional[int]:
    """Find HOD of student's department as fallback."""
    student = db.query(User).filter(User.id == student_id).first()
    if not student or not student.department_id:
        return None
    hod = (
        db.query(User)
        .filter(
            User.department_id == student.department_id,
            User.role == UserRole.hod,
        )
        .first()
    )
    return hod.id if hod else None


def _serialize_leave(lr: LeaveRequest, db: Session) -> dict:
    student = db.query(User).filter(User.id == lr.student_id).first()
    tutor = db.query(User).filter(User.id == lr.tutor_id).first() if lr.tutor_id else None
    reviewer = db.query(User).filter(User.id == lr.reviewed_by).first() if lr.reviewed_by else None
    return {
        "id": lr.id,
        "student_id": lr.student_id,
        "student_name": student.name if student else "",
        "student_roll": student.roll_number if student else "",
        "tutor_id": lr.tutor_id,
        "tutor_name": tutor.name if tutor else "",
        "leave_type": lr.leave_type.value,
        "from_date": str(lr.from_date),
        "to_date": str(lr.to_date),
        "days": (lr.to_date - lr.from_date).days + 1,
        "reason": lr.reason,
        "document_url": lr.document_url,
        "document_s3_key": lr.document_s3_key,
        "status": lr.status.value,
        "tutor_note": lr.tutor_note,
        "reviewed_at": str(lr.reviewed_at) if lr.reviewed_at else None,
        "reviewed_by": lr.reviewed_by,
        "reviewer_name": reviewer.name if reviewer else None,
        "attendance_updated": lr.attendance_updated,
        "created_at": str(lr.created_at) if lr.created_at else None,
    }


def _leave_to_attendance_status(leave_type: LeaveType) -> Optional[AttendanceStatus]:
    """Map leave type to the attendance status to set when approved."""
    if leave_type == LeaveType.medical:
        return AttendanceStatus.medical_leave
    if leave_type in (LeaveType.duty, LeaveType.sports):
        return AttendanceStatus.duty_leave
    # personal, emergency, other — keep absent (no status change)
    return None


def _get_ward_student_ids(tutor_id: int, db: Session) -> list[int]:
    """All active ward student IDs for a tutor (current academic year)."""
    year = _current_academic_year()
    return [
        a.student_id
        for a in db.query(TutorAssignment).filter(
            TutorAssignment.tutor_id == tutor_id,
            TutorAssignment.academic_year == year,
            TutorAssignment.is_active.is_(True),
        ).all()
    ]


def _get_dept_student_ids(hod_id: int, db: Session) -> list[int]:
    """All student IDs in HOD's department."""
    hod = db.query(User).filter(User.id == hod_id).first()
    if not hod or not hod.department_id:
        return []
    return [
        u.id for u in db.query(User.id).filter(
            User.department_id == hod.department_id,
            User.role == UserRole.student,
        ).all()
    ]


# ═══════════════════════════════════════════════════════════════════════
# STUDENT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

@router.post("/apply")
def apply_leave(
    body: ApplyLeaveRequest,
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    student_id = current_user["id"]

    # Validate leave type
    try:
        leave_type = LeaveType(body.leave_type)
    except ValueError:
        raise HTTPException(400, f"Invalid leave type: {body.leave_type}")

    # Validate dates
    today = date.today()
    earliest_allowed = today - timedelta(days=settings.LEAVE_ALLOW_PAST_DATE_DAYS)

    if body.from_date > body.to_date:
        raise HTTPException(400, "from_date must be on or before to_date.")
    if body.from_date < earliest_allowed:
        raise HTTPException(
            400,
            f"Cannot apply for dates more than {settings.LEAVE_ALLOW_PAST_DATE_DAYS} days in the past.",
        )
    days_count = (body.to_date - body.from_date).days + 1
    if days_count > settings.LEAVE_MAX_DAYS_PER_REQUEST:
        raise HTTPException(
            400,
            f"Maximum {settings.LEAVE_MAX_DAYS_PER_REQUEST} days per request. You requested {days_count}.",
        )

    # Check document requirement
    doc_required_types = [
        t.strip() for t in settings.LEAVE_DOCUMENT_REQUIRED_TYPES.split(",") if t.strip()
    ]
    if leave_type.value in doc_required_types and not body.document_url:
        raise HTTPException(
            400,
            f"Document/proof is required for {leave_type.value} leave.",
        )

    # Find tutor → fallback to HOD
    tutor_id = _find_tutor_for_student(student_id, db)
    if not tutor_id:
        tutor_id = _find_hod_for_student(student_id, db)
    if not tutor_id:
        raise HTTPException(404, "No tutor or HOD found to review your request.")

    lr = LeaveRequest(
        student_id=student_id,
        tutor_id=tutor_id,
        leave_type=leave_type,
        from_date=body.from_date,
        to_date=body.to_date,
        reason=body.reason,
        document_url=body.document_url,
        document_s3_key=body.document_s3_key,
        status=LeaveRequestStatus.pending,
    )
    db.add(lr)
    db.commit()
    db.refresh(lr)

    # Push notification to tutor
    student = db.query(User).filter(User.id == student_id).first()
    student_name = student.name if student else "A student"
    send_push_to_many(
        user_ids=[tutor_id],
        title="New Leave Request",
        body=f"📋 {student_name} applied for {leave_type.value} leave from {body.from_date} to {body.to_date}.",
        db=db,
        data={"type": "leave_request", "leave_id": lr.id},
    )

    return _serialize_leave(lr, db)


@router.get("/my-requests")
def my_requests(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    q = db.query(LeaveRequest).filter(LeaveRequest.student_id == current_user["id"])
    if status_filter:
        try:
            q = q.filter(LeaveRequest.status == LeaveRequestStatus(status_filter))
        except ValueError:
            # Unknown status value in the query string — ignore the filter
            # rather than 500ing on user-supplied input. Logged for visibility.
            logger.debug("Ignoring invalid leave status filter: %r", status_filter)
    leaves = q.order_by(LeaveRequest.created_at.desc()).all()
    return [_serialize_leave(lr, db) for lr in leaves]


@router.delete("/{leave_id}/cancel")
def cancel_leave(
    leave_id: int,
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    lr = db.query(LeaveRequest).filter(
        LeaveRequest.id == leave_id,
        LeaveRequest.student_id == current_user["id"],
    ).first()
    if not lr:
        raise HTTPException(404, "Leave request not found.")
    if lr.status != LeaveRequestStatus.pending:
        raise HTTPException(400, "Only pending requests can be cancelled.")

    lr.status = LeaveRequestStatus.cancelled
    db.commit()
    return {"ok": True, "status": "cancelled"}


# ═══════════════════════════════════════════════════════════════════════
# TUTOR / HOD ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

def _get_manageable_student_ids(current_user: dict, db: Session) -> list[int]:
    """Student IDs this user can manage leave for (ward students or dept students)."""
    role = current_user["role"]
    user_id = current_user["id"]
    if role == "hod":
        ward_ids = _get_ward_student_ids(user_id, db)
        dept_ids = _get_dept_student_ids(user_id, db)
        return list(set(ward_ids + dept_ids))
    if role in ("teacher", "principal"):
        return _get_ward_student_ids(user_id, db)
    return []


@router.get("/pending")
def pending_requests(
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    # Show requests where this user is the assigned tutor/reviewer
    q = db.query(LeaveRequest).filter(
        LeaveRequest.tutor_id == current_user["id"],
        LeaveRequest.status == LeaveRequestStatus.pending,
    )
    # For HOD, also include requests from dept students without tutor
    if current_user["role"] == "hod":
        dept_ids = _get_dept_student_ids(current_user["id"], db)
        if dept_ids:
            from sqlalchemy import or_
            q = db.query(LeaveRequest).filter(
                or_(
                    LeaveRequest.tutor_id == current_user["id"],
                    LeaveRequest.student_id.in_(dept_ids),
                ),
                LeaveRequest.status == LeaveRequestStatus.pending,
            )

    leaves = q.order_by(LeaveRequest.created_at.desc()).all()
    return [_serialize_leave(lr, db) for lr in leaves]


@router.get("/history")
def leave_history(
    student_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    manageable_ids = _get_manageable_student_ids(current_user, db)
    # Also include requests assigned to this user directly
    q = db.query(LeaveRequest).filter(
        (LeaveRequest.student_id.in_(manageable_ids)) |
        (LeaveRequest.tutor_id == current_user["id"])
    )

    if student_id:
        q = q.filter(LeaveRequest.student_id == student_id)
    if status_filter:
        try:
            q = q.filter(LeaveRequest.status == LeaveRequestStatus(status_filter))
        except ValueError:
            # Unknown status value — ignore the filter instead of failing the
            # request on bad user input. Logged for visibility.
            logger.debug("Ignoring invalid leave status filter: %r", status_filter)
    if from_date:
        q = q.filter(LeaveRequest.from_date >= from_date)
    if to_date:
        q = q.filter(LeaveRequest.to_date <= to_date)

    leaves = q.order_by(LeaveRequest.created_at.desc()).all()
    return [_serialize_leave(lr, db) for lr in leaves]


@router.post("/{leave_id}/approve")
def approve_leave(
    leave_id: int,
    body: ReviewNoteBody,
    request: Request,
    current_user: dict = Depends(teacher_or_above),
    _recent: dict = Depends(require_recent_auth(15)),
    db: Session = Depends(get_db),
):
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == leave_id).first()
    if not lr:
        raise HTTPException(404, "Leave request not found.")
    if lr.status != LeaveRequestStatus.pending:
        raise HTTPException(400, "Only pending requests can be approved.")

    # Verify permission: assigned tutor, or HOD of dept
    if lr.tutor_id != current_user["id"]:
        if current_user["role"] != "hod":
            raise HTTPException(403, "You are not authorized to approve this request.")
        dept_ids = _get_dept_student_ids(current_user["id"], db)
        if lr.student_id not in dept_ids:
            raise HTTPException(403, "Student is not in your department.")

    # Update leave status
    lr.status = LeaveRequestStatus.approved
    lr.tutor_note = body.note
    lr.reviewed_at = func.now()
    lr.reviewed_by = current_user["id"]

    # Auto-update attendance records
    att_status = _leave_to_attendance_status(lr.leave_type)
    updated_count = 0

    if att_status:
        # For each date in the leave range, find attendance records and update
        current_date = lr.from_date
        while current_date <= lr.to_date:
            # Find attendance sessions on this date
            session_ids = [
                s.id for s in db.query(AttendanceSession.id).filter(
                    AttendanceSession.date == current_date
                ).all()
            ]
            if session_ids:
                updated = (
                    db.query(AttendanceRecord)
                    .filter(
                        AttendanceRecord.student_id == lr.student_id,
                        AttendanceRecord.session_id.in_(session_ids),
                        AttendanceRecord.status == AttendanceStatus.absent,
                    )
                    .update(
                        {AttendanceRecord.status: att_status},
                        synchronize_session="fetch",
                    )
                )
                updated_count += updated
            current_date += timedelta(days=1)

    lr.attendance_updated = updated_count > 0
    db.commit()

    audit_admin_action(
        "leave.approve",
        request=request,
        current_user=current_user,
        db=db,
        target_id=lr.id,
        before={"status": "pending"},
        after={"status": "approved",
               "student_id": lr.student_id,
               "from_date": str(lr.from_date),
               "to_date": str(lr.to_date),
               "attendance_updated": updated_count},
    )

    # Push notification to student
    reviewer = db.query(User).filter(User.id == current_user["id"]).first()
    reviewer_name = reviewer.name if reviewer else "Your tutor"
    send_push_to_many(
        user_ids=[lr.student_id],
        title="Leave Approved",
        body=f"✅ Your {lr.leave_type.value} leave ({lr.from_date} to {lr.to_date}) has been approved by {reviewer_name}."
             + (f" {updated_count} attendance record(s) updated." if updated_count else ""),
        db=db,
        data={"type": "leave_approved", "leave_id": lr.id},
    )

    return {
        "ok": True,
        "status": "approved",
        "attendance_records_updated": updated_count,
    }


@router.post("/{leave_id}/reject")
def reject_leave(
    leave_id: int,
    body: ReviewNoteBody,
    request: Request,
    current_user: dict = Depends(teacher_or_above),
    _recent: dict = Depends(require_recent_auth(15)),
    db: Session = Depends(get_db),
):
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == leave_id).first()
    if not lr:
        raise HTTPException(404, "Leave request not found.")
    if lr.status != LeaveRequestStatus.pending:
        raise HTTPException(400, "Only pending requests can be rejected.")

    # Verify permission
    if lr.tutor_id != current_user["id"]:
        if current_user["role"] != "hod":
            raise HTTPException(403, "You are not authorized to reject this request.")
        dept_ids = _get_dept_student_ids(current_user["id"], db)
        if lr.student_id not in dept_ids:
            raise HTTPException(403, "Student is not in your department.")

    lr.status = LeaveRequestStatus.rejected
    lr.tutor_note = body.note
    lr.reviewed_at = func.now()
    lr.reviewed_by = current_user["id"]
    db.commit()

    audit_admin_action(
        "leave.reject",
        request=request,
        current_user=current_user,
        db=db,
        target_id=lr.id,
        before={"status": "pending"},
        after={"status": "rejected",
               "student_id": lr.student_id,
               "note": (body.note or "")[:200]},
    )

    # Push notification to student
    reason_msg = f": {body.note}" if body.note else "."
    send_push_to_many(
        user_ids=[lr.student_id],
        title="Leave Rejected",
        body=f"❌ Your {lr.leave_type.value} leave ({lr.from_date} to {lr.to_date}) was rejected{reason_msg}",
        db=db,
        data={"type": "leave_rejected", "leave_id": lr.id},
    )

    return {"ok": True, "status": "rejected"}


@router.get("/summary")
def leave_summary(
    academic_year: Optional[str] = None,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    if not academic_year:
        academic_year = _current_academic_year()

    manageable_ids = _get_manageable_student_ids(current_user, db)
    if not manageable_ids:
        return {"academic_year": academic_year, "total_pending": 0, "total_approved": 0,
                "total_rejected": 0, "per_student": []}

    # Build base query for leave requests of manageable students OR assigned to this user
    base_q = db.query(LeaveRequest).filter(
        (LeaveRequest.student_id.in_(manageable_ids)) |
        (LeaveRequest.tutor_id == current_user["id"])
    )

    pending = base_q.filter(LeaveRequest.status == LeaveRequestStatus.pending).count()
    approved = base_q.filter(LeaveRequest.status == LeaveRequestStatus.approved).count()
    rejected = base_q.filter(LeaveRequest.status == LeaveRequestStatus.rejected).count()

    # Per-student leave counts
    per_student = []
    student_ids_with_leaves = set()
    for lr in base_q.all():
        student_ids_with_leaves.add(lr.student_id)

    for sid in student_ids_with_leaves:
        u = db.query(User).filter(User.id == sid).first()
        if not u:
            continue
        student_leaves = base_q.filter(LeaveRequest.student_id == sid)
        per_student.append({
            "student_id": sid,
            "name": u.name,
            "roll_number": u.roll_number,
            "pending": student_leaves.filter(LeaveRequest.status == LeaveRequestStatus.pending).count(),
            "approved": student_leaves.filter(LeaveRequest.status == LeaveRequestStatus.approved).count(),
            "rejected": student_leaves.filter(LeaveRequest.status == LeaveRequestStatus.rejected).count(),
            "total_days_approved": sum(
                (lr.to_date - lr.from_date).days + 1
                for lr in student_leaves.filter(LeaveRequest.status == LeaveRequestStatus.approved).all()
            ),
        })

    return {
        "academic_year": academic_year,
        "total_pending": pending,
        "total_approved": approved,
        "total_rejected": rejected,
        "per_student": sorted(per_student, key=lambda x: x["total_days_approved"], reverse=True),
    }


@router.get("/attendance-impact/{leave_id}")
def attendance_impact(
    leave_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """Preview how many attendance records would be updated if this leave is approved."""
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == leave_id).first()
    if not lr:
        raise HTTPException(404, "Leave request not found.")

    att_status = _leave_to_attendance_status(lr.leave_type)
    if not att_status:
        return {"leave_id": leave_id, "records_affected": 0, "note": "This leave type does not auto-update attendance."}

    count = 0
    current_date = lr.from_date
    while current_date <= lr.to_date:
        session_ids = [
            s.id for s in db.query(AttendanceSession.id).filter(
                AttendanceSession.date == current_date
            ).all()
        ]
        if session_ids:
            count += db.query(AttendanceRecord).filter(
                AttendanceRecord.student_id == lr.student_id,
                AttendanceRecord.session_id.in_(session_ids),
                AttendanceRecord.status == AttendanceStatus.absent,
            ).count()
        current_date += timedelta(days=1)

    return {"leave_id": leave_id, "records_affected": count}
