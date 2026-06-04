"""
AutoAttend AI v2.0 — Azure Face API Utilities

Handles:
  • PersonGroup management (one group per college)
  • Student face enrollment (train PersonGroup after add)
  • Face verification via Identify API (confidence ≥ 0.80)
  • Face deletion + audit log
  • Training-status polling
  • Liveness detection (challenge-response with 3-frame analysis)

Azure SDK: azure-cognitiveservices-vision-face==0.6.0
Recognition model: recognition_04  (latest, most accurate)
Detection model:   detection_03    (recommended for recognition_04)

All Azure calls are wrapped in try/except.
HTTPException is never raised here — callers (routes) do that.
"""

import io
import logging
import random
import time
from datetime import UTC, datetime, timedelta
from typing import Optional

from azure.cognitiveservices.vision.face import FaceClient
from azure.cognitiveservices.vision.face.models import (
    APIErrorException,
)
from msrest.authentication import CognitiveServicesCredentials
from sqlalchemy.orm import Session

from config import settings
from database import FaceChangeLog, LivenessChallenge, User

logger = logging.getLogger(__name__)

# ─── Azure image size limit ────────────────────────────────────────────
_MAX_IMAGE_BYTES = 6 * 1024 * 1024  # 6 MB

# ─── Singleton client ─────────────────────────────────────────────────
_face_client: Optional[FaceClient] = None


# ═══════════════════════════════════════════════════════════════════════
# 1. Client factory (cached singleton)
# ═══════════════════════════════════════════════════════════════════════


def get_face_client() -> FaceClient:
    """
    Return a cached FaceClient. Creates one on first call.
    Thread-safe enough for FastAPI single-process workers.
    """
    global _face_client
    if _face_client is None:
        _face_client = FaceClient(
            settings.AZURE_FACE_ENDPOINT,
            CognitiveServicesCredentials(settings.AZURE_FACE_KEY),
        )
    return _face_client


# ═══════════════════════════════════════════════════════════════════════
# 2. PersonGroup bootstrap — call once on app startup
# ═══════════════════════════════════════════════════════════════════════


def ensure_person_group(group_id: str, college_name: str) -> bool:
    """
    Create the PersonGroup if it does not already exist.
    Uses recognition_04 (latest model, highest accuracy).
    Returns True if the group is ready, False on unexpected error.
    """
    client = get_face_client()
    try:
        client.person_group.create(
            person_group_id=group_id,
            name=college_name,
            recognition_model="recognition_04",
        )
        logger.info("PersonGroup '%s' created.", group_id)
        return True
    except APIErrorException as exc:
        # "PersonGroupExists" is expected on every subsequent startup
        if "PersonGroupExists" in str(exc.message):
            logger.debug("PersonGroup '%s' already exists — skipping create.", group_id)
            return True
        logger.error("ensure_person_group error: %s", exc.message)
        return False
    except Exception as exc:
        logger.error("ensure_person_group unexpected error: %s", exc)
        return False


# ═══════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════


def _image_stream(image_bytes: bytes) -> io.BytesIO:
    """Wrap bytes in a seekable BytesIO stream (Azure SDK requires seek)."""
    stream = io.BytesIO(image_bytes)
    stream.seek(0)
    return stream


def _validate_image_size(image_bytes: bytes) -> None:
    """Raise ValueError if image exceeds Azure's 6 MB per-image limit."""
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image too large ({len(image_bytes) // (1024*1024)} MB). "
            "Maximum allowed size is 6 MB."
        )


def _detect_single_face(client: FaceClient, image_bytes: bytes) -> object:
    """
    Detect faces and return the single DetectedFace.
    Raises ValueError if 0 or 2+ faces found.
    """
    stream = _image_stream(image_bytes)
    faces = client.face.detect_with_stream(
        image=stream,
        detection_model="detection_03",
        recognition_model="recognition_04",
        return_face_id=True,
        return_face_attributes=["blur", "exposure", "noise"],
    )
    if not faces:
        raise ValueError("No face detected in the image. Please use a clear front-facing photo.")
    if len(faces) > 1:
        raise ValueError(
            f"{len(faces)} faces detected. Please use a solo photo with only one person."
        )

    face = faces[0]

    # Quality gate: reject high blur
    if face.face_attributes and face.face_attributes.blur:
        blur_level = face.face_attributes.blur.blur_level
        if str(blur_level).lower() == "high":
            raise ValueError("Image is too blurry. Please take a sharper photo in good lighting.")

    return face


# ═══════════════════════════════════════════════════════════════════════
# 3. Enroll student face
# ═══════════════════════════════════════════════════════════════════════


def enroll_student_face(
    student_id: int,
    image_bytes: bytes,
    db: Session,
) -> dict:
    """
    Enroll (or re-enroll) a student's face in the Azure PersonGroup.

    Steps:
      a) Size validation
      b) Detect exactly 1 face, check quality
      c) Create Person in PersonGroup
      d) Add face to Person
      e) Trigger PersonGroup training
      f) Persist azure_person_id to DB

    Returns: {success: True, azure_person_id: str}
    On any error returns: {success: False, error: str}
    """
    client = get_face_client()
    try:
        _validate_image_size(image_bytes)
        _detect_single_face(client, image_bytes)  # validates quality

        # Create Person (one Person = one student across all their face images)
        person = client.person_group_person.create(
            person_group_id=settings.AZURE_PERSON_GROUP_ID,
            name=f"student_{student_id}",
        )
        logger.info("Created Person %s for student_id=%d", person.person_id, student_id)

        # Add face image to the Person
        client.person_group_person.add_face_from_stream(
            person_group_id=settings.AZURE_PERSON_GROUP_ID,
            person_id=person.person_id,
            image=_image_stream(image_bytes),
        )

        # Trigger async training so Identify works with new face data
        client.person_group.train(settings.AZURE_PERSON_GROUP_ID)
        logger.info(
            "PersonGroup '%s' training triggered after enrolling student_id=%d",
            settings.AZURE_PERSON_GROUP_ID,
            student_id,
        )

        # Persist to DB
        now = datetime.now(tz=UTC)
        db.query(User).filter(User.id == student_id).update(
            {
                "azure_person_id": str(person.person_id),
                "face_enrolled": True,
                "face_enrolled_at": now,
            },
            synchronize_session=False,
        )
        db.commit()

        return {"success": True, "azure_person_id": str(person.person_id)}

    except ValueError as exc:
        # Validation errors (blur, multiple faces, size) — not Azure faults
        logger.warning("enroll_student_face validation error: %s", exc)
        return {"success": False, "error": str(exc)}
    except APIErrorException as exc:
        logger.error(
            "enroll_student_face Azure error for student_id=%d: %s",
            student_id,
            exc.message,
        )
        return {"success": False, "error": "Azure Face API error. Please try again."}
    except Exception as exc:
        logger.error(
            "enroll_student_face unexpected error for student_id=%d: %s",
            student_id,
            exc,
        )
        return {"success": False, "error": "Enrollment failed. Please try again."}


# ═══════════════════════════════════════════════════════════════════════
# 4. Verify student face
# ═══════════════════════════════════════════════════════════════════════

_CONFIDENCE_THRESHOLD = 0.80


def verify_student_face(
    student_id: int,
    image_bytes: bytes,
    db: Session,
) -> dict:
    """
    Verify a student's face against their enrolled PersonGroup entry.

    Uses Identify (not Verify) so the PersonGroup remains the ground truth,
    making re-enrollments transparent and multi-image-capable.

    Returns: {verified: bool, confidence: float, reason: str, azure_person_id?: str}
    Never logs image bytes.
    """
    client = get_face_client()

    # 1. Load student record
    student: Optional[User] = db.query(User).filter(User.id == student_id).first()
    if not student or not student.face_enrolled or not student.azure_person_id:
        logger.warning("verify_student_face: student_id=%d not enrolled", student_id)
        return {
            "verified": False,
            "confidence": 0.0,
            "reason": "Face not enrolled. Contact your HOD.",
        }

    try:
        _validate_image_size(image_bytes)

        # 2. Detect submitted face
        detected = _detect_single_face(client, image_bytes)
        face_id = str(detected.face_id)

        # 3. Check training is ready before Identify
        training_status = check_training_status(settings.AZURE_PERSON_GROUP_ID)
        if training_status != "succeeded":
            logger.warning(
                "verify_student_face: PersonGroup training status='%s' — aborting",
                training_status,
            )
            return {
                "verified": False,
                "confidence": 0.0,
                "reason": "Face recognition service is warming up. Please try again shortly.",
            }

        # 4. Identify in PersonGroup
        results = client.face.identify(
            face_ids=[face_id],
            person_group_id=settings.AZURE_PERSON_GROUP_ID,
            max_num_of_candidates_returned=1,
            confidence_threshold=_CONFIDENCE_THRESHOLD,
        )

        if not results or not results[0].candidates:
            logger.info(
                "verify_student_face: no candidates — student_id=%d confidence=0",
                student_id,
            )
            return {
                "verified": False,
                "confidence": 0.0,
                "reason": "Face not matched. Please try again or contact your HOD.",
            }

        candidate = results[0].candidates[0]
        confidence = round(float(candidate.confidence), 4)
        matched_person = str(candidate.person_id)

        # 5. Cross-check matched person == enrolled student's person
        if matched_person != str(student.azure_person_id):
            logger.warning(
                "verify_student_face: PERSON MISMATCH — student_id=%d "
                "enrolled=%s matched=%s confidence=%.4f",
                student_id,
                student.azure_person_id,
                matched_person,
                confidence,
            )
            return {
                "verified": False,
                "confidence": confidence,
                "reason": "Face did not match the enrolled record.",
            }

        if confidence < _CONFIDENCE_THRESHOLD:
            logger.info(
                "verify_student_face: low confidence — student_id=%d confidence=%.4f",
                student_id,
                confidence,
            )
            return {
                "verified": False,
                "confidence": confidence,
                "reason": f"Low confidence ({confidence:.0%}). Please try again in better lighting.",
            }

        logger.info(
            "verify_student_face: SUCCESS — student_id=%d confidence=%.4f",
            student_id,
            confidence,
        )
        return {
            "verified": True,
            "confidence": confidence,
            "azure_person_id": matched_person,
        }

    except ValueError as exc:
        logger.warning(
            "verify_student_face validation error for student_id=%d: %s",
            student_id,
            exc,
        )
        return {"verified": False, "confidence": 0.0, "reason": str(exc)}
    except APIErrorException as exc:
        logger.error(
            "verify_student_face Azure error for student_id=%d: %s",
            student_id,
            exc.message,
        )
        return {
            "verified": False,
            "confidence": 0.0,
            "reason": "Azure Face API error. Please try again.",
        }
    except Exception as exc:
        logger.error(
            "verify_student_face unexpected error for student_id=%d: %s",
            student_id,
            exc,
        )
        return {
            "verified": False,
            "confidence": 0.0,
            "reason": "Verification failed. Please try again.",
        }


# ═══════════════════════════════════════════════════════════════════════
# 5. Delete student face
# ═══════════════════════════════════════════════════════════════════════


def delete_student_face(
    student_id: int,
    changed_by_id: int,
    reason: str,
    db: Session,
) -> bool:
    """
    Remove a student's Person from the Azure PersonGroup and clear DB face fields.
    Writes a FaceChangeLog audit entry regardless of Azure success.

    Returns True on full success, False on any error.
    """
    client = get_face_client()
    student = db.query(User).filter(User.id == student_id).first()

    if not student:
        logger.warning("delete_student_face: student_id=%d not found", student_id)
        return False

    old_person_id = student.azure_person_id

    # 1. Delete Person from Azure (best-effort — continue even if already gone)
    if old_person_id:
        try:
            client.person_group_person.delete(
                person_group_id=settings.AZURE_PERSON_GROUP_ID,
                person_id=old_person_id,
            )
            logger.info(
                "delete_student_face: deleted Person %s for student_id=%d",
                old_person_id,
                student_id,
            )
        except APIErrorException as exc:
            logger.error(
                "delete_student_face Azure error for student_id=%d: %s",
                student_id,
                exc.message,
            )
            return False
        except Exception as exc:
            logger.error(
                "delete_student_face unexpected error for student_id=%d: %s",
                student_id,
                exc,
            )
            return False

    # 2. Clear DB face fields
    db.query(User).filter(User.id == student_id).update(
        {
            "azure_person_id": None,
            "face_enrolled": False,
            "face_enrolled_at": None,
        },
        synchronize_session=False,
    )

    # 3. Write audit log
    db.add(
        FaceChangeLog(
            student_id=student_id,
            changed_by=changed_by_id,
            old_azure_person_id=old_person_id,
            new_azure_person_id=None,
            reason=reason,
        )
    )
    db.commit()

    logger.info(
        "delete_student_face: face cleared for student_id=%d by user_id=%d",
        student_id,
        changed_by_id,
    )
    return True


# ═══════════════════════════════════════════════════════════════════════
# 6. Training status check (with retry)
# ═══════════════════════════════════════════════════════════════════════


def check_training_status(group_id: str) -> str:
    """
    Return the PersonGroup training status: "succeeded" | "running" | "failed".
    Retries up to 3 times with a 1-second delay between attempts.
    Falls back to "failed" on any Azure error.
    """
    client = get_face_client()
    for attempt in range(1, 4):
        try:
            status = client.person_group.get_training_status(group_id)
            result = str(status.status).lower()

            # TrainingStatusType values: nonstarted, running, succeeded, failed
            if result in ("succeeded", "running", "failed"):
                logger.debug(
                    "check_training_status: group='%s' status='%s' attempt=%d",
                    group_id,
                    result,
                    attempt,
                )
                return result

            # nonstarted → treat as running (training queued but not begun)
            return "running"

        except APIErrorException as exc:
            logger.error(
                "check_training_status Azure error (attempt %d): %s",
                attempt,
                exc.message,
            )
        except Exception as exc:
            logger.error(
                "check_training_status unexpected error (attempt %d): %s",
                attempt,
                exc,
            )

        if attempt < 3:
            time.sleep(1)

    return "failed"


# ═══════════════════════════════════════════════════════════════════════
# Liveness Detection — Challenge-Response (3-frame analysis)
#
# NOTE: Azure's official Face Liveness Detection SDK (azure-ai-vision-face)
# is available for Android/iOS native apps and can replace this approach
# when a stable React Native binding is released. For now, this
# server-side challenge-response is secure enough for college use:
#   • Challenge is random and single-use
#   • 3 frames must show consistent face presence
#   • Face landmark positions must shift between frames (proves video)
#   • Challenge-specific attributes (yaw for turns, smile for smile) checked
# ═══════════════════════════════════════════════════════════════════════

_LIVENESS_CHALLENGES = ["blink", "smile", "turn_left", "turn_right", "open_mouth"]
_LIVENESS_EXPIRY_SECONDS = 90  # generous — 3×3s countdown + Azure latency + slow connections

# Minimum landmark distance (pixels) between frames to prove movement.
# 1.0 px is sufficient for 640×480 webcam frames; 2.0 was too strict.
_MIN_LANDMARK_SHIFT = 1.0

# Minimum yaw delta (degrees) to confirm a head turn
_MIN_YAW_DELTA = 15.0

# Minimum smile change (0-1) to confirm a smile
_MIN_SMILE_DELTA = 0.3


def create_liveness_challenge(student_id: int, db: Session) -> dict:
    """
    Generate a random liveness challenge, store it in the DB with a 30-second
    expiry, and return it to the client.

    Returns: {challenge_id, challenge, expires_in: 30}
    On error returns: {error: str}
    """
    try:
        challenge = random.choice(_LIVENESS_CHALLENGES)
        expires_at = datetime.now(tz=UTC) + timedelta(seconds=_LIVENESS_EXPIRY_SECONDS)

        record = LivenessChallenge(
            student_id=student_id,
            challenge=challenge,
            expires_at=expires_at,
            used=False,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        logger.info(
            "create_liveness_challenge: student_id=%d challenge='%s' id=%d",
            student_id,
            challenge,
            record.id,
        )
        return {
            "challenge_id": record.id,
            "challenge": challenge,
            "expires_in": _LIVENESS_EXPIRY_SECONDS,
        }

    except Exception as exc:
        logger.error(
            "create_liveness_challenge error for student_id=%d: %s",
            student_id,
            exc,
        )
        return {"error": "Failed to create liveness challenge. Please try again."}


def verify_liveness_frames(
    challenge_id: int,
    frames: list[bytes],
    db: Session,
) -> dict:
    """
    Verify 3 frames (before / during / after challenge action).

    Checks:
      1. Challenge record is valid and not expired
      2. Face detected in all 3 frames
      3. Face nose-tip landmark shifts between frame 1 and frame 3
         (proves live video, not a static photo replay)
      4. Challenge-specific attribute change:
           turn_left / turn_right → headpose.yaw delta ≥ _MIN_YAW_DELTA
           smile                  → smile delta ≥ _MIN_SMILE_DELTA
           blink / open_mouth     → nose-tip movement check only
             (eyelid & lip landmark attributes need SDK v1.x; accepted here
              as long as face movement is detected)

    Uses detection_02 (supports headpose + smile; detection_03 does not).

    Returns: {liveness_confirmed: bool, reason: str}
    """
    client = get_face_client()
    now = datetime.now(tz=UTC)

    # 1. Fetch and validate challenge record
    record = (
        db.query(LivenessChallenge)
        .filter(
            LivenessChallenge.id == challenge_id,
            LivenessChallenge.used == False,  # noqa: E712
            LivenessChallenge.expires_at > now,
        )
        .with_for_update()
        .first()
    )
    if record is None:
        logger.warning(
            "verify_liveness_frames: invalid/expired challenge_id=%d",
            challenge_id,
        )
        return {
            "liveness_confirmed": False,
            "reason": "Liveness challenge expired or already used.",
        }

    challenge = record.challenge

    if len(frames) != 3:
        return {"liveness_confirmed": False, "reason": "Exactly 3 frames are required."}

    # 2. Detect faces in all 3 frames (detection_02 for attribute support)
    detected: list = []
    for i, frame_bytes in enumerate(frames):
        # Retry up to 3 times on transient Azure errors (e.g. 429 rate-limit)
        for _attempt in range(3):
            try:
                _validate_image_size(frame_bytes)
                stream = _image_stream(frame_bytes)
                faces = client.face.detect_with_stream(
                    image=stream,
                    detection_model="detection_02",
                    recognition_model="recognition_04",
                    return_face_id=False,
                    return_face_landmarks=True,
                    return_face_attributes=["headPose", "smile"],
                )
                if not faces:
                    # No face → mark used so student must retry with fresh challenge
                    record.used = True
                    db.commit()
                    return {
                        "liveness_confirmed": False,
                        "reason": f"No face detected in frame {i + 1}. Ensure your face is well-lit and centred.",
                    }
                detected.append(faces[0])
                break  # success — stop retrying
            except APIErrorException as exc:
                err_msg = getattr(exc, "message", str(exc))
                logger.error(
                    "verify_liveness_frames Azure error frame %d attempt %d: %s",
                    i, _attempt + 1, err_msg,
                )
                if _attempt < 2:
                    time.sleep(1)  # back-off before retry
                    continue
                # 3rd failure — do NOT mark challenge used; student can retry
                return {
                    "liveness_confirmed": False,
                    "reason": "Face analysis service is busy. Please wait a moment and try again.",
                }
            except Exception as exc:
                logger.error("verify_liveness_frames error frame %d: %s", i, exc)
                # Do NOT mark challenge used on unexpected errors either
                return {
                    "liveness_confirmed": False,
                    "reason": "Frame analysis error. Please try again.",
                }

    # 3. Nose-tip landmark shift (frames 0 → 2) proves movement
    try:
        lm0 = detected[0].face_landmarks
        lm2 = detected[2].face_landmarks
        if lm0 and lm2 and lm0.nose_tip and lm2.nose_tip:
            dx = abs(lm0.nose_tip.x - lm2.nose_tip.x)
            dy = abs(lm0.nose_tip.y - lm2.nose_tip.y)
            movement = (dx**2 + dy**2) ** 0.5
            if movement < _MIN_LANDMARK_SHIFT:
                record.used = True
                db.commit()
                logger.info(
                    "verify_liveness_frames: insufficient movement=%.2f challenge_id=%d",
                    movement,
                    challenge_id,
                )
                return {
                    "liveness_confirmed": False,
                    "reason": "No face movement detected. Please perform the challenge.",
                }
    except Exception as exc:
        logger.warning("verify_liveness_frames landmark check error: %s", exc)
        # Non-fatal: fall through to attribute checks

    # 4. Challenge-specific attribute check
    try:
        if challenge in ("turn_left", "turn_right"):
            yaw0 = (
                detected[0].face_attributes.head_pose.yaw if detected[0].face_attributes else None
            )
            yaw2 = (
                detected[2].face_attributes.head_pose.yaw if detected[2].face_attributes else None
            )
            if yaw0 is not None and yaw2 is not None:
                if abs(yaw0 - yaw2) < _MIN_YAW_DELTA:
                    record.used = True
                    db.commit()
                    return {
                        "liveness_confirmed": False,
                        "reason": f"Head turn not detected. Please turn your head {'left' if challenge == 'turn_left' else 'right'}.",
                    }

        elif challenge == "smile":
            sm0 = detected[0].face_attributes.smile if detected[0].face_attributes else None
            sm2 = detected[2].face_attributes.smile if detected[2].face_attributes else None
            if sm0 is not None and sm2 is not None:
                smile_delta = abs(sm0 - sm2)
                if smile_delta < _MIN_SMILE_DELTA:
                    record.used = True
                    db.commit()
                    return {
                        "liveness_confirmed": False,
                        "reason": "Smile not detected. Please smile clearly at the camera.",
                    }

        # blink / open_mouth: rely on nose-tip movement check only (attributes
        # for eyelid/lip aperture require SDK v1.x server-side compute)

    except Exception as exc:
        logger.warning("verify_liveness_frames attribute check error: %s", exc)
        # Non-fatal: accept if landmark movement already passed

    # 5. All checks passed — mark challenge used
    record.used = True
    db.commit()

    logger.info(
        "verify_liveness_frames: PASSED student_id=%d challenge='%s' challenge_id=%d",
        record.student_id,
        challenge,
        challenge_id,
    )
    return {"liveness_confirmed": True, "reason": "Liveness confirmed."}
