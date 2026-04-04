"""
AutoAttend AI v2.0 — Faculty / HOD / Principal Routes

GET  /api/faculty/{teacher_id}/classes           teacher+ (own classes or college)
GET  /api/principal/stats                        principal_only
GET  /api/principal/departments                  principal_only
GET  /api/principal/reports                      principal_only  (filter: dept_id, from, to)
GET  /api/principal/alerts                       principal_only
POST /api/principal/send-alert                   principal_only
GET  /api/principal/audit                        principal_only
GET  /api/hod/dashboard                          hod_or_above
GET  /api/hod/pending-approvals                  hod_or_above
POST /api/hod/approve-request/{device_id}        hod_or_above
POST /api/hod/reject-request/{device_id}         hod_or_above
"""

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from config import settings
from database import (
    AlertChannel,
    AlertStatus,
    AlertsLog,
    AttendanceAudit,
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    AuditResult,
    College,
    Course,
    Department,
    DeviceRegistry,
    FaceChangeLog,
    SessionStatus,
    Subject,
    Timetable,
    User,
    UserRole,
    get_db,
)
from utils.auth_utils import hod_or_above, principal_only, teacher_or_above
from utils.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Faculty"])

# ── helpers ──────────────────────────────────────────────────────────

def _dept_ids_for_college(college_id: int, db: Session) -> list[int]:
    return [r[0] for r in db.query(Department.id).filter(Department.college_id == college_id).all()]


def _course_ids_for_depts(dept_ids: list[int], db: Session) -> list[int]:
    if not dept_ids:
        return []
    return [r[0] for r in db.query(Course.id).filter(Course.department_id.in_(dept_ids)).all()]


def _subject_ids_for_courses(course_ids: list[int], db: Session) -> list[int]:
    if not course_ids:
        return []
    return [r[0] for r in db.query(Subject.id).filter(Subject.course_id.in_(course_ids)).all()]


def _student_ids_for_courses(course_ids: list[int], db: Session) -> list[int]:
    if not course_ids:
        return []
    return [
        r[0]
        for r in db.query(User.id).filter(
            User.course_id.in_(course_ids),
            User.role == UserRole.student,
            User.is_active == True,  # noqa: E712
        ).all()
    ]


def _attendance_pct(subject_ids: list[int], db: Session) -> float:
    """Aggregate present_count / total_students for ended sessions."""
    if not subject_ids:
        return 0.0
    totals = db.query(
        func.sum(AttendanceSession.total_students),
        func.sum(AttendanceSession.present_count),
    ).filter(
        AttendanceSession.subject_id.in_(subject_ids),
        AttendanceSession.status == SessionStatus.ended,
    ).one()
    total_slots, total_present = totals
    if not total_slots:
        return 0.0
    return round(float(total_present) / float(total_slots) * 100, 1)


def _defaulter_count(student_ids: list[int], subject_ids: list[int], db: Session) -> int:
    """Count students whose overall attendance across subject_ids is < ATTENDANCE_THRESHOLD."""
    if not student_ids or not subject_ids:
        return 0

    ended_session_ids = [
        r[0] for r in db.query(AttendanceSession.id)
        .filter(
            AttendanceSession.subject_id.in_(subject_ids),
            AttendanceSession.status == SessionStatus.ended,
        ).all()
    ]
    if not ended_session_ids:
        return 0

    # Per-student present count and total count across those sessions
    subq = (
        db.query(
            AttendanceRecord.student_id,
            func.count(AttendanceRecord.id).label("total"),
            func.sum(
                case((AttendanceRecord.status == AttendanceStatus.present, 1), else_=0)
            ).label("present"),
        )
        .filter(
            AttendanceRecord.session_id.in_(ended_session_ids),
            AttendanceRecord.student_id.in_(student_ids),
        )
        .group_by(AttendanceRecord.student_id)
        .subquery()
    )

    defaulters = (
        db.query(func.count())
        .select_from(subq)
        .filter(
            subq.c.total > 0,
            (subq.c.present * 100.0 / subq.c.total) < settings.ATTENDANCE_THRESHOLD,
        )
        .scalar()
    ) or 0
    return defaulters


def _attendance_trend(subject_ids: list[int], days: int, db: Session) -> list[dict]:
    """Return last `days` daily attendance percentages."""
    if not subject_ids:
        return []
    today  = date.today()
    result = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        day_total = (
            db.query(func.sum(AttendanceSession.total_students))
            .filter(
                AttendanceSession.subject_id.in_(subject_ids),
                AttendanceSession.date == d,
                AttendanceSession.status == SessionStatus.ended,
            )
            .scalar()
        ) or 0
        day_present = (
            db.query(func.sum(AttendanceSession.present_count))
            .filter(
                AttendanceSession.subject_id.in_(subject_ids),
                AttendanceSession.date == d,
                AttendanceSession.status == SessionStatus.ended,
            )
            .scalar()
        ) or 0
        if day_total:
            result.append({
                "date": d.isoformat(),
                "pct":  round(float(day_present) / float(day_total) * 100, 1),
            })
    return result


# ═══════════════════════════════════════════════════════════════════════
# GET /api/faculty/{teacher_id}/classes
# ═══════════════════════════════════════════════════════════════════════

@router.get("/faculty/{teacher_id}/classes")
def get_teacher_classes(
    teacher_id:   int,
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """Return subjects assigned to a teacher. Teachers can only view their own."""
    logger.info("👨‍🏫 TEACHER CLASSES │ teacher_id=%d │ requested by user_id=%d (role=%s)",
                teacher_id, current_user["id"], current_user["role"])
    if current_user["role"] == "teacher" and current_user["id"] != teacher_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only view your own classes.")

    teacher = db.query(User).filter(User.id == teacher_id, User.is_active == True).first()  # noqa: E712
    if not teacher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Teacher not found.")

    if current_user["role"] in {"hod", "principal"}:
        if teacher.college_id != current_user["college_id"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Teacher not in your college.")

    subjects = db.query(Subject).filter(Subject.teacher_id == teacher_id).all()
    return [
        {
            "id":        s.id,
            "name":      s.name,
            "code":      s.code,
            "semester":  s.semester,
            "course_id": s.course_id,
        }
        for s in subjects
    ]


# ═══════════════════════════════════════════════════════════════════════
# GET /api/faculty/my-sessions — teacher's past attendance sessions
# ═══════════════════════════════════════════════════════════════════════

@router.get("/faculty/my-sessions")
def get_my_sessions(
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """Return all attendance sessions conducted by the logged-in teacher."""
    logger.info("👨‍🏫 TEACHER SESSIONS │ user_id=%d", current_user["id"])
    sessions = (
        db.query(AttendanceSession, Subject.name, Subject.code)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .filter(AttendanceSession.teacher_id == current_user["id"])
        .order_by(AttendanceSession.date.desc(), AttendanceSession.start_time.desc())
        .all()
    )
    return [
        {
            "id":            s.id,
            "subject_name":  sname,
            "subject_code":  scode,
            "date":          s.date.isoformat(),
            "start_time":    s.start_time.isoformat() if s.start_time else None,
            "status":        s.status.value if s.status else "ended",
            "total_students": s.total_students or 0,
            "present_count": s.present_count or 0,
        }
        for s, sname, scode in sessions
    ]


# ═══════════════════════════════════════════════════════════════════════
# GET /api/faculty/my-dashboard — teacher dashboard summary
# ═══════════════════════════════════════════════════════════════════════

@router.get("/faculty/my-dashboard")
def get_my_dashboard(
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """Return dashboard stats for the logged-in teacher."""
    tid = current_user["id"]
    logger.info("👨‍🏫 TEACHER DASHBOARD │ user_id=%d", tid)
    teacher = db.query(User).filter(User.id == tid).first()

    # Subjects assigned
    subjects = db.query(Subject).filter(Subject.teacher_id == tid).all()
    subject_ids = [s.id for s in subjects]

    # Session counts
    total_sessions = db.query(func.count(AttendanceSession.id)).filter(
        AttendanceSession.teacher_id == tid,
    ).scalar() or 0

    active_sessions = db.query(func.count(AttendanceSession.id)).filter(
        AttendanceSession.teacher_id == tid,
        AttendanceSession.status == SessionStatus.active,
    ).scalar() or 0

    # Today's sessions
    today = date.today()
    todays_sessions = (
        db.query(AttendanceSession, Subject.name, Subject.code)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .filter(
            AttendanceSession.teacher_id == tid,
            AttendanceSession.date == today,
        )
        .order_by(AttendanceSession.start_time)
        .all()
    )

    # Overall avg attendance for this teacher's sessions
    agg = db.query(
        func.sum(AttendanceSession.total_students),
        func.sum(AttendanceSession.present_count),
    ).filter(
        AttendanceSession.teacher_id == tid,
        AttendanceSession.status == SessionStatus.ended,
    ).one()
    total_slots, total_present = agg
    avg_pct = round(float(total_present) / float(total_slots) * 100, 1) if total_slots else 0.0

    # Today's timetable
    day_name = today.strftime("%A").lower()
    timetable_today = (
        db.query(Timetable, Subject.name, Subject.code)
        .join(Subject, Timetable.subject_id == Subject.id)
        .filter(Timetable.teacher_id == tid, Timetable.day_of_week == day_name)
        .order_by(Timetable.start_time)
        .all()
    )

    return {
        "teacher_name":    teacher.name if teacher else "Teacher",
        "total_subjects":  len(subjects),
        "total_sessions":  total_sessions,
        "active_sessions": active_sessions,
        "avg_attendance":  avg_pct,
        "subjects": [
            {"id": s.id, "name": s.name, "code": s.code, "semester": s.semester}
            for s in subjects
        ],
        "todays_sessions": [
            {
                "id":            s.id,
                "subject_name":  sname,
                "subject_code":  scode,
                "date":          s.date.isoformat(),
                "start_time":    s.start_time.isoformat() if s.start_time else None,
                "status":        s.status.value if s.status else "ended",
                "total_students": s.total_students or 0,
                "present_count": s.present_count or 0,
            }
            for s, sname, scode in todays_sessions
        ],
        "timetable_today": [
            {
                "subject_name": sname,
                "subject_code": scode,
                "start_time":   t.start_time,
                "end_time":     t.end_time,
                "room":         t.room or "—",
            }
            for t, sname, scode in timetable_today
        ],
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/faculty/my-timetable — full weekly timetable
# ═══════════════════════════════════════════════════════════════════════

@router.get("/faculty/my-timetable")
def get_my_timetable(
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """Return the full weekly timetable for the logged-in teacher."""
    tid = current_user["id"]
    entries = (
        db.query(Timetable, Subject.name, Subject.code)
        .join(Subject, Timetable.subject_id == Subject.id)
        .filter(Timetable.teacher_id == tid)
        .order_by(Timetable.start_time)
        .all()
    )

    # Group by day
    days_order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    by_day = {d: [] for d in days_order}
    for t, sname, scode in entries:
        day_key = t.day_of_week.value if hasattr(t.day_of_week, 'value') else t.day_of_week
        if day_key in by_day:
            by_day[day_key].append({
                "subject_name": sname,
                "subject_code": scode,
                "start_time":   t.start_time,
                "end_time":     t.end_time,
                "room":         t.room or "—",
            })

    return {
        "timetable": [
            {"day": d.capitalize(), "slots": by_day[d]}
            for d in days_order
            if by_day[d]
        ]
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/hod/timetable — department-wide timetable
# ═══════════════════════════════════════════════════════════════════════

@router.get("/hod/timetable")
def get_hod_timetable(
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    """Return the full weekly timetable for all subjects in the HOD's department."""
    dept_id = current_user.get("department_id")
    course_ids = [r[0] for r in db.query(Course.id).filter(Course.department_id == dept_id).all()]
    if not course_ids:
        return {"timetable": []}

    subject_ids = [r[0] for r in db.query(Subject.id).filter(Subject.course_id.in_(course_ids)).all()]
    if not subject_ids:
        return {"timetable": []}

    entries = (
        db.query(Timetable, Subject.name, Subject.code, User.name.label("teacher_name"))
        .join(Subject, Timetable.subject_id == Subject.id)
        .join(User, Timetable.teacher_id == User.id)
        .filter(Timetable.subject_id.in_(subject_ids))
        .order_by(Timetable.start_time)
        .all()
    )

    days_order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    by_day = {d: [] for d in days_order}
    for t, sname, scode, tname in entries:
        day_key = t.day_of_week.value if hasattr(t.day_of_week, 'value') else t.day_of_week
        if day_key in by_day:
            by_day[day_key].append({
                "subject_name": sname,
                "subject_code": scode,
                "teacher_name": tname,
                "start_time":   t.start_time,
                "end_time":     t.end_time,
                "room":         t.room or "—",
            })

    return {
        "timetable": [
            {"day": d.capitalize(), "slots": by_day[d]}
            for d in days_order
            if by_day[d]
        ]
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/principal/stats
# ═══════════════════════════════════════════════════════════════════════

@router.get("/principal/stats")
def get_principal_stats(
    current_user: dict    = Depends(principal_only),
    db:           Session = Depends(get_db),
):
    college_id = current_user["college_id"]
    logger.info("🏥 PRINCIPAL STATS │ user_id=%d │ college_id=%d", current_user["id"], college_id)

    dept_ids    = _dept_ids_for_college(college_id, db)
    course_ids  = _course_ids_for_depts(dept_ids, db)
    subject_ids = _subject_ids_for_courses(course_ids, db)
    student_ids = _student_ids_for_courses(course_ids, db)

    def count_role(role):
        return db.query(func.count(User.id)).filter(
            User.college_id == college_id,
            User.role       == role,
            User.is_active  == True,  # noqa: E712
        ).scalar() or 0

    total_departments = len(dept_ids)
    total_teachers    = count_role(UserRole.teacher)
    total_students    = count_role(UserRole.student)
    total_hods        = count_role(UserRole.hod)
    overall_pct       = _attendance_pct(subject_ids, db)
    critical_defaulters = _defaulter_count(student_ids, subject_ids, db)

    # Department cards
    departments = []
    for dept_id in dept_ids:
        dept         = db.query(Department).filter(Department.id == dept_id).first()
        hod_obj      = db.query(User).filter(
            User.department_id == dept_id,
            User.role          == UserRole.hod,
            User.is_active     == True,  # noqa: E712
        ).first()
        dept_courses  = [r[0] for r in db.query(Course.id).filter(Course.department_id == dept_id).all()]
        dept_subjects = _subject_ids_for_courses(dept_courses, db)
        dept_students = _student_ids_for_courses(dept_courses, db)
        dept_pct      = _attendance_pct(dept_subjects, db)
        dept_defaulters = _defaulter_count(dept_students, dept_subjects, db)
        t_count       = db.query(func.count(User.id)).filter(
            User.department_id == dept_id,
            User.role          == UserRole.teacher,
            User.is_active     == True,  # noqa: E712
        ).scalar() or 0

        departments.append({
            "id":              dept_id,
            "name":            dept.name,
            "code":            dept.code,
            "hod_name":        hod_obj.name if hod_obj else None,
            "teacher_count":   t_count,
            "student_count":   len(dept_students),
            "avg_attendance_pct": dept_pct,
            "defaulter_count": dept_defaulters,
        })

    trend       = _attendance_trend(subject_ids, 30, db)

    # Distribution: safe ≥ threshold, at_risk 60–threshold, detained < 60
    dist = {"safe": 0, "at_risk": 0, "detained": 0}
    if student_ids and subject_ids:
        ended_session_ids = [
            r[0] for r in db.query(AttendanceSession.id)
            .filter(
                AttendanceSession.subject_id.in_(subject_ids),
                AttendanceSession.status == SessionStatus.ended,
            ).all()
        ]
        if ended_session_ids:
            subq = (
                db.query(
                    AttendanceRecord.student_id,
                    (
                        func.sum(case((AttendanceRecord.status == AttendanceStatus.present, 1), else_=0))
                        * 100.0 / func.count(AttendanceRecord.id)
                    ).label("pct"),
                )
                .filter(
                    AttendanceRecord.session_id.in_(ended_session_ids),
                    AttendanceRecord.student_id.in_(student_ids),
                )
                .group_by(AttendanceRecord.student_id)
                .all()
            )
            for _, pct in subq:
                pct = float(pct or 0)
                if pct >= settings.ATTENDANCE_THRESHOLD:
                    dist["safe"] += 1
                elif pct >= 60.0:
                    dist["at_risk"] += 1
                else:
                    dist["detained"] += 1

    # Last 5 alerts
    recent_alerts = (
        db.query(AlertsLog)
        .order_by(AlertsLog.sent_at.desc())
        .limit(5)
        .all()
    )
    alert_rows = []
    for a in recent_alerts:
        stu = db.query(User.name).filter(User.id == a.student_id).scalar()
        alert_rows.append({
            "id":          a.id,
            "student_name": stu or "Unknown",
            "message":     a.message[:80],
            "channel":     a.channel.value,
            "status":      a.status.value,
            "sent_at":     a.sent_at.isoformat(),
        })

    return {
        "total_departments":    total_departments,
        "total_teachers":       total_teachers,
        "total_students":       total_students,
        "total_hods":           total_hods,
        "overall_attendance_pct": overall_pct,
        "critical_defaulters":  critical_defaulters,
        "departments":          departments,
        "attendance_trend":     trend,
        "distribution":         dist,
        "recent_alerts":        alert_rows,
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/principal/reports
# ═══════════════════════════════════════════════════════════════════════

@router.get("/principal/reports")
def get_principal_reports(
    dept_id:      Optional[int]  = Query(None),
    date_from:    Optional[date] = Query(None),
    date_to:      Optional[date] = Query(None),
    current_user: dict           = Depends(principal_only),
    db:           Session        = Depends(get_db),
):
    college_id = current_user["college_id"]
    dept_ids   = _dept_ids_for_college(college_id, db)
    if dept_id:
        if dept_id not in dept_ids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Department not in your college.")
        dept_ids = [dept_id]

    date_from = date_from or (date.today() - timedelta(days=30))
    date_to   = date_to   or date.today()

    rows = []
    for did in dept_ids:
        dept        = db.query(Department).filter(Department.id == did).first()
        dept_courses  = _course_ids_for_depts([did], db)
        dept_subjects = _subject_ids_for_courses(dept_courses, db)
        dept_students = _student_ids_for_courses(dept_courses, db)

        if not dept_subjects:
            continue

        totals = db.query(
            func.sum(AttendanceSession.total_students),
            func.sum(AttendanceSession.present_count),
            func.count(AttendanceSession.id),
        ).filter(
            AttendanceSession.subject_id.in_(dept_subjects),
            AttendanceSession.date >= date_from,
            AttendanceSession.date <= date_to,
            AttendanceSession.status == SessionStatus.ended,
        ).one()

        total_slots, total_present, session_count = totals
        pct = round(float(total_present or 0) / float(total_slots) * 100, 1) if total_slots else 0.0

        # Flagged / suspicious count
        flagged = (
            db.query(func.count(AttendanceAudit.id))
            .join(AttendanceSession)
            .filter(
                AttendanceSession.subject_id.in_(dept_subjects),
                AttendanceAudit.attempt_at >= datetime.combine(date_from, datetime.min.time()),
                AttendanceAudit.attempt_at <= datetime.combine(date_to,   datetime.max.time()),
            )
            .scalar()
        ) or 0

        defaulters = _defaulter_count(dept_students, dept_subjects, db)

        rows.append({
            "dept_id":       did,
            "dept_name":     dept.name,
            "dept_code":     dept.code,
            "sessions":      session_count or 0,
            "avg_pct":       pct,
            "flagged_count": flagged,
            "defaulter_count": defaulters,
        })

    return {
        "date_from": date_from.isoformat(),
        "date_to":   date_to.isoformat(),
        "departments": rows,
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/principal/alerts
# ═══════════════════════════════════════════════════════════════════════

@router.get("/principal/alerts")
def get_principal_alerts(
    current_user: dict    = Depends(principal_only),
    db:           Session = Depends(get_db),
):
    college_id = current_user["college_id"]

    # All students in this college
    dept_ids    = _dept_ids_for_college(college_id, db)
    course_ids  = _course_ids_for_depts(dept_ids, db)
    subject_ids = _subject_ids_for_courses(course_ids, db)
    student_ids = _student_ids_for_courses(course_ids, db)

    # Build defaulters list
    ended_session_ids = [
        r[0] for r in db.query(AttendanceSession.id)
        .filter(
            AttendanceSession.subject_id.in_(subject_ids),
            AttendanceSession.status == SessionStatus.ended,
        ).all()
    ]

    defaulters = []
    if ended_session_ids and student_ids:
        stats = (
            db.query(
                AttendanceRecord.student_id,
                func.count(AttendanceRecord.id).label("total"),
                func.sum(
                    case((AttendanceRecord.status == AttendanceStatus.present, 1), else_=0)
                ).label("present"),
            )
            .filter(
                AttendanceRecord.session_id.in_(ended_session_ids),
                AttendanceRecord.student_id.in_(student_ids),
            )
            .group_by(AttendanceRecord.student_id)
            .all()
        )
        for student_id, total, present in stats:
            total = total or 0
            present = present or 0
            if total == 0:
                continue
            pct = round(present / total * 100, 1)
            if pct < settings.ATTENDANCE_THRESHOLD:
                stu = db.query(User).filter(User.id == student_id).first()
                defaulters.append({
                    "student_id":   student_id,
                    "name":         stu.name if stu else "Unknown",
                    "roll_number":  stu.roll_number if stu else None,
                    "parent_phone": stu.parent_phone if stu else None,
                    "pct":          pct,
                    "total":        total,
                    "present":      present,
                })

    defaulters.sort(key=lambda x: x["pct"])

    # Alert history
    alert_history = (
        db.query(AlertsLog)
        .filter(AlertsLog.student_id.in_(student_ids))
        .order_by(AlertsLog.sent_at.desc())
        .limit(50)
        .all()
    )
    history_rows = []
    for a in alert_history:
        stu = db.query(User.name).filter(User.id == a.student_id).scalar()
        history_rows.append({
            "id":           a.id,
            "student_name": stu or "Unknown",
            "message":      a.message,
            "channel":      a.channel.value,
            "status":       a.status.value,
            "sent_at":      a.sent_at.isoformat(),
        })

    return {
        "defaulters":     defaulters,
        "alert_history":  history_rows,
    }


# ═══════════════════════════════════════════════════════════════════════
# POST /api/principal/send-alert
# ═══════════════════════════════════════════════════════════════════════

@router.post("/principal/send-alert")
def send_parent_alert(
    body:         dict,
    current_user: dict    = Depends(principal_only),
    db:           Session = Depends(get_db),
):
    """
    Send WhatsApp alerts to parents of selected students.

    Body: { "student_ids": [1,2,3], "message": "..." }

    Requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.
    """
    student_ids: list[int] = body.get("student_ids", [])
    message: str = body.get("message", "").strip()

    if not student_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No student IDs provided.")
    if not message:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message cannot be empty.")
    if len(message) > 1600:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message too long (max 1600 chars).")

    college_id  = current_user["college_id"]
    dept_ids    = _dept_ids_for_college(college_id, db)
    course_ids  = _course_ids_for_depts(dept_ids, db)
    valid_ids   = set(_student_ids_for_courses(course_ids, db))

    results = []
    for sid in student_ids:
        if sid not in valid_ids:
            results.append({"student_id": sid, "status": "skipped", "reason": "Not in your college"})
            continue

        stu = db.query(User).filter(User.id == sid).first()
        if not stu or not stu.parent_phone:
            log = AlertsLog(
                student_id = sid,
                alert_type = "low_attendance",
                message    = message,
                status     = AlertStatus.failed,
                channel    = AlertChannel.whatsapp,
            )
            db.add(log)
            results.append({"student_id": sid, "status": "failed", "reason": "No parent phone"})
            continue

        # Try Twilio
        whatsapp_status = send_whatsapp_message(stu.parent_phone, message)

        log = AlertsLog(
            student_id = sid,
            alert_type = "low_attendance",
            message    = message,
            status     = AlertStatus.sent if whatsapp_status["ok"] else AlertStatus.failed,
            channel    = AlertChannel.whatsapp,
            external_id = whatsapp_status.get("sid"),
        )
        db.add(log)
        results.append({
            "student_id":   sid,
            "student_name": stu.name,
            "status":       "sent" if whatsapp_status["ok"] else "failed",
            "reason":       whatsapp_status.get("error"),
        })

    db.commit()
    sent  = sum(1 for r in results if r["status"] == "sent")
    failed = sum(1 for r in results if r["status"] == "failed")
    return {"sent": sent, "failed": failed, "results": results}


# ═══════════════════════════════════════════════════════════════════════
# GET /api/principal/audit
# ═══════════════════════════════════════════════════════════════════════

@router.get("/principal/audit")
def get_principal_audit(
    dept_id:    Optional[int]  = Query(None),
    date_from:  Optional[date] = Query(None),
    date_to:    Optional[date] = Query(None),
    current_user: dict         = Depends(principal_only),
    db:           Session      = Depends(get_db),
):
    college_id = current_user["college_id"]
    dept_ids   = _dept_ids_for_college(college_id, db)
    if dept_id:
        if dept_id not in dept_ids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Department not in your college.")
        dept_ids = [dept_id]

    date_from = date_from or (date.today() - timedelta(days=30))
    date_to   = date_to   or date.today()

    dt_from = datetime.combine(date_from, datetime.min.time()).replace(tzinfo=timezone.utc)
    dt_to   = datetime.combine(date_to,   datetime.max.time()).replace(tzinfo=timezone.utc)

    course_ids  = _course_ids_for_depts(dept_ids, db)
    student_ids = _student_ids_for_courses(course_ids, db)

    # ── Face change log ───────────────────────────────────────────────
    face_logs = (
        db.query(FaceChangeLog)
        .filter(
            FaceChangeLog.student_id.in_(student_ids),
            FaceChangeLog.changed_at >= dt_from,
            FaceChangeLog.changed_at <= dt_to,
        )
        .order_by(FaceChangeLog.changed_at.desc())
        .limit(50)
        .all()
    )
    face_rows = []
    for f in face_logs:
        stu     = db.query(User.name).filter(User.id == f.student_id).scalar()
        changer = db.query(User.name).filter(User.id == f.changed_by).scalar()
        face_rows.append({
            "id":             f.id,
            "student_name":   stu or "Unknown",
            "changed_by":     changer or "Unknown",
            "old_person_id":  f.old_azure_person_id,
            "new_person_id":  f.new_azure_person_id,
            "reason":         f.reason,
            "changed_at":     f.changed_at.isoformat(),
        })

    # ── Failed attendance audits ──────────────────────────────────────
    audit_logs = (
        db.query(AttendanceAudit)
        .filter(
            AttendanceAudit.student_id.in_(student_ids),
            AttendanceAudit.result    == AuditResult.failed,
            AttendanceAudit.attempt_at >= dt_from,
            AttendanceAudit.attempt_at <= dt_to,
        )
        .order_by(AttendanceAudit.attempt_at.desc())
        .limit(100)
        .all()
    )
    audit_rows = []
    for a in audit_logs:
        stu = db.query(User.name).filter(User.id == a.student_id).scalar()
        audit_rows.append({
            "id":             a.id,
            "student_name":   stu or "Unknown",
            "failure_reason": a.failure_reason,
            "face_confidence": a.face_confidence,
            "gps_distance":   a.gps_distance_meters,
            "device_id":      a.device_id,
            "ip":             a.ip_address,
            "attempt_at":     a.attempt_at.isoformat(),
        })

    # ── TOTP lock audit: users with totp_fail_count > 0 ──────────────
    totp_flagged = (
        db.query(User)
        .filter(
            User.college_id    == college_id,
            User.totp_fail_count > 0,
        )
        .order_by(User.totp_fail_count.desc())
        .limit(20)
        .all()
    )
    totp_rows = [
        {
            "user_id":        u.id,
            "name":           u.name,
            "role":           u.role.value,
            "fail_count":     u.totp_fail_count,
            "locked_until":   u.totp_locked_until.isoformat() if u.totp_locked_until else None,
        }
        for u in totp_flagged
    ]

    return {
        "face_change_log":     face_rows,
        "failed_audit_log":    audit_rows,
        "totp_flagged_users":  totp_rows,
        "date_from":           date_from.isoformat(),
        "date_to":             date_to.isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/hod/dashboard
# ═══════════════════════════════════════════════════════════════════════

@router.get("/hod/dashboard")
def get_hod_dashboard(
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    dept_id = current_user.get("department_id")
    logger.info("🏢 HOD DASHBOARD │ user_id=%d │ dept_id=%s", current_user["id"], dept_id)
    if not dept_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "HOD not assigned to a department.")

    dept = db.query(Department).filter(Department.id == dept_id).first()
    if not dept:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found.")

    hod = db.query(User).filter(User.id == current_user["id"]).first()

    course_ids  = _course_ids_for_depts([dept_id], db)
    subject_ids = _subject_ids_for_courses(course_ids, db)
    student_ids = _student_ids_for_courses(course_ids, db)

    teacher_count   = db.query(func.count(User.id)).filter(
        User.department_id == dept_id,
        User.role          == UserRole.teacher,
        User.is_active     == True,  # noqa: E712
    ).scalar() or 0

    student_count = len(student_ids)
    avg_pct       = _attendance_pct(subject_ids, db)

    # Pending approvals: device registrations without HOD approval
    pending_count = db.query(func.count(DeviceRegistry.id)).filter(
        DeviceRegistry.user_id.in_(student_ids),
        DeviceRegistry.approved_by == None,  # noqa: E711
        DeviceRegistry.is_active   == True,   # noqa: E712
    ).scalar() or 0

    # ── Teacher list with today's session status ──────────────────────
    teachers = db.query(User).filter(
        User.department_id == dept_id,
        User.role          == UserRole.teacher,
        User.is_active     == True,  # noqa: E712
    ).all()

    today = date.today()
    today_sessions = {
        s.teacher_id: s
        for s in db.query(AttendanceSession).filter(
            AttendanceSession.teacher_id.in_([t.id for t in teachers]),
            AttendanceSession.date == today,
        ).all()
    }

    teacher_rows = []
    for t in teachers:
        subj_names = [
            s.name
            for s in db.query(Subject.name).filter(Subject.teacher_id == t.id).all()
        ]
        sess = today_sessions.get(t.id)
        teacher_rows.append({
            "id":            t.id,
            "name":          t.name,
            "email":         t.email,
            "subject_names": [n[0] for n in subj_names],
            "today_session": {
                "id":            sess.id,
                "status":        sess.status.value,
                "present_count": sess.present_count,
                "total_students": sess.total_students,
            } if sess else None,
        })

    # ── Subject attendance stats ──────────────────────────────────────
    subjects = db.query(Subject).filter(Subject.course_id.in_(course_ids)).all()
    subject_rows = []
    for subj in subjects:
        sessions = db.query(AttendanceSession).filter(
            AttendanceSession.subject_id == subj.id,
            AttendanceSession.status     == SessionStatus.ended,
        ).all()
        if not sessions:
            continue
        total_s  = sum(s.total_students for s in sessions)
        total_p  = sum(s.present_count  for s in sessions)
        pct      = round(total_p / total_s * 100, 1) if total_s else 0.0
        t_name   = db.query(User.name).filter(User.id == subj.teacher_id).scalar() if subj.teacher_id else None
        subject_rows.append({
            "id":            subj.id,
            "name":          subj.name,
            "code":          subj.code,
            "semester":      subj.semester,
            "teacher_name":  t_name,
            "sessions_done": len(sessions),
            "avg_pct":       pct,
        })

    return {
        "department_name":     dept.name,
        "department_code":     dept.code,
        "hod_name":            hod.name if hod else "",
        "teacher_count":       teacher_count,
        "student_count":       student_count,
        "avg_attendance_pct":  avg_pct,
        "pending_approvals":   pending_count,
        "teachers":            teacher_rows,
        "subjects":            subject_rows,
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/hod/pending-approvals
# ═══════════════════════════════════════════════════════════════════════

@router.get("/hod/pending-approvals")
def get_pending_approvals(
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    dept_id = current_user.get("department_id")
    if not dept_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "HOD not assigned to a department.")

    course_ids  = _course_ids_for_depts([dept_id], db)
    student_ids = _student_ids_for_courses(course_ids, db)

    pending = db.query(DeviceRegistry).filter(
        DeviceRegistry.user_id.in_(student_ids),
        DeviceRegistry.approved_by == None,   # noqa: E711
        DeviceRegistry.is_active   == True,    # noqa: E712
    ).order_by(DeviceRegistry.bound_at.desc()).all()

    rows = []
    for p in pending:
        stu = db.query(User).filter(User.id == p.user_id).first()
        rows.append({
            "registry_id":   p.id,
            "student_id":    p.user_id,
            "student_name":  stu.name if stu else "Unknown",
            "roll_number":   stu.roll_number if stu else None,
            "device_name":   p.device_name,
            "device_os":     p.device_os,
            "bound_at":      p.bound_at.isoformat(),
        })

    return {"pending": rows, "count": len(rows)}


# ═══════════════════════════════════════════════════════════════════════
# POST /api/hod/approve-request/{registry_id}
# ═══════════════════════════════════════════════════════════════════════

@router.post("/hod/approve-request/{registry_id}")
def approve_device_request(
    registry_id:  int,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    dept_id    = current_user.get("department_id")
    course_ids = _course_ids_for_depts([dept_id], db) if dept_id else []
    valid_ids  = set(_student_ids_for_courses(course_ids, db)) if course_ids else set()

    reg = db.query(DeviceRegistry).filter(DeviceRegistry.id == registry_id).first()
    if not reg:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device registry record not found.")
    if reg.user_id not in valid_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Student not in your department.")

    reg.approved_by = current_user["id"]
    db.commit()

    # Notify student of approval
    from utils.notification_utils import send_push_notification
    send_push_notification(
        user_id=reg.user_id,
        title="✅ Device Change Approved",
        body="Your device change request has been approved by HOD.",
        db=db,
        data={"type": "approval_notification"},
    )

    return {"success": True, "message": "Device approved."}


# ═══════════════════════════════════════════════════════════════════════
# POST /api/hod/reject-request/{registry_id}
# ═══════════════════════════════════════════════════════════════════════

@router.post("/hod/reject-request/{registry_id}")
def reject_device_request(
    registry_id:  int,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    dept_id    = current_user.get("department_id")
    course_ids = _course_ids_for_depts([dept_id], db) if dept_id else []
    valid_ids  = set(_student_ids_for_courses(course_ids, db)) if course_ids else set()

    reg = db.query(DeviceRegistry).filter(DeviceRegistry.id == registry_id).first()
    if not reg:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device registry record not found.")
    if reg.user_id not in valid_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Student not in your department.")

    reg.is_active = False
    db.commit()

    # Notify student of rejection
    from utils.notification_utils import send_push_notification
    send_push_notification(
        user_id=reg.user_id,
        title="❌ Device Change Rejected",
        body="Your device change request has been rejected by HOD. Contact your department.",
        db=db,
        data={"type": "rejection_notification"},
    )

    return {"success": True, "message": "Device deactivated."}

