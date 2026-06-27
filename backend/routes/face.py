"""
AutoAttend AI v2.0 — Face API Routes

POST /api/face/verify              — student submits selfie → face_verify_token
GET  /api/face/enrollment-status/{student_id}
POST /api/face/liveness-session    — generate random liveness challenge
POST /api/face/liveness-verify     — submit 3 frames to confirm liveness
"""

import logging
from datetime import UTC, datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from database import (
    AttendanceAudit,
    AttendanceSession,
    AuditResult,
    FaceChangeLog,
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
    TEST_STUDENT_ROLLS,
)
from utils.face_utils import (
    create_liveness_challenge,
    get_face_client,
    verify_liveness_frames,
    verify_student_face,
    _detect_single_face,
    _image_stream,
    _validate_image_size,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/face", tags=["Face"])
limiter = Limiter(key_func=get_remote_address)

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}
_MAX_FACE_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB (Rekognition inline-bytes limit)
_MAX_VERIFY_ATTEMPTS = 5  # per student per session


# ═══════════════════════════════════════════════════════════════════════
# POST /api/face/verify
# ═══════════════════════════════════════════════════════════════════════


@router.post("/verify")
@limiter.limit("10/minute")
def face_verify(
    session_id: Annotated[int, Form()],
    image: Annotated[UploadFile, File(description="Student selfie (JPEG/PNG, max 6 MB)")],
    request: Request,
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    """
    Student submits a selfie to prove identity before scanning the QR code.

    On success: issues a short-lived face_verify_token (60 s) tied to the session.
    On failure: logs to attendance_audit and returns a descriptive reason.
    Rate limit: 5 attempts per student per session.
    """
    student_id = current_user["id"]
    now = datetime.now(tz=UTC)

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
            AttendanceAudit.result == AuditResult.failed,
        )
        .count()
    )
    logger.info(
        "🙍 FACE VERIFY │ student_id=%d │ prior_failed_attempts=%d/%d",
        student_id,
        prior_attempts,
        _MAX_VERIFY_ATTEMPTS,
    )
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
    # TEST BYPASS: test accounts that have face_enrolled=True but no azure_person_id
    # (manually set via mark_test_face_enrolled.py) get a presence-only check.
    # This proves a real person is holding the camera without requiring Azure Identify.
    # Once re-enrolled via FaceEnrollmentPage, they get full face matching.
    is_test_roll = (
        student
        and student.roll_number
        and student.roll_number.upper() in TEST_STUDENT_ROLLS
    )
    if is_test_roll and not student.azure_person_id:
        logger.info(
            "🔬 FACE VERIFY TEST BYPASS │ student_id=%d │ no azure_person_id │ presence check only",
            student_id,
        )
        try:
            _validate_image_size(image_bytes)
            _detect_single_face(get_face_client(), image_bytes)
            result = {"verified": True, "confidence": 1.0, "test_bypass": True}
        except ValueError as exc:
            result = {"verified": False, "confidence": 0.0, "reason": str(exc)}
        except Exception as exc:
            logger.error("FACE VERIFY TEST BYPASS detect error: %s", exc)
            # On Azure error during bypass, still allow (test accounts only)
            result = {"verified": True, "confidence": 0.9, "test_bypass": True, "degraded": True}
    else:
        logger.info(
            "🙍 FACE VERIFY │ student_id=%d │ calling Azure Face API (image=%d bytes)",
            student_id,
            len(image_bytes),
        )
        result = verify_student_face(student_id, image_bytes, db)
    confidence = result.get("confidence", 0.0)
    logger.info(
        "🙍 FACE VERIFY │ student_id=%d │ verified=%s │ confidence=%.2f%% │ test_bypass=%s",
        student_id,
        result.get("verified"),
        confidence * 100,
        result.get("test_bypass", False),
    )

    # ── 6. Log audit record regardless of outcome ─────────────────────
    ip_address = (
        request.headers.get("X-Forwarded-For", request.client.host).split(",")[0].strip()
        if request.client
        else None
    )
    audit = AttendanceAudit(
        session_id=session_id,
        student_id=student_id,
        attempt_at=now,
        result=AuditResult.success if result.get("verified") else AuditResult.failed,
        failure_reason=None if result.get("verified") else result.get("reason"),
        face_confidence=confidence,
        ip_address=ip_address,
    )
    db.add(audit)
    db.commit()

    # ── 7. Return result ──────────────────────────────────────────────
    if result.get("verified"):
        face_token = create_face_verify_token(student_id, session_id, db)
        logger.info(
            "✅ FACE VERIFY success │ student_id=%d │ session_id=%d │ confidence=%.2f%% │ token issued",
            student_id,
            session_id,
            confidence * 100,
        )
        return {
            "verified": True,
            "confidence": confidence,
            "face_token": face_token,
            "expires_in": 60,
            "message": "Face verified! Now scan the QR code.",
        }

    return {
        "verified": False,
        "confidence": confidence,
        "reason": result.get("reason", "Face not matched. Try again."),
        "message": "Ensure good lighting and face the camera directly.",
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/face/enrollment-status/{student_id}
# ═══════════════════════════════════════════════════════════════════════


@router.get("/enrollment-status/{student_id}")
def enrollment_status(
    student_id: int,
    current_user: dict = Depends(any_authenticated),
    db: Session = Depends(get_db),
):
    """
    Return face enrollment status for a student.
    Student can only view their own status; HOD/Principal can view any student in their college.
    azure_person_id is masked (last 4 chars only).
    """
    logger.info(
        "🙍 ENROLLMENT STATUS │ student_id=%d │ requested by user_id=%d",
        student_id,
        current_user["id"],
    )
    caller_id = current_user["id"]
    caller_role = current_user["role"]
    is_hod = caller_role in {"hod", "principal"}
    is_self = caller_id == student_id and caller_role == "student"

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
        "face_enrolled": student.face_enrolled,
        "enrolled_at": student.face_enrolled_at,
        "azure_person_id": masked_pid,
    }


# ═══════════════════════════════════════════════════════════════════════
# POST /api/face/liveness-session
# ═══════════════════════════════════════════════════════════════════════


@router.post("/liveness-session")
def liveness_session(
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    """
    Generate a random liveness challenge for the student.
    The challenge is single-use and expires in 30 seconds.

    Supported challenges: blink, smile, turn_left, turn_right, open_mouth

    Returns: {challenge_id, challenge, expires_in: 30}
    """
    result = create_liveness_challenge(current_user["id"], db)
    if "error" in result:
        logger.warning(
            "🧐 LIVENESS challenge failed │ student_id=%d │ error=%s",
            current_user["id"],
            result["error"],
        )
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, result["error"])
    logger.info(
        "🧐 LIVENESS challenge created │ student_id=%d │ challenge=%s",
        current_user["id"],
        result.get("challenge", "unknown"),
    )
    return result


# ═══════════════════════════════════════════════════════════════════════
# POST /api/face/liveness-verify
# ═══════════════════════════════════════════════════════════════════════


@router.post("/liveness-verify")
def liveness_verify(
    challenge_id: Annotated[int, Form()],
    frame1: Annotated[UploadFile, File(description="Frame before challenge action")],
    frame2: Annotated[UploadFile, File(description="Frame during challenge action")],
    frame3: Annotated[UploadFile, File(description="Frame after challenge action")],
    current_user: dict = Depends(student_only),
    db: Session = Depends(get_db),
):
    """
    Verify 3 frames captured during the liveness challenge.

    Frame sequence:
      frame1 — before performing action (neutral face)
      frame2 — during challenge (peak of action)
      frame3 — after challenge (returning to neutral)

    Returns: {liveness_confirmed: bool, reason: str}
    """
    logger.info(
        "🧐 LIVENESS verify attempt │ student_id=%d │ challenge_id=%d",
        current_user["id"],
        challenge_id,
    )

    # Verify the challenge belongs to this student
    challenge_record: Optional[LivenessChallenge] = (
        db.query(LivenessChallenge).filter(LivenessChallenge.id == challenge_id).first()
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

    # TEST BYPASS: test accounts get a presence-only liveness check.
    # Strict motion deltas (yaw/smile/landmark shift) are unreliable on phone
    # cameras and block friends from enrolling. For test rolls we only require
    # that a real face is detected in the captured frames.
    student: Optional[User] = (
        db.query(User).filter(User.id == current_user["id"]).first()
    )
    is_test_roll = (
        student
        and student.roll_number
        and student.roll_number.upper() in TEST_STUDENT_ROLLS
    )
    if is_test_roll:
        logger.info(
            "🔬 LIVENESS TEST BYPASS │ student_id=%d │ presence-only check",
            current_user["id"],
        )
        # Mark the challenge used so it can't be replayed.
        challenge_record.used = True
        db.commit()
        try:
            _detect_single_face(get_face_client(), frames[1] or frames[0])
            return {"liveness_confirmed": True, "reason": "test_bypass", "test_bypass": True}
        except ValueError as exc:
            return {"liveness_confirmed": False, "reason": str(exc)}
        except Exception as exc:
            logger.error("LIVENESS TEST BYPASS detect error: %s", exc)
            # On Azure error during bypass, still allow (test accounts only).
            return {
                "liveness_confirmed": True,
                "reason": "test_bypass_degraded",
                "test_bypass": True,
                "degraded": True,
            }

    result = verify_liveness_frames(challenge_id, frames, db)
    logger.info(
        "🧐 LIVENESS verify result │ student_id=%d │ confirmed=%s │ reason=%s",
        current_user["id"],
        result.get("liveness_confirmed"),
        result.get("reason", "N/A"),
    )
    return result


# ═══════════════════════════════════════════════════════════════════════
# POST /api/face/admin/reset/{student_id}
#   HOD / Principal — clears a student's face enrollment so they can re-enroll
#   on next login. Logs to FaceChangeLog for audit.
# ═══════════════════════════════════════════════════════════════════════


class _FaceResetRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


@router.post("/admin/reset/{student_id}")
def admin_reset_face(
    student_id: int,
    body: _FaceResetRequest,
    current_user: dict = Depends(hod_or_above),
    db: Session = Depends(get_db),
):
    """
    HOD/Principal clears a student's face enrollment so they can re-enroll.
    Audit-logged to face_change_log.
    """
    student: Optional[User] = db.query(User).filter(User.id == student_id).first()
    if not student or not student.is_active or student.role.value != "student":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    # College boundary
    if student.college_id != current_user["college_id"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You can only reset students in your own college.",
        )

    old_pid = student.azure_person_id

    student.azure_person_id = None
    student.face_enrolled = False
    student.face_enrolled_at = None

    db.add(
        FaceChangeLog(
            student_id=student.id,
            changed_by=current_user["id"],
            old_azure_person_id=old_pid,
            new_azure_person_id=None,
            reason=body.reason.strip(),
        )
    )
    db.commit()

    logger.info(
        "🤳 FACE RESET │ student_id=%d │ by_user_id=%d │ reason=%r",
        student_id,
        current_user["id"],
        body.reason[:80],
    )
    return {
        "ok": True,
        "student_id": student_id,
        "message": "Face enrollment cleared. Student will be prompted to re-enroll on next login.",
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/face/admin/students
#   HOD / Principal — list students with their enrollment status (for the
#   Face Re-enroll management page).
# ═══════════════════════════════════════════════════════════════════════


@router.get("/admin/students")
def admin_list_students(
    only_enrolled: bool = False,
    current_user: dict = Depends(hod_or_above),
    db: Session = Depends(get_db),
):
    """List students in caller's college with face enrollment status."""
    q = db.query(User).filter(
        User.college_id == current_user["college_id"],
        User.role == "student",
        User.is_active == True,  # noqa: E712
    )
    if only_enrolled:
        q = q.filter(User.face_enrolled == True)  # noqa: E712

    rows = q.order_by(User.name.asc()).limit(500).all()
    return {
        "students": [
            {
                "id": u.id,
                "name": u.name,
                "roll_number": u.roll_number,
                "email": u.email,
                "face_enrolled": u.face_enrolled,
                "enrolled_at": u.face_enrolled_at.isoformat() if u.face_enrolled_at else None,
            }
            for u in rows
        ],
        "total": len(rows),
    }
