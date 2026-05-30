"""
AutoAttend AI v2.0 — Student Routes

POST /api/students/{student_id}/enroll-face
"""

import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from database import FaceChangeLog, Subject, Timetable, User, UserRole, get_db
from utils.auth_utils import any_authenticated
from utils.face_utils import (
    check_training_status,
    enroll_student_face,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/students", tags=["Students"])

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}
_MAX_ENROLL_IMAGE_BYTES = 6 * 1024 * 1024  # 6 MB (Azure hard limit)
_TRAIN_POLL_INTERVAL = 2  # seconds between training status polls
_TRAIN_POLL_TIMEOUT = 30  # max seconds to wait for training


# ═══════════════════════════════════════════════════════════════════════
# POST /api/students/{student_id}/enroll-face
# ═══════════════════════════════════════════════════════════════════════


@router.post("/{student_id}/enroll-face")
def enroll_face(
    student_id: int,
    image: Annotated[UploadFile, File(description="Student face photo (JPEG/PNG, max 6 MB)")],
    current_user: dict = Depends(any_authenticated),
    db: Session = Depends(get_db),
):
    """
    Enroll (or re-enroll) a student's face in Azure PersonGroup.

    Permissions:
      • The student themselves (can enroll for the first time only)
      • HOD or Principal (can enroll or re-enroll any student in their college)

    Re-enrollment (face already exists) is restricted to HOD/Principal.
    The old azure_person_id is preserved in face_change_log for audit.
    """
    caller_id = current_user["id"]
    caller_role = current_user["role"]

    logger.info(
        "🧑 FACE ENROLL attempt │ student_id=%d │ by user_id=%d (role=%s)",
        student_id,
        caller_id,
        caller_role,
    )

    # ── 1. Load student ───────────────────────────────────────────────
    student: User = db.query(User).filter(User.id == student_id).first()
    if not student or not student.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    # ── 2. College boundary check ─────────────────────────────────────
    if student.college_id != current_user["college_id"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You can only manage students in your own college.",
        )

    # ── 3. Permission rules ───────────────────────────────────────────
    is_hod_or_above = caller_role in {"hod", "principal"}
    is_self = caller_id == student_id and caller_role == "student"

    if not is_hod_or_above and not is_self:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You do not have permission to enroll this student's face.",
        )

    # Re-enrollment: only HOD/Principal allowed
    if student.face_enrolled and not is_hod_or_above:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Face is already enrolled. Re-enrollment requires HOD approval.",
        )

    # ── 4. File validation ────────────────────────────────────────────
    if image.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Invalid file type '{image.content_type}'. Only JPEG/PNG are accepted.",
        )

    image_bytes = image.file.read()

    if len(image_bytes) > _MAX_ENROLL_IMAGE_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Image too large ({len(image_bytes) // (1024*1024)} MB). Maximum is 6 MB.",
        )

    # ── 5. Preserve old person_id for audit (re-enrollment case) ─────
    old_azure_person_id = student.azure_person_id if student.face_enrolled else None

    # ── 6. Call Azure enrollment ──────────────────────────────────────
    logger.info(
        "🧑 FACE ENROLL │ student_id=%d │ calling Azure Face API (image=%d bytes)",
        student_id,
        len(image_bytes),
    )
    result = enroll_student_face(student_id, image_bytes, db)

    if not result.get("success"):
        logger.warning(
            "❌ FACE ENROLL failed │ student_id=%d │ reason=%s",
            student_id,
            result.get("error", "unknown"),
        )
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            result.get("error", "Face enrollment failed. Please try again."),
        )

    # ── 7. Audit log for re-enrollment ────────────────────────────────
    if old_azure_person_id:
        db.add(
            FaceChangeLog(
                student_id=student_id,
                changed_by=caller_id,
                old_azure_person_id=old_azure_person_id,
                new_azure_person_id=result["azure_person_id"],
                reason=f"Re-enrollment by {caller_role} (user_id={caller_id})",
            )
        )
        db.commit()

    # ── 8. Poll for training completion (max 30 s) ────────────────────
    from config import settings as _s

    deadline = time.monotonic() + _TRAIN_POLL_TIMEOUT
    training_status = "running"
    while time.monotonic() < deadline:
        training_status = check_training_status(_s.AZURE_PERSON_GROUP_ID)
        if training_status == "succeeded":
            break
        if training_status == "failed":
            break
        time.sleep(_TRAIN_POLL_INTERVAL)

    logger.info(
        "✅ FACE ENROLL success │ student_id=%d │ azure_person=%s │ training=%s",
        student_id,
        result["azure_person_id"],
        training_status,
    )

    return {
        "success": True,
        "azure_person_id": result["azure_person_id"],
        "training_status": training_status,
        "message": (
            "Face enrolled successfully. Student can now use face verification."
            if training_status == "succeeded"
            else "Face enrolled. Training is still in progress — recognition will be available shortly."
        ),
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/students/my-timetable — student's weekly timetable
# ═══════════════════════════════════════════════════════════════════════


@router.get("/my-timetable")
def get_student_timetable(
    current_user: dict = Depends(any_authenticated),
    db: Session = Depends(get_db),
):
    """Return weekly timetable for the student based on their course + semester."""
    logger.info("📅 STUDENT TIMETABLE │ user_id=%d", current_user["id"])
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student or student.role != UserRole.student:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Students only.")

    # Get subjects for the student's course and semester
    subject_ids = [
        r[0]
        for r in db.query(Subject.id)
        .filter(
            Subject.course_id == student.course_id,
            Subject.semester == student.semester,
        )
        .all()
    ]
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
        day_key = t.day_of_week.value if hasattr(t.day_of_week, "value") else t.day_of_week
        if day_key in by_day:
            by_day[day_key].append(
                {
                    "subject_name": sname,
                    "subject_code": scode,
                    "teacher_name": tname,
                    "start_time": t.start_time,
                    "end_time": t.end_time,
                    "room": t.room or "—",
                }
            )

    return {
        "timetable": [{"day": d.capitalize(), "slots": by_day[d]} for d in days_order if by_day[d]]
    }
