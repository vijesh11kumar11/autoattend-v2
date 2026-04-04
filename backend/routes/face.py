"""
AutoAttend AI v2.0 — Face API Routes

POST /api/face/verify              — student submits selfie → face_verify_token
GET  /api/face/enrollment-status/{student_id}
POST /api/face/liveness-session    — generate random liveness challenge
POST /api/face/liveness-verify     — submit 3 frames to confirm liveness
"""

from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from database import (
    AttendanceAudit,
    AttendanceSession,
    AuditResult,
    LivenessChallenge,
    SessionStatus,
    Subject,
    User,
    get_db,
)
from utils.auth_utils import (
    any_authenticated,
    create_face_verify_token,
    hod_or_above,
    student_only,
)
from utils.face_utils import (
    create_liveness_challenge,
    verify_liveness_frames,
    verify_student_face,
)

from slowapi import Limiter
from slowapi.util import get_remote_address

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/face", tags=["Face"])
limiter = Limiter(key_func=get_remote_address)

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}
_MAX_FACE_IMAGE_BYTES   = 6 * 1024 * 1024   # 6 MB
_MAX_VERIFY_ATTEMPTS    = 5                  # per student per session


# ═══════════════════════════════════════════════════════════════════════
# POST /api/face/verify
# ═══════════════════════════════════════════════════════════════════════

@router.post("/verify")
@limiter.limit("10/minute")
def face_verify(
    session_id:   Annotated[int, Form()],
    image:        Annotated[UploadFile, File(description="Student selfie (JPEG/PNG, max 6 MB)")],
    request:      Request,
    current_user: dict    = Depends(student_only),
    db:           Session = Depends(get_db),
):
    """
    Student submits a selfie to prove identity before scanning the QR code.

    On success: issues a short-lived face_verify_token (60 s) tied to the session.
    On failure: logs to attendance_audit and returns a descriptive reason.
    Rate limit: 5 attempts per student per session.
    """
    student_id = current_user["id"]
    now        = datetime.now(tz=timezone.utc)

    logger.info("🙍 FACE VERIFY attempt │ student_id=%d │ session_id=%d", student_id, session_id)

    # ── 1. Load and validate the attendance session ───────────────────
    session: Optional[AttendanceSession] = (
        db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    )
    if not session or session.status != SessionStatus.active:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Attendance session not found or is no longer active.",
        )

    # ── 2. Verify student is enrolled in the subject's course/semester ─
    student: User = db.query(User).filter(User.id == student_id).first()
    subject: Subject = db.query(Subject).filter(Subject.id == session.subject_id).first()

    if (
        not student
        or student.course_id != subject.course_id
        or student.semester != subject.semester
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not enrolled in this subject.",
        )

    # ── 3. Rate limit: count prior failed face-verify attempts ────────
    prior_attempts = (
        db.query(AttendanceAudit)
        .filter(
            AttendanceAudit.session_id == session_id,
            AttendanceAudit.student_id == student_id,
            AttendanceAudit.result     == AuditResult.failed,
        )
        .count()
    )
    logger.info("🙍 FACE VERIFY │ student_id=%d │ prior_failed_attempts=%d/%d",
                student_id, prior_attempts, _MAX_VERIFY_ATTEMPTS)
    if prior_attempts >= _MAX_VERIFY_ATTEMPTS:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Maximum face verification attempts reached for this session. "
            "Contact your teacher or HOD.",
        )

    # ── 4. Validate uploaded image ────────────────────────────────────
    if image.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Invalid file type '{image.content_type}'. Only JPEG/PNG are accepted.",
        )
    image_bytes = image.file.read()
    if len(image_bytes) > _MAX_FACE_IMAGE_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Image too large ({len(image_bytes) // (1024*1024)} MB). Maximum is 6 MB.",
        )

    # ── 5. Azure Face verification ────────────────────────────────────
    logger.info("🙍 FACE VERIFY │ student_id=%d │ calling Azure Face API (image=%d bytes)",
                student_id, len(image_bytes))
    result = verify_student_face(student_id, image_bytes, db)
    confidence = result.get("confidence", 0.0)
    logger.info("🙍 FACE VERIFY │ student_id=%d │ result: verified=%s │ confidence=%.2f%% │ reason=%s",
                student_id, result.get("verified"), confidence * 100,
                result.get("reason", "match"))

    # ── 6. Log audit record regardless of outcome ─────────────────────
    ip_address = (
        request.headers.get("X-Forwarded-For", request.client.host).split(",")[0].strip()
        if request.client else None
    )
    audit = AttendanceAudit(
        session_id      = session_id,
        student_id      = student_id,
        attempt_at      = now,
        result          = AuditResult.success if result.get("verified") else AuditResult.failed,
        failure_reason  = None if result.get("verified") else result.get("reason"),
        face_confidence = confidence,
        ip_address      = ip_address,
    )
    db.add(audit)
    db.commit()

    # ── 7. Return result ──────────────────────────────────────────────
    if result.get("verified"):
        face_token = create_face_verify_token(student_id, session_id, db)
        logger.info("✅ FACE VERIFY success │ student_id=%d │ session_id=%d │ confidence=%.2f%% │ token issued",
                    student_id, session_id, confidence * 100)
        return {
            "verified":   True,
            "confidence": confidence,
            "face_token": face_token,
            "expires_in": 60,
            "message":    "Face verified! Now scan the QR code.",
        }

    return {
        "verified":   False,
        "confidence": confidence,
        "reason":     result.get("reason", "Face not matched. Try again."),
        "message":    "Ensure good lighting and face the camera directly.",
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/face/enrollment-status/{student_id}
# ═══════════════════════════════════════════════════════════════════════

@router.get("/enrollment-status/{student_id}")
def enrollment_status(
    student_id:   int,
    current_user: dict    = Depends(any_authenticated),
    db:           Session = Depends(get_db),
):
    """
    Return face enrollment status for a student.
    Student can only view their own status; HOD/Principal can view any student in their college.
    azure_person_id is masked (last 4 chars only).
    """
    logger.info("🙍 ENROLLMENT STATUS │ student_id=%d │ requested by user_id=%d",
                student_id, current_user["id"])
    caller_id   = current_user["id"]
    caller_role = current_user["role"]
    is_hod      = caller_role in {"hod", "principal"}
    is_self     = (caller_id == student_id and caller_role == "student")

    if not is_hod and not is_self:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You can only view your own enrollment status.",
        )

    student: Optional[User] = db.query(User).filter(User.id == student_id).first()
    if not student or not student.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    # HOD boundary check
    if is_hod and student.college_id != current_user["college_id"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You can only view students in your own college.",
        )

    masked_pid = None
    if student.azure_person_id:
        pid = student.azure_person_id.replace("-", "")
        masked_pid = "****" + pid[-4:]

    return {
        "face_enrolled":   student.face_enrolled,
        "enrolled_at":     student.face_enrolled_at,
        "azure_person_id": masked_pid,
    }


# ═══════════════════════════════════════════════════════════════════════
# POST /api/face/liveness-session
# ═══════════════════════════════════════════════════════════════════════

@router.post("/liveness-session")
def liveness_session(
    current_user: dict    = Depends(student_only),
    db:           Session = Depends(get_db),
):
    """
    Generate a random liveness challenge for the student.
    The challenge is single-use and expires in 30 seconds.

    Supported challenges: blink, smile, turn_left, turn_right, open_mouth

    Returns: {challenge_id, challenge, expires_in: 30}
    """
    result = create_liveness_challenge(current_user["id"], db)
    if "error" in result:
        logger.warning("🧐 LIVENESS challenge failed │ student_id=%d │ error=%s",
                       current_user["id"], result["error"])
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, result["error"])
    logger.info("🧐 LIVENESS challenge created │ student_id=%d │ challenge=%s",
                current_user["id"], result.get("challenge", "unknown"))
    return result


# ═══════════════════════════════════════════════════════════════════════
# POST /api/face/liveness-verify
# ═══════════════════════════════════════════════════════════════════════

@router.post("/liveness-verify")
def liveness_verify(
    challenge_id: Annotated[int, Form()],
    frame1:       Annotated[UploadFile, File(description="Frame before challenge action")],
    frame2:       Annotated[UploadFile, File(description="Frame during challenge action")],
    frame3:       Annotated[UploadFile, File(description="Frame after challenge action")],
    current_user: dict    = Depends(student_only),
    db:           Session = Depends(get_db),
):
    """
    Verify 3 frames captured during the liveness challenge.

    Frame sequence:
      frame1 — before performing action (neutral face)
      frame2 — during challenge (peak of action)
      frame3 — after challenge (returning to neutral)

    Returns: {liveness_confirmed: bool, reason: str}
    """
    logger.info("🧐 LIVENESS verify attempt │ student_id=%d │ challenge_id=%d",
                current_user["id"], challenge_id)

    # Verify the challenge belongs to this student
    challenge_record: Optional[LivenessChallenge] = (
        db.query(LivenessChallenge)
        .filter(LivenessChallenge.id == challenge_id)
        .first()
    )
    if not challenge_record or challenge_record.student_id != current_user["id"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Liveness challenge not found or does not belong to you.",
        )

    frames: list[bytes] = []
    for i, upload in enumerate([frame1, frame2, frame3], start=1):
        if upload.content_type not in _ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Frame {i}: invalid file type '{upload.content_type}'. Only JPEG/PNG.",
            )
        frame_bytes = upload.file.read()
        if len(frame_bytes) > _MAX_FACE_IMAGE_BYTES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Frame {i} too large ({len(frame_bytes) // (1024*1024)} MB). Maximum is 6 MB.",
            )
        frames.append(frame_bytes)

    result = verify_liveness_frames(challenge_id, frames, db)
    logger.info("🧐 LIVENESS verify result │ student_id=%d │ confirmed=%s │ reason=%s",
                current_user["id"], result.get("liveness_confirmed"), result.get("reason", "N/A"))
    return result
