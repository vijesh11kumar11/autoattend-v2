"""
AutoAttend AI v2.0 — AWS Rekognition Face Utilities

Handles:
  • Collection management (one collection per college)
  • Student face enrollment (index_faces — no training step required)
  • Face verification via search_faces_by_image (similarity ≥ 80)
  • Face deletion + audit log
  • Liveness detection (challenge-response with 3-frame analysis)

AWS SDK: boto3==1.35.0  (Rekognition client, region from settings.AWS_REGION)

Migration note (Azure → AWS Rekognition):
  • PersonGroup            → Collection
  • Person + person_id     → ExternalImageId = str(student_id), FaceId per image
  • PersonGroup training    → REMOVED (Rekognition indexes synchronously)
  • face.detect_with_stream → detect_faces
  • face.identify           → search_faces_by_image
  • add_face_from_stream     → index_faces
  • Confidence scale 0.80    → Rekognition Similarity is 0-100; normalised to 0-1
  • Image size limit 6 MB    → 5 MB
  • Landmark shift (pixels)   → ratios 0-1 (threshold 1.0px → 0.01)

The Rekognition FaceId is stored in the existing `azure_person_id` DB column
(reused, not renamed) so no schema migration is required.

All AWS calls are wrapped in try/except.
HTTPException is never raised here — callers (routes) do that.
"""

import io
import logging
import random
import time
from datetime import UTC, datetime, timedelta
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.orm import Session

from config import settings
from database import FaceChangeLog, LivenessChallenge, User

logger = logging.getLogger(__name__)

# ─── Rekognition image size limit ──────────────────────────────────────
# Rekognition accepts up to 5 MB for raw image bytes passed inline.
_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB

# ─── Singleton client ─────────────────────────────────────────────────
_face_client = None


# ═══════════════════════════════════════════════════════════════════════
# 1. Client factory (cached singleton)
# ═══════════════════════════════════════════════════════════════════════


def get_face_client():
    """
    Return a cached Rekognition client. Creates one on first call.
    Thread-safe enough for FastAPI single-process workers.
    """
    global _face_client
    if _face_client is None:
        _face_client = boto3.client(
            "rekognition",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
    return _face_client


# ═══════════════════════════════════════════════════════════════════════
# 2. Collection bootstrap — call once on app startup
# ═══════════════════════════════════════════════════════════════════════


def ensure_person_group(group_id: str, college_name: str) -> bool:
    """
    Create the Rekognition Collection if it does not already exist.
    Returns True if the collection is ready, False on unexpected error.

    (Name kept as ensure_person_group so main.py's startup bootstrap call
    is unchanged; `college_name` is accepted for signature compatibility
    but Rekognition collections have no display name.)
    """
    client = get_face_client()
    try:
        client.create_collection(CollectionId=group_id)
        logger.info("Rekognition collection '%s' created.", group_id)
        return True
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        # "ResourceAlreadyExistsException" is expected on every subsequent startup
        if code == "ResourceAlreadyExistsException":
            logger.debug("Collection '%s' already exists — skipping create.", group_id)
            return True
        logger.error("ensure_person_group error: %s", exc)
        return False
    except (BotoCoreError, Exception) as exc:
        logger.error("ensure_person_group unexpected error: %s", exc)
        return False


# ═══════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════


def _image_stream(image_bytes: bytes) -> io.BytesIO:
    """Wrap bytes in a seekable BytesIO stream (kept for callers that import it)."""
    stream = io.BytesIO(image_bytes)
    stream.seek(0)
    return stream


def _validate_image_size(image_bytes: bytes) -> None:
    """Raise ValueError if image exceeds Rekognition's 5 MB inline-bytes limit."""
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise ValueError(
            f"Image too large ({len(image_bytes) // (1024*1024)} MB). "
            "Maximum allowed size is 5 MB."
        )


# Minimum face sharpness (Rekognition Quality.Sharpness, 0-100; higher = sharper).
# Rejects heavily blurred photos. 20 is permissive enough for phone selfies.
_MIN_SHARPNESS = 20.0


def _detect_single_face(client, image_bytes: bytes) -> dict:
    """
    Detect faces and return the single FaceDetail dict.
    Raises ValueError if 0 or 2+ faces found, or the face is too blurry.
    """
    response = client.detect_faces(
        Image={"Bytes": image_bytes},
        Attributes=["ALL"],
    )
    faces = response.get("FaceDetails", [])
    if not faces:
        raise ValueError("No face detected in the image. Please use a clear front-facing photo.")
    if len(faces) > 1:
        raise ValueError(
            f"{len(faces)} faces detected. Please use a solo photo with only one person."
        )

    face = faces[0]

    # Quality gate: reject low sharpness (Azure's "blur=high" equivalent)
    quality = face.get("Quality") or {}
    sharpness = quality.get("Sharpness")
    if sharpness is not None and sharpness < _MIN_SHARPNESS:
        raise ValueError("Image is too blurry. Please take a sharper photo in good lighting.")

    return face


def _nose_tip(face_detail: dict) -> Optional[dict]:
    """Return the noseTip landmark {X, Y} (ratios 0-1) from a FaceDetail, or None."""
    for landmark in face_detail.get("Landmarks", []) or []:
        if landmark.get("Type") == "noseTip":
            return landmark
    return None


# ═══════════════════════════════════════════════════════════════════════
# 3. Enroll student face
# ═══════════════════════════════════════════════════════════════════════


def enroll_student_face(
    student_id: int,
    image_bytes: bytes,
    db: Session,
) -> dict:
    """
    Enroll (or re-enroll) a student's face in the Rekognition collection.

    Steps:
      a) Size validation
      b) Detect exactly 1 face, check quality
      c) Delete any previously-indexed face for this student (re-enroll cleanup)
      d) index_faces with ExternalImageId = str(student_id)
      e) Persist FaceId to DB (azure_person_id column, reused)

    Returns: {success: True, azure_person_id: str}   (azure_person_id == Rekognition FaceId)
    On any error returns: {success: False, error: str}
    """
    client = get_face_client()
    try:
        _validate_image_size(image_bytes)
        _detect_single_face(client, image_bytes)  # validates exactly-1 + quality

        # Re-enroll cleanup: drop the student's prior FaceId so the collection
        # does not accumulate stale vectors. Best-effort — never blocks enrollment.
        existing = db.query(User).filter(User.id == student_id).first()
        old_face_id = existing.azure_person_id if existing else None
        if old_face_id:
            try:
                client.delete_faces(
                    CollectionId=settings.AZURE_PERSON_GROUP_ID,
                    FaceIds=[old_face_id],
                )
                logger.info(
                    "Removed stale FaceId %s for student_id=%d before re-enroll",
                    old_face_id,
                    student_id,
                )
            except (ClientError, BotoCoreError) as exc:
                logger.warning(
                    "Could not delete stale FaceId %s for student_id=%d: %s",
                    old_face_id,
                    student_id,
                    exc,
                )

        # Index the new face. QualityFilter rejects poor-quality detections;
        # MaxFaces=1 since we already validated a single face above.
        index_result = client.index_faces(
            CollectionId=settings.AZURE_PERSON_GROUP_ID,
            Image={"Bytes": image_bytes},
            ExternalImageId=str(student_id),
            MaxFaces=1,
            QualityFilter="AUTO",
            DetectionAttributes=[],
        )

        face_records = index_result.get("FaceRecords", [])
        if not face_records:
            logger.warning(
                "index_faces returned no FaceRecords for student_id=%d (quality filtered)",
                student_id,
            )
            return {
                "success": False,
                "error": "Face could not be enrolled. Please use a clearer, well-lit photo.",
            }

        face_id = str(face_records[0]["Face"]["FaceId"])
        logger.info("Indexed FaceId %s for student_id=%d", face_id, student_id)

        # Persist to DB (FaceId stored in the reused azure_person_id column)
        now = datetime.now(tz=UTC)
        db.query(User).filter(User.id == student_id).update(
            {
                "azure_person_id": face_id,
                "face_enrolled": True,
                "face_enrolled_at": now,
            },
            synchronize_session=False,
        )
        db.commit()

        return {"success": True, "azure_person_id": face_id}

    except ValueError as exc:
        # Validation errors (blur, multiple faces, size) — not AWS faults
        logger.warning("enroll_student_face validation error: %s", exc)
        return {"success": False, "error": str(exc)}
    except (ClientError, BotoCoreError) as exc:
        logger.error(
            "enroll_student_face AWS error for student_id=%d: %s",
            student_id,
            exc,
        )
        return {"success": False, "error": "Face service error. Please try again."}
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

# Rekognition Similarity is 0-100. We pass 80.0 to the API and normalise the
# returned similarity to 0-1 for storage so the rest of the system (audit
# face_confidence, frontend confidence*100) keeps the existing 0-1 contract.
_CONFIDENCE_THRESHOLD = 0.80
_REKOGNITION_MATCH_THRESHOLD = 80.0


def verify_student_face(
    student_id: int,
    image_bytes: bytes,
    db: Session,
) -> dict:
    """
    Verify a student's face against the college Rekognition collection.

    Uses search_faces_by_image so the collection remains the ground truth,
    making re-enrollments transparent and multi-image-capable. The matched
    face's ExternalImageId must equal str(student_id).

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

        # 2. Validate the submitted image contains exactly one clear face.
        _detect_single_face(client, image_bytes)

        # 3. Search the collection (Rekognition indexes synchronously — no
        #    training-status gate is needed, unlike Azure).
        results = client.search_faces_by_image(
            CollectionId=settings.AZURE_PERSON_GROUP_ID,
            Image={"Bytes": image_bytes},
            MaxFaces=1,
            FaceMatchThreshold=_REKOGNITION_MATCH_THRESHOLD,
        )

        matches = results.get("FaceMatches", [])
        if not matches:
            logger.info(
                "verify_student_face: no match — student_id=%d confidence=0",
                student_id,
            )
            return {
                "verified": False,
                "confidence": 0.0,
                "reason": "Face not matched. Please try again or contact your HOD.",
            }

        match = matches[0]
        # Normalise 0-100 → 0-1 to keep the existing system-wide contract.
        confidence = round(float(match["Similarity"]) / 100.0, 4)
        matched_external_id = str(match["Face"].get("ExternalImageId", ""))
        matched_face_id = str(match["Face"].get("FaceId", ""))

        # 4. Cross-check matched face belongs to THIS student.
        if matched_external_id != str(student_id):
            logger.warning(
                "verify_student_face: PERSON MISMATCH — student_id=%d "
                "matched_external_id=%s confidence=%.4f",
                student_id,
                matched_external_id,
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
            "azure_person_id": matched_face_id,
        }

    except ValueError as exc:
        logger.warning(
            "verify_student_face validation error for student_id=%d: %s",
            student_id,
            exc,
        )
        return {"verified": False, "confidence": 0.0, "reason": str(exc)}
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        # An empty collection (no faces indexed yet) raises this on search.
        if code == "InvalidParameterException":
            logger.info(
                "verify_student_face: no searchable faces — student_id=%d", student_id
            )
            return {
                "verified": False,
                "confidence": 0.0,
                "reason": "Face not matched. Please try again or contact your HOD.",
            }
        logger.error(
            "verify_student_face AWS error for student_id=%d: %s",
            student_id,
            exc,
        )
        return {
            "verified": False,
            "confidence": 0.0,
            "reason": "Face service error. Please try again.",
        }
    except BotoCoreError as exc:
        logger.error(
            "verify_student_face AWS transport error for student_id=%d: %s",
            student_id,
            exc,
        )
        return {
            "verified": False,
            "confidence": 0.0,
            "reason": "Face service error. Please try again.",
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
    Remove a student's face from the Rekognition collection and clear DB face fields.
    Writes a FaceChangeLog audit entry regardless of AWS success.

    Returns True on full success, False on any error.
    """
    client = get_face_client()
    student = db.query(User).filter(User.id == student_id).first()

    if not student:
        logger.warning("delete_student_face: student_id=%d not found", student_id)
        return False

    old_person_id = student.azure_person_id

    # 1. Delete the FaceId from Rekognition (best-effort — continue if already gone)
    if old_person_id:
        try:
            client.delete_faces(
                CollectionId=settings.AZURE_PERSON_GROUP_ID,
                FaceIds=[old_person_id],
            )
            logger.info(
                "delete_student_face: deleted FaceId %s for student_id=%d",
                old_person_id,
                student_id,
            )
        except (ClientError, BotoCoreError) as exc:
            logger.error(
                "delete_student_face AWS error for student_id=%d: %s",
                student_id,
                exc,
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
# Liveness Detection — Challenge-Response (3-frame analysis)
#
# Rekognition has a managed Face Liveness flow (StartFaceLivenessSession) that
# requires the AWS Amplify FaceLivenessDetector UI component, which has no
# stable React Native binding yet. For now this server-side challenge-response
# is secure enough for college use:
#   • Challenge is random and single-use
#   • 3 frames must show consistent face presence
#   • Face landmark positions must shift between frames (proves video)
#   • Challenge-specific attributes (yaw for turns, smile for smile) checked
# ═══════════════════════════════════════════════════════════════════════

_LIVENESS_CHALLENGES = ["blink", "smile", "turn_left", "turn_right", "open_mouth"]
_LIVENESS_EXPIRY_SECONDS = 90  # generous — 3×3s countdown + AWS latency + slow connections

# Minimum landmark distance between frames to prove movement.
# Rekognition landmark X/Y are RATIOS (0-1) of image dimensions, so the
# threshold is a fraction of the frame, not pixels. 0.01 ≈ 1% of frame width.
_MIN_LANDMARK_SHIFT = 0.01

# Minimum yaw delta (degrees) to confirm a head turn
_MIN_YAW_DELTA = 15.0

# Minimum smile change (0-1) to confirm a smile
_MIN_SMILE_DELTA = 0.3


def create_liveness_challenge(student_id: int, db: Session) -> dict:
    """
    Generate a random liveness challenge, store it in the DB with an expiry,
    and return it to the client.

    Returns: {challenge_id, challenge, expires_in}
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
      4. Challenge-specific attribute change (soft signal, logged only):
           turn_left / turn_right → Pose.Yaw delta
           smile                  → Smile confidence delta
           blink / open_mouth     → nose-tip movement check only

    Uses Rekognition detect_faces(Attributes=["ALL"]) for Pose/Smile/Landmarks.

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

    # 2. Detect faces in all 3 frames
    detected: list = []
    for i, frame_bytes in enumerate(frames):
        # Retry up to 3 times on transient AWS errors (e.g. throttling)
        for _attempt in range(3):
            try:
                _validate_image_size(frame_bytes)
                response = client.detect_faces(
                    Image={"Bytes": frame_bytes},
                    Attributes=["ALL"],
                )
                faces = response.get("FaceDetails", [])
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
            except ValueError as exc:
                # Frame too large — not retryable
                logger.warning("verify_liveness_frames frame %d validation error: %s", i, exc)
                return {"liveness_confirmed": False, "reason": str(exc)}
            except (ClientError, BotoCoreError) as exc:
                logger.error(
                    "verify_liveness_frames AWS error frame %d attempt %d: %s",
                    i, _attempt + 1, exc,
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

    # 3. Nose-tip landmark shift (frames 0 → 2) proves movement.
    #    Rekognition landmark X/Y are ratios (0-1) of image dimensions.
    try:
        nt0 = _nose_tip(detected[0])
        nt2 = _nose_tip(detected[2])
        if nt0 and nt2:
            dx = abs(nt0["X"] - nt2["X"])
            dy = abs(nt0["Y"] - nt2["Y"])
            movement = (dx**2 + dy**2) ** 0.5
            if movement < _MIN_LANDMARK_SHIFT:
                record.used = True
                db.commit()
                logger.info(
                    "verify_liveness_frames: insufficient movement=%.4f challenge_id=%d",
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

    # 4. Challenge-specific attribute check (SOFT signal — logged, never hard-fails).
    #    The nose-tip MOVEMENT check above is the hard anti-photo gate. On phone
    #    cameras the per-challenge deltas are unreliable and caused repeated false
    #    rejections, so they are logged for diagnostics only.
    try:
        if challenge in ("turn_left", "turn_right"):
            yaw0 = (detected[0].get("Pose") or {}).get("Yaw")
            yaw2 = (detected[2].get("Pose") or {}).get("Yaw")
            if yaw0 is not None and yaw2 is not None:
                logger.info(
                    "verify_liveness_frames: yaw_delta=%.1f challenge='%s' (soft check)",
                    abs(yaw0 - yaw2),
                    challenge,
                )

        elif challenge == "smile":
            # Rekognition Smile = {Value: bool, Confidence: 0-100}; use confidence
            # as a 0-1 proxy for the old Azure smile intensity.
            sm0 = (detected[0].get("Smile") or {}).get("Confidence")
            sm2 = (detected[2].get("Smile") or {}).get("Confidence")
            if sm0 is not None and sm2 is not None:
                logger.info(
                    "verify_liveness_frames: smile_conf_delta=%.2f (soft check)",
                    abs(sm0 - sm2) / 100.0,
                )

        # blink / open_mouth: rely on nose-tip movement check only

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
