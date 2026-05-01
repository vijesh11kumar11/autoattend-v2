"""
AutoAttend AI v2.0 — Attendance Routes

POST /api/attendance/start-session
POST /api/attendance/mark
POST /api/attendance/end-session/{session_id}
GET  /api/attendance/session/{session_id}
GET  /api/attendance/student/{student_id}/summary
POST /api/attendance/manual-override

Internal scheduler job: auto_expire_sessions()
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from config import settings
from database import (
    AttendanceAudit,
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    AuditResult,
    Capsule,
    CapsuleUnlockMode,
    Course,
    Department,
    MarkedBy,
    Section,
    SessionStatus,
    Subject,
    User,
    UserRole,
    get_db,
)
from schemas.attendance_schemas import (
    AttendanceChecks,
    AttendanceResultResponse,
    CalendarDay,
    CalendarSubjectEntry,
    EndSessionSummary,
    ManualOverrideRequest,
    MarkAttendanceRequest,
    RecentAttendanceRecord,
    SessionStatusResponse,
    StartSessionRequest,
    StartSessionResponse,
    StudentAttendanceEntry,
    StudentAttendanceSummaryResponse,
    StudentCalendarResponse,
    StudentRecentResponse,
    SubjectAttendanceSummary,
)
from utils.auth_utils import (
    any_authenticated,
    student_only,
    teacher_or_above,
    validate_face_verify_token,
)
from utils.bluetooth_utils import generate_bluetooth_token
from utils.location_utils import verify_bluetooth_proximity, verify_gps_proximity
from utils.notification_utils import send_push_notification, send_push_to_many
from utils.qr_utils import validate_qr_token

from slowapi import Limiter
from slowapi.util import get_remote_address

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])
limiter = Limiter(key_func=get_remote_address)

# Attendance-status thresholds (lower = worse)
_THRESHOLD_WARNING  = settings.ATTENDANCE_THRESHOLD        # e.g. 75 %
_THRESHOLD_CRITICAL = settings.ATTENDANCE_THRESHOLD - 10   # e.g. 65 %
_THRESHOLD_DETAINED = settings.ATTENDANCE_THRESHOLD - 25   # e.g. 50 %

# Manual-override window after session ends
_OVERRIDE_WINDOW_HOURS = 24


def _attendance_status_label(pct: float) -> str:
    if pct >= _THRESHOLD_WARNING:
        return "safe"
    if pct >= _THRESHOLD_CRITICAL:
        return "warning"
    if pct >= _THRESHOLD_DETAINED:
        return "critical"
    return "detained"


def _get_ip(request: Request) -> Optional[str]:
    fwd = request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


# ═══════════════════════════════════════════════════════════════════════
# POST /api/attendance/start-session
# ═══════════════════════════════════════════════════════════════════════

@router.post("/start-session", response_model=StartSessionResponse)
def start_session(
    body:         StartSessionRequest,
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """
    Teacher starts an attendance session for a subject.

    1. Verifies the teacher is assigned to the subject.
    2. Rejects if an active session already exists today.
    3. Generates per-session qr_secret + bluetooth_token.
    4. Creates the session and default-absent records for all enrolled students.
    """
    subject: Optional[Subject] = (
        db.query(Subject).filter(Subject.id == body.subject_id).first()
    )
    if not subject:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subject not found.")

    caller_role = current_user["role"]
    caller_id   = current_user["id"]

    # Teachers may only start sessions for their own subjects
    if caller_role == "teacher" and subject.teacher_id != caller_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not assigned to this subject.",
        )

    # HOD/Principal must still belong to the same college
    if caller_role in {"hod", "principal"}:
        course = db.query(Course).filter(Course.id == subject.course_id).first()
        dept   = db.query(Department).filter(Department.id == course.department_id).first()
        if dept.college_id != current_user["college_id"]:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This subject does not belong to your college.",
            )

    # Reject duplicate active session for the same subject today
    dup_filters = [
        AttendanceSession.subject_id == body.subject_id,
        AttendanceSession.date       == body.date,
        AttendanceSession.status     == SessionStatus.active,
    ]
    if body.section_id is not None:
        dup_filters.append(AttendanceSession.section_id == body.section_id)
    else:
        dup_filters.append(AttendanceSession.section_id.is_(None))

    existing = db.query(AttendanceSession).filter(*dup_filters).first()
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An active session already exists for this subject today (id={existing.id}).",
        )

    # Generate per-session secrets
    qr_secret       = secrets.token_hex(32)
    bt_token        = generate_bluetooth_token()
    now             = datetime.now(tz=timezone.utc)

    logger.info("📗 SESSION START │ teacher_id=%d │ subject='%s' (id=%d) │ date=%s",
                caller_id, subject.name, body.subject_id, body.date)
    logger.info("📗 SESSION START │ teacher GPS lat=%.6f lon=%.6f",
                body.teacher_latitude or 0.0, body.teacher_longitude or 0.0)
    logger.info("📗 SESSION START │ QR secret generated (hint=%s...) │ BLE token generated (%d chars)",
                qr_secret[:8], len(bt_token))

    session = AttendanceSession(
        subject_id        = body.subject_id,
        teacher_id        = caller_id,
        section_id        = body.section_id,
        date              = body.date,
        start_time        = now.time(),
        status            = SessionStatus.active,
        teacher_latitude  = body.teacher_latitude,
        teacher_longitude = body.teacher_longitude,
        bluetooth_token   = bt_token,
        qr_secret         = qr_secret,
    )
    db.add(session)
    db.flush()   # get session.id before bulk insert

    # Enroll every student in the subject's course+semester as absent by default
    # If section_id is provided, only enroll students from that section
    student_filters = [
        User.course_id  == subject.course_id,
        User.semester   == subject.semester,
        User.role       == UserRole.student,
        User.is_active  == True,           # noqa: E712
    ]
    if body.section_id is not None:
        student_filters.append(User.section_id == body.section_id)

    students = db.query(User).filter(*student_filters).all()

    for student in students:
        db.add(AttendanceRecord(
            session_id = session.id,
            student_id = student.id,
            status     = AttendanceStatus.absent,
            marked_by  = MarkedBy.auto_absent,
            face_verified      = False,
            gps_verified       = False,
            bluetooth_verified = False,
        ))

    session.total_students = len(students)
    db.commit()

    logger.info("📗 SESSION START │ session_id=%d │ %d students enrolled (default=absent)",
                session.id, len(students))

    # ── Push notification: notify enrolled students ───────────────────
    teacher_name = db.query(User).filter(User.id == caller_id).first()
    t_name = teacher_name.name if teacher_name else "Your teacher"
    student_ids = [s.id for s in students]
    if student_ids:
        send_push_to_many(
            user_ids=student_ids,
            title=f"📢 {subject.name} — Attendance Started",
            body=f"{t_name} has started attendance for {subject.name}. Scan QR now!",
            db=db,
            data={"type": "session_started", "session_id": session.id, "screen": "ScanQR"},
        )

    # ── ClassPulse: notify session-active capsules now unlocked ──────
    try:
        sa_capsules = db.query(Capsule).filter(
            Capsule.subject_id == body.subject_id,
            Capsule.unlock_mode == CapsuleUnlockMode.session_active,
            Capsule.is_active == True,  # noqa: E712
        ).count()
        if sa_capsules and student_ids:
            send_push_to_many(
                user_ids=student_ids,
                title=f"📚 {sa_capsules} ClassPulse capsule(s) unlocked",
                body=f"Open ClassPulse for {subject.name} — capsules available during this session.",
                db=db,
                data={
                    "type": "classpulse_session_unlocked",
                    "subject_id": body.subject_id,
                    "session_id": session.id,
                    "screen": "ClassPulseStudent",
                },
            )
    except Exception as e:
        logger.warning("ClassPulse start-session notify failed: %s", e)

    logger.info(
        "Session started: id=%d subject_id=%d teacher_id=%d students=%d",
        session.id, body.subject_id, caller_id, len(students),
    )

    return StartSessionResponse(
        session_id      = session.id,
        subject_name    = subject.name,
        subject_code    = subject.code,
        bluetooth_token = bt_token,
        qr_secret_hint  = qr_secret[:8],
        total_students  = len(students),
        started_at      = now,
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/attendance/mark
# ═══════════════════════════════════════════════════════════════════════

@router.post("/mark", response_model=AttendanceResultResponse)
@limiter.limit("30/minute")
def mark_attendance(
    body:         MarkAttendanceRequest,
    request:      Request,
    current_user: dict    = Depends(student_only),
    db:           Session = Depends(get_db),
):
    """
    Mark a student's attendance after passing all multi-factor checks:
    device → face token → QR → GPS → Bluetooth.

    Each step is independent; failure at any step returns a structured
    result dict — we never raise HTTP 4xx inside checks so the audit
    log is always written.
    """
    student_id = current_user["id"]
    now        = datetime.now(tz=timezone.utc)
    ip         = _get_ip(request)

    logger.info("\n" + "="*70)
    logger.info("📝 MARK ATTENDANCE │ student_id=%d │ session_id=%d │ IP=%s",
                student_id, body.session_id, ip)
    logger.info("="*70)

    # Snapshot of check results — updated throughout
    checks = {
        "face_verified":        False,
        "qr_valid":             False,
        "gps_verified":         False,
        "bluetooth_verified":   False,
        "device_matched":       True,   # already enforced by get_current_user JWT
        "already_marked":       False,
    }

    # ── STEP 1a — Session ─────────────────────────────────────────────
    session: Optional[AttendanceSession] = (
        db.query(AttendanceSession).filter(AttendanceSession.id == body.session_id).first()
    )
    if not session or session.status != SessionStatus.active:
        logger.warning("❌ STEP 1a │ session_id=%d │ not found or inactive", body.session_id)
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Attendance session not found or is no longer active.",
        )
    logger.info("✅ STEP 1a │ Session found │ id=%d │ status=%s │ subject_id=%d",
                session.id, session.status.value, session.subject_id)

    subject: Subject = db.query(Subject).filter(Subject.id == session.subject_id).first()

    # ── STEP 1b — Enrolled? ───────────────────────────────────────────
    student: User = db.query(User).filter(User.id == student_id).first()
    if (
        not student
        or student.course_id  != subject.course_id
        or student.semester   != subject.semester
    ):
        logger.warning("❌ STEP 1b │ student_id=%d │ not enrolled in subject_id=%d", student_id, session.subject_id)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not enrolled in this subject.",
        )
    logger.info("✅ STEP 1b │ Student enrolled │ roll=%s │ subject='%s'",
                student.roll_number, subject.name)

    # ── STEP 1c — Already present? ────────────────────────────────────
    record: Optional[AttendanceRecord] = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.session_id == body.session_id,
            AttendanceRecord.student_id == student_id,
        )
        .first()
    )
    if record and record.status == AttendanceStatus.present:
        checks["already_marked"] = True
        logger.info("ℹ️ STEP 1c │ student_id=%d │ already marked present — skipping", student_id)
        return AttendanceResultResponse(
            success      = False,
            status       = "failed",
            message      = "Attendance already marked as present for this session.",
            subject_name = subject.name,
            marked_at    = record.marked_at,
            checks       = AttendanceChecks(**checks),
        )

    # ── STEP 2 — Device check ─────────────────────────────────────────
    # get_current_user already rejects mismatched device for students.
    # The device_id in JWT == device_id in request body is an extra sanity check.
    logger.info("📱 STEP 2 │ Device check │ JWT_device=%s │ body_device=%s",
                current_user.get("device_id", "none"), body.device_id or "none")
    if current_user.get("device_id") and body.device_id:
        if current_user["device_id"] != body.device_id:
            checks["device_matched"] = False
            logger.warning("❌ STEP 2 │ DEVICE MISMATCH │ student_id=%d │ expected=%s │ got=%s",
                           student_id, current_user["device_id"], body.device_id)
            _write_audit(db, session.id, student_id, AuditResult.failed,
                         "Device ID mismatch", 0.0, None, body.device_id, ip)
            return AttendanceResultResponse(
                success      = False,
                status       = "failed",
                message      = "Wrong device. Attendance must be marked from your registered device.",
                subject_name = subject.name,
                checks       = AttendanceChecks(**checks),
            )
    logger.info("✅ STEP 2 │ Device matched ✓")

    # ── STEP 3 — Face verify token ────────────────────────────────────
    logger.info("🙍 STEP 3 │ Face token validation │ token=%s...",
                (body.face_token or "")[:16])
    face_valid = validate_face_verify_token(
        body.face_token, student_id, body.session_id, db
    )
    if not face_valid:
        logger.warning("❌ STEP 3 │ FACE TOKEN INVALID/EXPIRED │ student_id=%d", student_id)
        _write_audit(db, session.id, student_id, AuditResult.failed,
                     "Face token invalid/expired", 0.0, None, body.device_id, ip)
        return AttendanceResultResponse(
            success      = False,
            status       = "failed",
            message      = "Face verification required. Please verify your face first.",
            subject_name = subject.name,
            checks       = AttendanceChecks(**checks),
        )
    checks["face_verified"] = True
    logger.info("✅ STEP 3 │ Face token valid ✓")

    # ── STEP 4 — QR validation ────────────────────────────────────────
    logger.info("📷 STEP 4 │ QR validation │ qr_data=%s...", (body.qr_data or "")[:20])
    qr_result = validate_qr_token(
        body.qr_data,
        body.session_id,
        session.qr_secret,
        student_id,
        db,
    )
    if not qr_result.get("valid"):
        logger.warning("❌ STEP 4 │ QR INVALID │ reason=%s", qr_result.get("reason", "unknown"))
        _write_audit(db, session.id, student_id, AuditResult.failed,
                     qr_result.get("reason", "QR invalid"), 0.0, None, body.device_id, ip)
        return AttendanceResultResponse(
            success      = False,
            status       = "failed",
            message      = qr_result.get("reason", "Invalid or expired QR code."),
            subject_name = subject.name,
            checks       = AttendanceChecks(**checks),
        )
    checks["qr_valid"] = True
    logger.info("✅ STEP 4 │ QR token valid ✓")

    # ── STEP 5 — GPS check ────────────────────────────────────────────
    gps_flagged = False
    if session.teacher_latitude is not None and session.teacher_longitude is not None:
        logger.info("📍 STEP 5 │ GPS check starting")
        logger.info("📍 STEP 5 │ Teacher  GPS │ lat=%.6f │ lon=%.6f",
                    session.teacher_latitude, session.teacher_longitude)
        logger.info("📍 STEP 5 │ Student  GPS │ lat=%.6f │ lon=%.6f │ accuracy=%.1f m",
                    body.student_latitude or 0.0, body.student_longitude or 0.0,
                    body.student_gps_accuracy or 0.0)
        gps_result = verify_gps_proximity(
            student_lat      = body.student_latitude,
            student_lon      = body.student_longitude,
            student_accuracy = body.student_gps_accuracy,
            teacher_lat      = session.teacher_latitude,
            teacher_lon      = session.teacher_longitude,
        )
        if not gps_result.get("verified"):
            logger.warning("❌ STEP 5 │ GPS FAILED │ distance=%s m │ reason=%s",
                           gps_result.get("distance_meters", "N/A"), gps_result.get("reason", "unknown"))
            _write_audit(db, session.id, student_id, AuditResult.failed,
                         gps_result.get("reason", "GPS failed"),
                         0.0, gps_result.get("distance_meters"), body.device_id, ip)
            return AttendanceResultResponse(
                success      = False,
                status       = "failed",
                message      = gps_result.get("reason", "GPS check failed."),
                subject_name = subject.name,
                checks       = AttendanceChecks(**checks),
            )
        checks["gps_verified"] = True
        gps_flagged = gps_result.get("flagged_suspicious", False)
        gps_distance = gps_result.get("distance_meters")
        logger.info("✅ STEP 5 │ GPS VERIFIED │ distance=%.1f m │ accuracy=%.1f m │ suspicious=%s",
                    gps_distance or 0.0, body.student_gps_accuracy or 0.0, gps_flagged)
    else:
        # Session has no GPS data (teacher didn't share location) — skip check
        checks["gps_verified"] = True
        gps_distance = None
        logger.info("⚠️ STEP 5 │ GPS skipped — teacher did not share location")

    # ── STEP 6 — Bluetooth check ─────────────────────────────────────
    logger.info("📶 STEP 6 │ Bluetooth check │ session_token=%s... │ detected_token=%s...",
                (session.bluetooth_token or "")[:8], (body.bluetooth_token_detected or "")[:8])
    bt_result = verify_bluetooth_proximity(
        session.bluetooth_token or "",
        body.bluetooth_token_detected or "",
    )
    bt_verified = bt_result.get("verified", False)
    checks["bluetooth_verified"] = bt_verified

    if not bt_verified:
        if settings.BLUETOOTH_REQUIRED:
            logger.warning("❌ STEP 6 │ BLUETOOTH FAILED │ reason=%s", bt_result.get("reason", "unknown"))
            _write_audit(db, session.id, student_id, AuditResult.failed,
                         bt_result.get("reason", "Bluetooth failed"),
                         0.0, gps_distance, body.device_id, ip)
            return AttendanceResultResponse(
                success      = False,
                status       = "failed",
                message      = bt_result.get("reason", "Bluetooth beacon not detected."),
                subject_name = subject.name,
                checks       = AttendanceChecks(**checks),
            )
        else:
            logger.warning(
                "⚠️ STEP 6 │ Bluetooth required=False — allowing attendance without BLE "
                "for student_id=%d session_id=%d",
                student_id, body.session_id,
            )
    else:
        logger.info("✅ STEP 6 │ Bluetooth verified ✓")

    # ── STEP 7 — Mark attendance ──────────────────────────────────────
    logger.info("🌟 STEP 7 │ ALL CHECKS PASSED — marking attendance as PRESENT")
    if record:
        # Update the existing absent record
        record.status              = AttendanceStatus.present
        record.face_verified       = True
        record.gps_verified        = checks["gps_verified"]
        record.bluetooth_verified  = bt_verified
        record.student_latitude    = body.student_latitude
        record.student_longitude   = body.student_longitude
        record.marked_by           = MarkedBy.qr_scan
        record.marked_at           = now
        record.failure_reason      = None
    else:
        # Shouldn't happen (start_session creates absent records), but handle it
        record = AttendanceRecord(
            session_id         = body.session_id,
            student_id         = student_id,
            status             = AttendanceStatus.present,
            face_verified      = True,
            gps_verified       = checks["gps_verified"],
            bluetooth_verified = bt_verified,
            student_latitude   = body.student_latitude,
            student_longitude  = body.student_longitude,
            marked_by          = MarkedBy.qr_scan,
            marked_at          = now,
        )
        db.add(record)

    # Update session present_count
    db.query(AttendanceSession).filter(AttendanceSession.id == body.session_id).update(
        {"present_count": AttendanceSession.present_count + 1},
        synchronize_session=False,
    )

    # ── STEP 8 — Audit log ────────────────────────────────────────────
    _write_audit(
        db, session.id, student_id, AuditResult.success,
        None, 0.0, gps_distance, body.device_id, ip,
        flagged=(gps_flagged or not bt_verified),
    )
    db.commit()

    # ── Push notification: confirm attendance marked ──────────────────
    send_push_notification(
        user_id=student_id,
        title=f"✅ {subject.name} — Attendance Marked",
        body=f"{subject.name} — Attendance marked (Present)",
        db=db,
        data={"type": "attendance_marked", "session_id": body.session_id},
    )

    # ── ClassPulse: notify after-attendance-marked capsules unlocked ─
    try:
        aam_count = db.query(Capsule).filter(
            Capsule.subject_id == session.subject_id,
            Capsule.unlock_mode == CapsuleUnlockMode.after_attendance_marked,
            Capsule.is_active == True,  # noqa: E712
        ).count()
        if aam_count:
            send_push_notification(
                user_id=student_id,
                title=f"📚 {aam_count} ClassPulse capsule(s) unlocked",
                body=f"Open ClassPulse for {subject.name} — new content available.",
                db=db,
                data={
                    "type": "classpulse_attendance_unlocked",
                    "subject_id": session.subject_id,
                    "screen": "ClassPulseStudent",
                },
            )
    except Exception as e:
        logger.warning("ClassPulse attendance-marked notify failed: %s", e)

    logger.info(
        "🎉 ATTENDANCE MARKED │ student_id=%d │ session_id=%d │ "
        "face=✓ │ qr=✓ │ gps=%s (%.1f m) │ bluetooth=%s │ suspicious=%s",
        student_id, body.session_id,
        "✓" if checks["gps_verified"] else "✗", gps_distance or 0.0,
        "✓" if bt_verified else "✗",
        gps_flagged,
    )
    logger.info("="*70 + "\n")

    return AttendanceResultResponse(
        success      = True,
        status       = "present",
        message      = "Attendance marked successfully!",
        subject_name = subject.name,
        marked_at    = now,
        checks       = AttendanceChecks(**checks),
    )


def _write_audit(
    db:          Session,
    session_id:  int,
    student_id:  int,
    result:      AuditResult,
    reason:      Optional[str],
    confidence:  float,
    gps_dist:    Optional[float],
    device_id:   Optional[str],
    ip:          Optional[str],
    flagged:     bool = False,
) -> None:
    db.add(AttendanceAudit(
        session_id          = session_id,
        student_id          = student_id,
        result              = result,
        failure_reason      = reason,
        face_confidence     = confidence,
        gps_distance_meters = gps_dist,
        device_id           = device_id,
        ip_address          = ip,
    ))
    # commit is deferred to caller to allow batching


# ═══════════════════════════════════════════════════════════════════════
# POST /api/attendance/end-session/{session_id}
# ═══════════════════════════════════════════════════════════════════════

@router.post("/end-session/{session_id}", response_model=EndSessionSummary)
def end_session(
    session_id:   int,
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """End an active session and return a summary of present / absent counts."""
    session: Optional[AttendanceSession] = (
        db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    )
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    if session.status != SessionStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is not active.")

    caller_role = current_user["role"]
    if caller_role == "teacher" and session.teacher_id != current_user["id"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not the teacher of this session.",
        )

    now = datetime.now(tz=timezone.utc)

    # Count results
    all_records = (
        db.query(AttendanceRecord)
        .filter(AttendanceRecord.session_id == session_id)
        .all()
    )
    present = sum(1 for r in all_records if r.status == AttendanceStatus.present)
    total   = len(all_records)
    absent  = total - present
    pct     = round((present / total * 100) if total else 0.0, 1)

    session.status        = SessionStatus.ended
    session.end_time      = now.time()
    session.present_count = present
    db.commit()

    logger.info(
        "Session ended: id=%d present=%d/%d (%.1f%%)",
        session_id, present, total, pct,
    )

    # ── ClassPulse: notify present students that session capsules are locked ─
    try:
        sa_count = db.query(Capsule).filter(
            Capsule.subject_id == session.subject_id,
            Capsule.unlock_mode == CapsuleUnlockMode.session_active,
            Capsule.is_active == True,  # noqa: E712
        ).count()
        if sa_count:
            present_ids = [r.student_id for r in all_records if r.status == AttendanceStatus.present]
            subj = db.query(Subject).filter(Subject.id == session.subject_id).first()
            subj_name = subj.name if subj else "Subject"
            if present_ids:
                send_push_to_many(
                    user_ids=present_ids,
                    title=f"🔒 {subj_name} — Session capsules locked",
                    body=f"{sa_count} session capsule(s) are now locked. Review notes any time.",
                    db=db,
                    data={
                        "type": "classpulse_session_locked",
                        "subject_id": session.subject_id,
                    },
                )
    except Exception as e:
        logger.warning("ClassPulse end-session notify failed: %s", e)

    return EndSessionSummary(
        session_id = session_id,
        total      = total,
        present    = present,
        absent     = absent,
        percentage = pct,
        ended_at   = now,
    )


# ═══════════════════════════════════════════════════════════════════════
# GET /api/attendance/session/{session_id}
# ═══════════════════════════════════════════════════════════════════════

@router.get("/session/{session_id}", response_model=SessionStatusResponse)
def get_session_status(
    session_id:   int,
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """Return session details with per-student attendance status."""
    session: Optional[AttendanceSession] = (
        db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    )
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    subject: Subject = db.query(Subject).filter(Subject.id == session.subject_id).first()

    records = (
        db.query(AttendanceRecord)
        .filter(AttendanceRecord.session_id == session_id)
        .all()
    )

    student_ids = [r.student_id for r in records]
    students_map = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(student_ids)).all()
    }

    entries = []
    for rec in records:
        stu = students_map.get(rec.student_id)
        entries.append(StudentAttendanceEntry(
            student_id         = rec.student_id,
            name               = stu.name if stu else "Unknown",
            roll_number        = stu.roll_number if stu else None,
            status             = rec.status.value,
            marked_at          = rec.marked_at,
            face_verified      = rec.face_verified,
            gps_verified       = rec.gps_verified,
            bluetooth_verified = rec.bluetooth_verified,
        ))

    present = sum(1 for r in records if r.status == AttendanceStatus.present)
    total   = len(records)

    return SessionStatusResponse(
        session_id     = session_id,
        subject_name   = subject.name,
        subject_code   = subject.code,
        date           = session.date,
        start_time     = session.start_time,
        status         = session.status.value,
        total_students = total,
        present_count  = present,
        absent_count   = total - present,
        present_pct    = round((present / total * 100) if total else 0.0, 1),
        students       = entries,
    )


# ═══════════════════════════════════════════════════════════════════════
# GET /api/attendance/student/{student_id}/summary
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/{student_id}/summary", response_model=StudentAttendanceSummaryResponse)
def student_attendance_summary(
    student_id:   int,
    current_user: dict    = Depends(any_authenticated),
    db:           Session = Depends(get_db),
):
    """
    Subject-wise attendance percentages for a student.
    Student can only view their own summary; teachers/HOD can view anyone.
    """
    caller_role = current_user["role"]
    caller_id   = current_user["id"]

    if caller_role == "student" and caller_id != student_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You can only view your own attendance summary.",
        )

    student: Optional[User] = (
        db.query(User).filter(User.id == student_id).first()
    )
    if not student or not student.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    # College boundary for staff
    if caller_role in {"teacher", "hod", "principal"}:
        if student.college_id != current_user["college_id"]:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "You can only view students in your college.",
            )

    # Get all subjects for the student's course+semester
    subjects = (
        db.query(Subject)
        .filter(
            Subject.course_id == student.course_id,
            Subject.semester  == student.semester,
        )
        .all()
    )

    summaries = []
    for subj in subjects:
        # All sessions for this subject
        session_ids = [
            s.id for s in
            db.query(AttendanceSession.id)
            .filter(
                AttendanceSession.subject_id == subj.id,
                AttendanceSession.status     == SessionStatus.ended,
            )
            .all()
        ]
        if not session_ids:
            continue

        total_sessions = len(session_ids)
        present = (
            db.query(AttendanceRecord)
            .filter(
                AttendanceRecord.session_id.in_(session_ids),
                AttendanceRecord.student_id == student_id,
                AttendanceRecord.status     == AttendanceStatus.present,
            )
            .count()
        )
        absent  = total_sessions - present
        pct     = round((present / total_sessions * 100) if total_sessions else 0.0, 1)

        summaries.append(SubjectAttendanceSummary(
            subject_id        = subj.id,
            subject_name      = subj.name,
            subject_code      = subj.code,
            semester          = subj.semester,
            total_sessions    = total_sessions,
            present           = present,
            absent            = absent,
            percentage        = pct,
            attendance_status = _attendance_status_label(pct),
        ))

    return StudentAttendanceSummaryResponse(
        student_id   = student_id,
        student_name = student.name,
        roll_number  = student.roll_number,
        subjects     = summaries,
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/attendance/manual-override
# ═══════════════════════════════════════════════════════════════════════

@router.post("/manual-override")
def manual_override(
    body:         ManualOverrideRequest,
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """
    Override a single student's attendance status for a session.

    Rules:
      • Teacher must own the session (or be HOD/Principal within college).
      • Cannot override more than 24 hours after the session ended.
      • Always writes an audit record.
    """
    session: Optional[AttendanceSession] = (
        db.query(AttendanceSession).filter(AttendanceSession.id == body.session_id).first()
    )
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    caller_role = current_user["role"]
    if caller_role == "teacher" and session.teacher_id != current_user["id"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not the teacher of this session.",
        )

    # Time-window guard
    if session.status == SessionStatus.ended and session.end_time:
        # Reconstruct ended datetime (date + time) in UTC
        ended_dt = datetime.combine(session.date, session.end_time).replace(tzinfo=timezone.utc)
        if datetime.now(tz=timezone.utc) > ended_dt + timedelta(hours=_OVERRIDE_WINDOW_HOURS):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Cannot override attendance more than {_OVERRIDE_WINDOW_HOURS} hours after session ended.",
            )

    record: Optional[AttendanceRecord] = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.session_id == body.session_id,
            AttendanceRecord.student_id == body.student_id,
        )
        .first()
    )
    if not record:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No attendance record found for this student and session.",
        )

    old_status = record.status
    new_status = AttendanceStatus(body.status)
    record.status     = new_status
    record.marked_by  = MarkedBy.manual
    record.marked_at  = datetime.now(tz=timezone.utc)

    # Recalculate denormalized present_count on the session
    new_present = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.session_id == body.session_id,
            AttendanceRecord.status == AttendanceStatus.present,
        )
        .count()
    )
    session.present_count = new_present

    db.add(AttendanceAudit(
        session_id     = body.session_id,
        student_id     = body.student_id,
        result         = AuditResult.success,
        failure_reason = f"Manual override by user_id={current_user['id']}: {body.reason}",
    ))
    db.commit()

    logger.info(
        "✍️ MANUAL OVERRIDE │ session_id=%d │ student_id=%d │ %s → %s │ by user_id=%d │ reason='%s'",
        body.session_id, body.student_id,
        old_status.value, new_status.value, current_user["id"], body.reason,
    )

    return {
        "success":     True,
        "old_status":  old_status.value,
        "new_status":  new_status.value,
        "message":     f"Attendance updated to '{new_status.value}'.",
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/attendance/student/{student_id}/recent
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/{student_id}/recent", response_model=StudentRecentResponse)
def student_recent_attendance(
    student_id:   int,
    limit:        int          = 10,
    current_user: dict         = Depends(any_authenticated),
    db:           Session      = Depends(get_db),
):
    """Last `limit` attendance records for a student (default 10)."""
    caller_role = current_user["role"]
    if caller_role == "student" and current_user["id"] != student_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only view your own records.")

    student = db.query(User).filter(User.id == student_id).first()
    if not student or not student.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    if caller_role in {"teacher", "hod", "principal"}:
        if student.college_id != current_user["college_id"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not in your college.")

    limit = max(1, min(limit, 100))

    records = (
        db.query(AttendanceRecord, AttendanceSession, Subject)
        .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .filter(AttendanceRecord.student_id == student_id)
        .order_by(AttendanceSession.date.desc(), AttendanceRecord.marked_at.desc())
        .limit(limit)
        .all()
    )

    rows = [
        RecentAttendanceRecord(
            session_id=rec.session_id,
            subject_name=subj.name,
            subject_code=subj.code,
            date=str(sess.date),
            status=rec.status.value,
            marked_via=rec.marked_by.value if rec.marked_by else "manual",
            face_verified=bool(rec.face_verified),
        )
        for rec, sess, subj in records
    ]
    return StudentRecentResponse(student_id=student_id, records=rows)


# ═══════════════════════════════════════════════════════════════════════
# GET /api/attendance/student/{student_id}/calendar
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/{student_id}/calendar", response_model=StudentCalendarResponse)
def student_attendance_calendar(
    student_id:   int,
    days:         int          = 30,
    current_user: dict         = Depends(any_authenticated),
    db:           Session      = Depends(get_db),
):
    """Per-day attendance breakdown for the last `days` days (default 30)."""
    from datetime import date as date_type, timedelta as td

    caller_role = current_user["role"]
    if caller_role == "student" and current_user["id"] != student_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only view your own calendar.")

    student = db.query(User).filter(User.id == student_id).first()
    if not student or not student.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    days = max(7, min(days, 90))
    today = date_type.today()
    start = today - td(days=days - 1)

    # Fetch all records within range
    records = (
        db.query(AttendanceRecord, AttendanceSession, Subject)
        .join(AttendanceSession, AttendanceRecord.session_id == AttendanceSession.id)
        .join(Subject, AttendanceSession.subject_id == Subject.id)
        .filter(
            AttendanceRecord.student_id == student_id,
            AttendanceSession.date >= start,
            AttendanceSession.date <= today,
        )
        .all()
    )

    # Group by date
    from collections import defaultdict
    day_map: dict[str, list] = defaultdict(list)
    for rec, sess, subj in records:
        day_map[str(sess.date)].append((rec, subj))

    calendar_days = []
    for i in range(days):
        d = start + td(days=i)
        key = str(d)
        entries = day_map.get(key, [])

        subjects = [
            CalendarSubjectEntry(
                subject_name=subj.name,
                subject_code=subj.code,
                status=rec.status.value,
            )
            for rec, subj in entries
        ]

        # Compute day code:  P if any present, A if all absent, L if any late,
        # M if medical_leave, D if duty_leave, "" if no class
        if not entries:
            day_code = ""
        else:
            statuses = {rec.status.value for rec, _ in entries}
            if "present" in statuses:
                day_code = "P"
            elif "late" in statuses:
                day_code = "L"
            elif "medical_leave" in statuses:
                day_code = "M"
            elif "duty_leave" in statuses:
                day_code = "D"
            else:
                day_code = "A"

        calendar_days.append(CalendarDay(date=key, day_code=day_code, subjects=subjects))

    return StudentCalendarResponse(student_id=student_id, days=calendar_days)


# ═══════════════════════════════════════════════════════════════════════
# Auto-expire scheduler job (called by APScheduler — NOT an HTTP route)
# ═══════════════════════════════════════════════════════════════════════

def auto_expire_sessions(db: Session) -> int:
    """
    APScheduler job — runs every minute.

    Finds sessions that are still 'active' but whose start_time is older
    than the expected class duration + 10-minute buffer, and marks them
    as 'expired'.

    Returns the number of sessions expired in this run.

    Wiring (in main.py):
        from apscheduler.schedulers.background import BackgroundScheduler
        from database import SessionLocal
        from routes.attendance import auto_expire_sessions

        scheduler = BackgroundScheduler()
        scheduler.add_job(
            lambda: auto_expire_sessions(SessionLocal()),
            "interval", minutes=1,
        )
        scheduler.start()
    """
    # A class hour is typically 60 minutes; use 70 min as the auto-expire window
    CLASS_DURATION_MINUTES = 70
    cutoff = datetime.now(tz=timezone.utc) - timedelta(minutes=CLASS_DURATION_MINUTES)

    stale_sessions = (
        db.query(AttendanceSession)
        .filter(
            AttendanceSession.status     == SessionStatus.active,
            AttendanceSession.created_at <  cutoff,
        )
        .all()
    )

    expired_count = 0
    for sess in stale_sessions:
        all_records = (
            db.query(AttendanceRecord)
            .filter(AttendanceRecord.session_id == sess.id)
            .all()
        )
        present = sum(1 for r in all_records if r.status == AttendanceStatus.present)
        total   = len(all_records)

        sess.status        = SessionStatus.expired
        sess.present_count = present
        expired_count += 1
        logger.info(
            "auto_expire_sessions: expired session_id=%d present=%d/%d",
            sess.id, present, total,
        )

    if expired_count:
        db.commit()

    return expired_count
