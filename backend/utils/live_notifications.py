"""
Live-session related parent / tutor notifications  (PROMPT 7).

Best-effort: any failure inside is logged, never raised, so callers
running this from a BackgroundTask are safe.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from database import SessionLocal, TutorAssignment, User
from utils.sms import send_sms
from utils.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)


def notify_parent_student_missed_live_session(
    student_id: int,
    session_title: str,
    subject_name: str,
    consecutive_misses: int,
    db: Optional[Session] = None,
) -> None:
    """
    Send WhatsApp + SMS to the student's tutor (always) and to parent
    (only when consecutive_misses >= 3).  Silently ignores missing data.
    """
    own_db = False
    if db is None:
        db = SessionLocal()
        own_db = True
    try:
        student = db.query(User).filter(User.id == student_id).first()
        if not student:
            return

        msg = (
            f"📵 {student.name} missed today's live online session "
            f"\"{session_title}\" for {subject_name}. "
            f"This is consecutive miss #{consecutive_misses}."
        )

        # Tutor (always)
        tutor_id = (
            db.query(TutorAssignment.tutor_id)
            .filter(
                TutorAssignment.student_id == student_id,
                TutorAssignment.is_active.is_(True),
            )
            .scalar()
        )
        if tutor_id:
            tutor = db.query(User).filter(User.id == tutor_id).first()
            if tutor and tutor.phone:
                try:
                    send_whatsapp_message(tutor.phone, f"[Tutor alert] {msg}")
                except Exception as e:
                    logger.warning("tutor whatsapp failed: %s", e)
                try:
                    send_sms(tutor.phone, f"[Tutor alert] {msg}")
                except Exception as e:
                    logger.warning("tutor sms failed: %s", e)

        # Parent (only on >=3 consecutive)
        if consecutive_misses >= 3 and getattr(student, "parent_phone", None):
            parent_msg = (
                f"⚠️ {student.name} has missed {consecutive_misses} live online "
                f"sessions in a row ({subject_name}). Latest: \"{session_title}\". "
                f"Please follow up."
            )
            try:
                send_whatsapp_message(student.parent_phone, parent_msg)
            except Exception as e:
                logger.warning("parent whatsapp failed: %s", e)
            try:
                send_sms(student.parent_phone, parent_msg)
            except Exception as e:
                logger.warning("parent sms failed: %s", e)
    except Exception as exc:  # pragma: no cover
        logger.exception("notify_parent_student_missed_live_session failed: %s", exc)
    finally:
        if own_db:
            db.close()
