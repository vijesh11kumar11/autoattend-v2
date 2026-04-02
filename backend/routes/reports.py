"""
AutoAttend AI v2.0 — Reports Router

Endpoints:
  GET /api/reports/student/{student_id}/pdf
  GET /api/reports/class/{session_id}/pdf
  GET /api/reports/defaulters/pdf
  GET /api/reports/monthly/{subject_id}/excel

  GET /api/reports/hod/students          (dropdown data)
  GET /api/reports/hod/subjects          (dropdown data)
  GET /api/reports/hod/sessions          (dropdown data for class report)
  GET /api/reports/hod/defaulters        (live JSON defaulters table)
"""

import io
import logging
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from config import settings
from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    Course,
    Department,
    SessionStatus,
    Subject,
    User,
    UserRole,
    get_db,
)
from utils.auth_utils import any_authenticated, hod_or_above
from utils.pdf_generator import (
    generate_class_session_pdf,
    generate_defaulters_pdf,
    generate_monthly_excel,
    generate_student_pdf,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])

# ── scope helpers (mirrors faculty.py) ───────────────────────────────

def _course_ids_for_dept(dept_id: int, db: Session) -> list[int]:
    return [r[0] for r in db.query(Course.id).filter(Course.department_id == dept_id).all()]


def _subject_ids_for_courses(course_ids: list[int], db: Session) -> list[int]:
    if not course_ids:
        return []
    return [r[0] for r in db.query(Subject.id).filter(Subject.course_id.in_(course_ids)).all()]


def _student_ids_for_courses(course_ids: list[int], db: Session) -> list[int]:
    if not course_ids:
        return []
    return [
        r[0] for r in db.query(User.id).filter(
            User.course_id.in_(course_ids),
            User.role == UserRole.student,
            User.is_active == True,  # noqa: E712
        ).all()
    ]


def _assert_dept_owns_student(dept_id: int, student_id: int, db: Session):
    course_ids  = _course_ids_for_dept(dept_id, db)
    student_ids = _student_ids_for_courses(course_ids, db)
    if student_id not in student_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Student not in your department.")


def _assert_dept_owns_session(dept_id: int, session_id: int, db: Session):
    course_ids  = _course_ids_for_dept(dept_id, db)
    subject_ids = _subject_ids_for_courses(course_ids, db)
    sess = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not sess or sess.subject_id not in subject_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Session not in your department.")


def _assert_dept_owns_subject(dept_id: int, subject_id: int, db: Session):
    course_ids  = _course_ids_for_dept(dept_id, db)
    subject_ids = _subject_ids_for_courses(course_ids, db)
    if subject_id not in subject_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Subject not in your department.")


# ── dropdown data ─────────────────────────────────────────────────────

@router.get("/hod/students")
def list_hod_students(
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    """Return {id, name, roll_number, course_name, semester} for all students in dept."""
    dept_id    = current_user.get("department_id")
    course_ids = _course_ids_for_dept(dept_id, db)

    rows = (
        db.query(User.id, User.name, User.roll_number, User.semester, Course.name.label("course_name"))
        .join(Course, User.course_id == Course.id)
        .filter(
            User.course_id.in_(course_ids),
            User.role == UserRole.student,
            User.is_active == True,  # noqa: E712
        )
        .order_by(User.name)
        .all()
    )
    return [
        {"id": r.id, "name": r.name, "roll_number": r.roll_number,
         "semester": r.semester, "course_name": r.course_name}
        for r in rows
    ]


@router.get("/hod/subjects")
def list_hod_subjects(
    semester:     Optional[int] = Query(None),
    current_user: dict          = Depends(hod_or_above),
    db:           Session       = Depends(get_db),
):
    """Return {id, name, code, semester, course_name} for all subjects in dept."""
    dept_id    = current_user.get("department_id")
    course_ids = _course_ids_for_dept(dept_id, db)

    q = (
        db.query(Subject.id, Subject.name, Subject.code, Subject.semester, Course.name.label("course_name"))
        .join(Course, Subject.course_id == Course.id)
        .filter(Subject.course_id.in_(course_ids))
    )
    if semester is not None:
        q = q.filter(Subject.semester == semester)

    rows = q.order_by(Subject.name).all()
    return [
        {"id": r.id, "name": r.name, "code": r.code,
         "semester": r.semester, "course_name": r.course_name}
        for r in rows
    ]


@router.get("/hod/sessions")
def list_hod_sessions(
    subject_id:   Optional[int]  = Query(None),
    date_from:    Optional[date] = Query(None),
    date_to:      Optional[date] = Query(None),
    current_user: dict           = Depends(hod_or_above),
    db:           Session        = Depends(get_db),
):
    """Return ended sessions for subject dropdown in Class Session Report."""
    dept_id     = current_user.get("department_id")
    course_ids  = _course_ids_for_dept(dept_id, db)
    subject_ids = _subject_ids_for_courses(course_ids, db)

    q = (
        db.query(AttendanceSession, Subject.name.label("subject_name"), Subject.code)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .filter(
            AttendanceSession.subject_id.in_(subject_ids),
            AttendanceSession.status == SessionStatus.ended,
        )
    )
    if subject_id:
        if subject_id not in subject_ids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Subject not in your department.")
        q = q.filter(AttendanceSession.subject_id == subject_id)
    if date_from:
        q = q.filter(AttendanceSession.date >= date_from)
    if date_to:
        q = q.filter(AttendanceSession.date <= date_to)

    rows = q.order_by(AttendanceSession.date.desc()).limit(200).all()
    return [
        {
            "id":           r.AttendanceSession.id,
            "subject_name": r.subject_name,
            "subject_code": r.code,
            "date":         str(r.AttendanceSession.date),
            "present":      r.AttendanceSession.present_count,
            "total":        r.AttendanceSession.total_students,
        }
        for r in rows
    ]


@router.get("/hod/defaulters")
def list_hod_defaulters(
    subject_id:   Optional[int]   = Query(None),
    threshold:    Optional[float] = Query(None),
    att_status:   Optional[str]   = Query(None, alias="status"),
    current_user: dict            = Depends(hod_or_above),
    db:           Session         = Depends(get_db),
):
    """Live JSON defaulters list for the frontend table."""
    dept_id    = current_user.get("department_id")
    threshold  = threshold if threshold is not None else settings.ATTENDANCE_THRESHOLD
    threshold  = max(0.0, min(100.0, threshold))

    course_ids  = _course_ids_for_dept(dept_id, db)
    subject_ids = _subject_ids_for_courses(course_ids, db)
    student_ids = _student_ids_for_courses(course_ids, db)

    if not student_ids or not subject_ids:
        return []

    # Filter to specific subject if requested
    if subject_id:
        if subject_id not in subject_ids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Subject not in your department.")
        subject_ids = [subject_id]

    ended_session_ids = [
        r[0] for r in db.query(AttendanceSession.id).filter(
            AttendanceSession.subject_id.in_(subject_ids),
            AttendanceSession.status == SessionStatus.ended,
        ).all()
    ]
    if not ended_session_ids:
        return []

    # Per (student, subject) attendance
    subq = (
        db.query(
            AttendanceRecord.student_id,
            AttendanceSession.subject_id,
            func.count(AttendanceRecord.id).label("total"),
            func.sum(
                case((AttendanceRecord.status == AttendanceStatus.present, 1), else_=0)
            ).label("present"),
        )
        .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
        .filter(
            AttendanceRecord.session_id.in_(ended_session_ids),
            AttendanceRecord.student_id.in_(student_ids),
        )
        .group_by(AttendanceRecord.student_id, AttendanceSession.subject_id)
        .subquery()
    )

    rows = (
        db.query(
            subq.c.student_id,
            subq.c.subject_id,
            subq.c.total,
            subq.c.present,
            User.name.label("student_name"),
            User.roll_number,
            Subject.name.label("subject_name"),
            Subject.code.label("subject_code"),
        )
        .join(User,    User.id    == subq.c.student_id)
        .join(Subject, Subject.id == subq.c.subject_id)
        .filter(
            subq.c.total > 0,
            (subq.c.present * 100.0 / subq.c.total) < threshold,
        )
        .order_by((subq.c.present * 100.0 / subq.c.total))
        .all()
    )

    # Check if parent has been notified (any sent alert for this student)
    from database import AlertsLog, AlertStatus
    notified_ids = {
        r[0] for r in db.query(AlertsLog.student_id).filter(
            AlertsLog.student_id.in_([r.student_id for r in rows]),
            AlertsLog.status == AlertStatus.sent,
        ).all()
    }

    def _status(pct: float) -> str:
        t = settings.ATTENDANCE_THRESHOLD
        if pct >= t:            return "safe"
        if pct >= t - 10:       return "warning"
        if pct >= t - 25:       return "critical"
        return "detained"

    result = []
    for r in rows:
        pct = round(r.present * 100.0 / r.total, 1) if r.total else 0.0
        st  = _status(pct)
        if att_status and st != att_status:
            continue
        result.append({
            "student_id":       r.student_id,
            "roll_number":      r.roll_number,
            "student_name":     r.student_name,
            "subject_id":       r.subject_id,
            "subject_name":     r.subject_name,
            "subject_code":     r.subject_code,
            "percentage":       pct,
            "present":          r.present,
            "total_sessions":   r.total,
            "status":           st,
            "parent_notified":  r.student_id in notified_ids,
        })
    return result


# ═══════════════════════════════════════════════════════════════════════
# PDF / Excel download endpoints
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/{student_id}/pdf")
def download_student_pdf(
    student_id:   int,
    date_from:    Optional[date] = Query(None),
    date_to:      Optional[date] = Query(None),
    current_user: dict           = Depends(hod_or_above),
    db:           Session        = Depends(get_db),
):
    dept_id = current_user.get("department_id")
    _assert_dept_owns_student(dept_id, student_id, db)

    buf = generate_student_pdf(student_id, date_from, date_to, db)
    student = db.query(User).filter(User.id == student_id).first()
    filename = f"attendance_{(student.roll_number or student_id)}.pdf"

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/class/{session_id}/pdf")
def download_class_pdf(
    session_id:   int,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    dept_id = current_user.get("department_id")
    _assert_dept_owns_session(dept_id, session_id, db)

    buf = generate_class_session_pdf(session_id, db)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="session_{session_id}.pdf"'},
    )


@router.get("/defaulters/pdf")
def download_defaulters_pdf(
    course_id:    Optional[int]   = Query(None),
    semester:     Optional[int]   = Query(None),
    threshold:    Optional[float] = Query(None),
    current_user: dict            = Depends(hod_or_above),
    db:           Session         = Depends(get_db),
):
    dept_id   = current_user.get("department_id")
    threshold = threshold if threshold is not None else settings.ATTENDANCE_THRESHOLD
    threshold = max(0.0, min(100.0, threshold))

    # Validate course belongs to dept
    course_ids = _course_ids_for_dept(dept_id, db)
    if course_id and course_id not in course_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Course not in your department.")

    use_course_ids = [course_id] if course_id else course_ids

    buf = generate_defaulters_pdf(use_course_ids, semester, threshold, db)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="defaulters_report.pdf"'},
    )


@router.get("/monthly/{subject_id}/excel")
def download_monthly_excel(
    subject_id:   int,
    year:         int            = Query(...),
    month:        int            = Query(...),
    current_user: dict           = Depends(hod_or_above),
    db:           Session        = Depends(get_db),
):
    if not (1 <= month <= 12):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "month must be 1-12.")

    dept_id = current_user.get("department_id")
    _assert_dept_owns_subject(dept_id, subject_id, db)

    buf      = generate_monthly_excel(subject_id, year, month, db)
    subj     = db.query(Subject).filter(Subject.id == subject_id).first()
    filename = f"attendance_{(subj.code if subj else subject_id)}_{year}_{month:02d}.xlsx"

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

