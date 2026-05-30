"""
AutoAttend AI v2.0 — Analytics Routes (PROMPTs 6 + 8)

GET  /api/analytics/anomalies?subject_id=               teacher+  anomaly flags
GET  /api/analytics/subject-health/{id}                  teacher+  0-100 health score
GET  /api/analytics/forecast/{student_id}                teacher+  attendance forecast
GET  /api/analytics/semester-progress?department_id=     hod+      semester progress tracker
"""

import logging
import math
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import settings
from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    Course,
    SessionStatus,
    Subject,
    Timetable,
    User,
    UserRole,
    get_db,
)
from utils.auth_utils import hod_or_above, teacher_or_above

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


# ═══════════════════════════════════════════════════════════════════════
# GET /api/analytics/anomalies — Anomaly detection
# ═══════════════════════════════════════════════════════════════════════


@router.get("/anomalies")
def detect_anomalies(
    subject_id: int = Query(...),
    days: int = Query(14, ge=1, le=60),
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """Detect anomalies in attendance patterns:
    - buddy_proxy: Two students always mark within < 5s and < 10m GPS
    - sudden_spike: Student was present 80%+ then absent 3+ consecutive
    - batch_scan: Multiple students marked in < 2s window (group tapping)
    - time_anomaly: Student marks attendance but session hasn't started/already ended
    """
    cutoff = date.today() - timedelta(days=days)

    sessions = (
        db.query(AttendanceSession)
        .filter(
            AttendanceSession.subject_id == subject_id,
            AttendanceSession.date >= cutoff,
            AttendanceSession.status == SessionStatus.ended,
        )
        .all()
    )
    if not sessions:
        return {"anomalies": [], "session_count": 0}

    session_ids = [s.id for s in sessions]
    session_map = {s.id: s for s in sessions}

    records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id.in_(session_ids)).all()

    anomalies = []

    # ── 1. Batch scan detection ──
    # Group records by session, look for clusters of marked_at within 2 seconds
    from collections import defaultdict

    recs_by_session = defaultdict(list)
    for r in records:
        if r.marked_at and r.status in (AttendanceStatus.present, AttendanceStatus.late):
            recs_by_session[r.session_id].append(r)

    for sess_id, sess_recs in recs_by_session.items():
        sorted_recs = sorted(sess_recs, key=lambda r: r.marked_at)
        cluster = [sorted_recs[0]] if sorted_recs else []
        for i in range(1, len(sorted_recs)):
            diff = (sorted_recs[i].marked_at - sorted_recs[i - 1].marked_at).total_seconds()
            if diff <= 2.0:
                cluster.append(sorted_recs[i])
            else:
                if len(cluster) >= 4:
                    student_names = []
                    for r in cluster:
                        u = db.query(User.name).filter(User.id == r.student_id).first()
                        student_names.append(u[0] if u else f"ID:{r.student_id}")
                    anomalies.append(
                        {
                            "type": "batch_scan",
                            "session_id": sess_id,
                            "date": str(session_map[sess_id].date),
                            "detail": f"{len(cluster)} students marked within 2s window",
                            "students": student_names,
                            "severity": "medium",
                        }
                    )
                cluster = [sorted_recs[i]]
        # Final cluster check
        if len(cluster) >= 4:
            student_names = []
            for r in cluster:
                u = db.query(User.name).filter(User.id == r.student_id).first()
                student_names.append(u[0] if u else f"ID:{r.student_id}")
            anomalies.append(
                {
                    "type": "batch_scan",
                    "session_id": sess_id,
                    "date": str(session_map[sess_id].date),
                    "detail": f"{len(cluster)} students marked within 2s window",
                    "students": student_names,
                    "severity": "medium",
                }
            )

    # ── 2. Buddy proxy detection (GPS closeness + timing) ──
    for sess_id, sess_recs in recs_by_session.items():
        gps_recs = [
            r for r in sess_recs if r.student_latitude and r.student_longitude and r.marked_at
        ]
        for i in range(len(gps_recs)):
            for j in range(i + 1, len(gps_recs)):
                r1, r2 = gps_recs[i], gps_recs[j]
                time_diff = abs((r1.marked_at - r2.marked_at).total_seconds())
                if time_diff > 5:
                    continue
                # Haversine approximation for small distances
                dlat = abs(float(r1.student_latitude) - float(r2.student_latitude))
                dlng = abs(float(r1.student_longitude) - float(r2.student_longitude))
                approx_meters = math.sqrt(dlat**2 + dlng**2) * 111_320
                if approx_meters < 2:
                    u1 = db.query(User.name).filter(User.id == r1.student_id).first()
                    u2 = db.query(User.name).filter(User.id == r2.student_id).first()
                    anomalies.append(
                        {
                            "type": "buddy_proxy",
                            "session_id": sess_id,
                            "date": str(session_map[sess_id].date),
                            "detail": f"Two students marked within {time_diff:.0f}s and {approx_meters:.1f}m apart",
                            "students": [u1[0] if u1 else "", u2[0] if u2 else ""],
                            "severity": "high",
                        }
                    )

    # ── 3. Sudden absence spike ──
    student_ids = list({r.student_id for r in records})
    for sid in student_ids:
        student_recs = sorted(
            [r for r in records if r.student_id == sid],
            key=lambda r: session_map[r.session_id].date,
        )
        if len(student_recs) < 4:
            continue
        # Split into first half and second half
        mid = len(student_recs) // 2
        first_half = student_recs[:mid]
        second_half = student_recs[mid:]
        first_present = sum(
            1 for r in first_half if r.status in (AttendanceStatus.present, AttendanceStatus.late)
        )
        first_pct = first_present / len(first_half) * 100 if first_half else 0
        second_present = sum(
            1 for r in second_half if r.status in (AttendanceStatus.present, AttendanceStatus.late)
        )
        second_pct = second_present / len(second_half) * 100 if second_half else 0

        if first_pct >= 80 and second_pct < 50:
            u = db.query(User.name, User.roll_number).filter(User.id == sid).first()
            anomalies.append(
                {
                    "type": "sudden_spike",
                    "detail": f"Attendance dropped from {first_pct:.0f}% to {second_pct:.0f}%",
                    "student": u[0] if u else f"ID:{sid}",
                    "roll_number": u[1] if u else "",
                    "severity": "high",
                }
            )

    return {
        "anomalies": sorted(
            anomalies, key=lambda a: {"high": 0, "medium": 1, "low": 2}.get(a["severity"], 3)
        ),
        "session_count": len(sessions),
        "period_days": days,
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/analytics/subject-health/{subject_id} — Subject Health Score
# ═══════════════════════════════════════════════════════════════════════


@router.get("/subject-health/{subject_id}")
def subject_health(
    subject_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """Health score 0-100 based on:
    - avg_attendance (weight 40): avg present %
    - consistency (weight 20): std-dev of session attendance rates
    - trend (weight 20): improving vs declining (last 5 sessions)
    - defaulter_ratio (weight 20): pct of students below threshold
    """
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(404, "Subject not found.")

    sessions = (
        db.query(AttendanceSession)
        .filter(
            AttendanceSession.subject_id == subject_id,
            AttendanceSession.status == SessionStatus.ended,
        )
        .order_by(AttendanceSession.date)
        .all()
    )
    if not sessions:
        return {"subject_id": subject_id, "health_score": None, "breakdown": None}

    session_ids = [s.id for s in sessions]

    # Per-session attendance rates
    session_rates = []
    for s in sessions:
        if s.total_students and s.total_students > 0:
            session_rates.append((s.present_count or 0) / s.total_students * 100)
        else:
            session_rates.append(0)

    avg_attendance = sum(session_rates) / len(session_rates) if session_rates else 0

    # Consistency: lower std-dev = better
    if len(session_rates) > 1:
        mean = avg_attendance
        variance = sum((r - mean) ** 2 for r in session_rates) / len(session_rates)
        std_dev = math.sqrt(variance)
        consistency_score = max(0, 100 - std_dev * 2)
    else:
        consistency_score = 50

    # Trend: compare last 5 sessions
    if len(session_rates) >= 3:
        recent = session_rates[-min(5, len(session_rates)) :]
        if recent[-1] > recent[0]:
            trend_score = min(100, 60 + (recent[-1] - recent[0]))
        elif recent[-1] < recent[0]:
            trend_score = max(0, 60 - (recent[0] - recent[-1]))
        else:
            trend_score = 60
    else:
        trend_score = 50

    # Defaulter ratio
    student_ids = [
        r[0]
        for r in db.query(AttendanceRecord.student_id.distinct())
        .filter(AttendanceRecord.session_id.in_(session_ids))
        .all()
    ]
    defaulter_count = 0
    for sid in student_ids:
        total = (
            db.query(func.count(AttendanceRecord.id))
            .filter(
                AttendanceRecord.student_id == sid,
                AttendanceRecord.session_id.in_(session_ids),
            )
            .scalar()
            or 0
        )
        present = (
            db.query(func.count(AttendanceRecord.id))
            .filter(
                AttendanceRecord.student_id == sid,
                AttendanceRecord.session_id.in_(session_ids),
                AttendanceRecord.status.in_([AttendanceStatus.present, AttendanceStatus.late]),
            )
            .scalar()
            or 0
        )
        pct = present / total * 100 if total else 0
        if pct < settings.ATTENDANCE_THRESHOLD:
            defaulter_count += 1

    defaulter_ratio = defaulter_count / len(student_ids) * 100 if student_ids else 0
    defaulter_score = max(0, 100 - defaulter_ratio * 2)

    health_score = round(
        avg_attendance * 0.4 + consistency_score * 0.2 + trend_score * 0.2 + defaulter_score * 0.2
    )

    return {
        "subject_id": subject_id,
        "subject_name": subject.name,
        "health_score": min(100, max(0, health_score)),
        "breakdown": {
            "avg_attendance": round(avg_attendance, 1),
            "consistency_score": round(consistency_score, 1),
            "trend_score": round(trend_score, 1),
            "defaulter_score": round(defaulter_score, 1),
        },
        "total_sessions": len(sessions),
        "total_students": len(student_ids),
        "defaulter_count": defaulter_count,
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/analytics/forecast/{student_id} — Attendance Forecast
# ═══════════════════════════════════════════════════════════════════════


@router.get("/forecast/{student_id}")
def attendance_forecast(
    student_id: int,
    subject_id: int = Query(None),
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """Pure math forecast: current %, sessions remaining (assumes 40 total),
    sessions needed to reach threshold, can_afford_to_miss, on_track."""
    student = db.query(User).filter(User.id == student_id, User.role == UserRole.student).first()
    if not student:
        raise HTTPException(404, "Student not found.")

    subjects_filter = []
    if subject_id:
        subjects_filter.append(AttendanceSession.subject_id == subject_id)

    # Get all ended sessions the student has records in
    q = (
        db.query(AttendanceRecord, AttendanceSession)
        .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
        .filter(
            AttendanceRecord.student_id == student_id,
            AttendanceSession.status == SessionStatus.ended,
            *subjects_filter,
        )
    )
    records = q.all()

    if not records:
        return {
            "student_id": student_id,
            "student_name": student.name,
            "forecasts": [],
        }

    # Group by subject
    from collections import defaultdict

    by_subject = defaultdict(list)
    for rec, sess in records:
        by_subject[sess.subject_id].append(rec)

    forecasts = []
    for subj_id, recs in by_subject.items():
        subj = db.query(Subject).filter(Subject.id == subj_id).first()
        total_lectures = subj.total_lectures if subj and subj.total_lectures else 40
        attended = sum(
            1 for r in recs if r.status in (AttendanceStatus.present, AttendanceStatus.late)
        )
        total = len(recs)
        current_pct = round(attended / total * 100, 1) if total else 0
        sessions_remaining = max(0, total_lectures - total)
        threshold = settings.ATTENDANCE_THRESHOLD

        # sessions_needed: minimum future sessions to attend to reach threshold
        # (attended + needed) / total_lectures >= threshold / 100
        needed_total = math.ceil(threshold * total_lectures / 100)
        sessions_needed = max(0, needed_total - attended)
        can_afford_to_miss = max(0, sessions_remaining - sessions_needed)
        on_track = sessions_needed <= sessions_remaining

        # projected_pct if student continues at current rate
        if total > 0:
            projected = round((attended / total) * 100, 1)
        else:
            projected = 0

        forecasts.append(
            {
                "subject_id": subj_id,
                "subject_name": subj.name if subj else f"Subject {subj_id}",
                "attended": attended,
                "total_so_far": total,
                "current_pct": current_pct,
                "total_lectures": total_lectures,
                "sessions_remaining": sessions_remaining,
                "sessions_needed_for_threshold": sessions_needed,
                "can_afford_to_miss": can_afford_to_miss,
                "on_track": on_track,
                "projected_final_pct": projected,
            }
        )

    return {
        "student_id": student_id,
        "student_name": student.name,
        "roll_number": student.roll_number,
        "forecasts": sorted(forecasts, key=lambda f: f["current_pct"]),
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/analytics/semester-progress — Semester Progress Tracker (PROMPT 8)
# ═══════════════════════════════════════════════════════════════════════


@router.get("/semester-progress")
def semester_progress(
    department_id: int = Query(...),
    current_user: dict = Depends(hod_or_above),
    db: Session = Depends(get_db),
):
    """
    For each subject in the department, calculate:
    - planned_sessions: weekly timetable slots × weeks elapsed
    - conducted_sessions: actual ended sessions
    - completion_pct
    - behind_schedule: if conducted < expected by now
    """
    # Verify HOD owns this department
    if current_user.get("department_id") != department_id and current_user["role"] != "principal":
        raise HTTPException(403, "Not your department.")

    course_ids = [
        r[0] for r in db.query(Course.id).filter(Course.department_id == department_id).all()
    ]
    if not course_ids:
        return []

    subjects = db.query(Subject).filter(Subject.course_id.in_(course_ids)).all()

    # Assume semester started ~15 weeks before end, or use a simple heuristic:
    # count weeks from the earliest session date for each subject.
    today = date.today()
    # Approximate semester start as 1st of the month 4 months ago (a heuristic)
    semester_start = today.replace(month=max(1, today.month - 4), day=1)

    # Weeks elapsed since semester start
    weeks_elapsed = max(1, (today - semester_start).days // 7)

    rows = []
    for subj in subjects:
        # Planned: how many timetable slots per week × weeks elapsed
        weekly_slots = (
            db.query(func.count(Timetable.id))
            .filter(
                Timetable.subject_id == subj.id,
            )
            .scalar()
            or 0
        )

        planned = weekly_slots * weeks_elapsed

        # Conducted: actual ended sessions
        conducted = (
            db.query(func.count(AttendanceSession.id))
            .filter(
                AttendanceSession.subject_id == subj.id,
                AttendanceSession.status == SessionStatus.ended,
            )
            .scalar()
            or 0
        )

        completion_pct = round(conducted / planned * 100, 1) if planned > 0 else 0.0
        behind = conducted < planned

        teacher = (
            db.query(User).filter(User.id == subj.teacher_id).first() if subj.teacher_id else None
        )

        rows.append(
            {
                "subject_id": subj.id,
                "subject_name": subj.name,
                "subject_code": subj.code,
                "semester": subj.semester,
                "teacher_name": teacher.name if teacher else "Unassigned",
                "teacher_id": subj.teacher_id,
                "weekly_slots": weekly_slots,
                "planned_sessions": planned,
                "conducted_sessions": conducted,
                "completion_pct": completion_pct,
                "behind_schedule": behind,
            }
        )

    return sorted(rows, key=lambda r: r["completion_pct"])
