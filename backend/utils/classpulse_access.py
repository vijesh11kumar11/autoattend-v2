"""
ClassPulse — Centralized Access Control

A single source of truth for "can this student access this capsule?"
Used by every student-facing endpoint to avoid duplicated rules.

Returns ``(is_allowed, deny_reason, context)`` so endpoints can:
  • respond with a structured 403,
  • decide whether to serve full content / summary-only / read-only,
  • log accurate deny reasons.

ALL CHECKS FAIL-SAFE: any unexpected exception → deny.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Tuple

from sqlalchemy.orm import Session

from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    Capsule,
    CapsuleInteraction,
    CapsuleUnlockMode,
    SessionStatus,
    Subject,
    User,
)

logger = logging.getLogger(__name__)

# Tunables — kept in sync with classpulse.py
ATTENDANCE_READ_ONLY_FLOOR = 65.0


# ── Subject enrollment guard ────────────────────────────────────────────
def verify_student_subject_access(
    student_id: int, subject_id: int, db: Session
) -> bool:
    """
    Return True iff a student is allowed to interact with this subject:
      * student exists, role=student, active
      * subject exists
      * student.course_id matches subject.course_id
      * student.semester matches subject.semester (if both set)

    Any error / mismatch → False (fail-safe).
    """
    try:
        student = db.query(User).filter(User.id == student_id).first()
        subj = db.query(Subject).filter(Subject.id == subject_id).first()
        if not student or not subj:
            return False
        if not getattr(student, "is_active", True):
            return False
        if getattr(student, "role", None) and str(student.role.value if hasattr(student.role, "value") else student.role) != "student":
            return False
        if not student.course_id or subj.course_id != student.course_id:
            return False
        if student.semester is not None and subj.semester is not None and student.semester != subj.semester:
            return False
        return True
    except Exception as e:
        logger.warning("verify_student_subject_access failed: %s", e)
        return False


# ── Attendance helper ───────────────────────────────────────────────────
def attendance_pct_for_subject(
    db: Session, student_id: int, subject_id: int
) -> Tuple[float, int, int]:
    """
    Return (pct, present_count, total_sessions) for a student on a subject.
    Only counts ENDED sessions. Returns (0.0, 0, 0) if no sessions.
    """
    try:
        sess_ids = [
            sid for (sid,) in db.query(AttendanceSession.id)
            .filter(
                AttendanceSession.subject_id == subject_id,
                AttendanceSession.status == SessionStatus.ended,
            ).all()
        ]
        total = len(sess_ids)
        if total == 0:
            return 0.0, 0, 0
        present = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id.in_(sess_ids),
            AttendanceRecord.student_id == student_id,
            AttendanceRecord.status == AttendanceStatus.present,
        ).count()
        pct = round((present / total) * 100, 1) if total else 0.0
        return pct, present, total
    except Exception as e:
        logger.warning("attendance_pct_for_subject failed: %s", e)
        return 0.0, 0, 0


# ── The big one ─────────────────────────────────────────────────────────
async def check_capsule_access(
    capsule: Capsule,
    student: User,
    db: Session,
    require_mode: str = "view",
) -> Tuple[bool, str, dict]:
    """
    Decide whether ``student`` may access ``capsule`` in ``require_mode``.

    require_mode ∈ {"view", "download"}.

    Returns (is_allowed, deny_reason, context).  When deny, deny_reason
    is one of: ``not_enrolled``, ``not_in_section``, ``capsule_inactive``,
    ``locked_session_ended``, ``locked_attend_first``,
    ``locked_no_attendance``, ``summary_only``, ``read_only``,
    ``read_only_access``, ``not_unlocked``, ``error``.

    For ``view`` requests, ``read_only`` and ``summary_only`` are returned
    as deny reasons but the context still carries attendance info so the
    endpoint can decide to serve a summary-only payload.
    """
    try:
        if require_mode not in {"view", "download"}:
            return False, "error", {}

        if not capsule or not student:
            return False, "error", {}

        if not capsule.is_active:
            return False, "capsule_inactive", {}

        # 1. Subject enrollment
        if not verify_student_subject_access(student.id, capsule.subject_id, db):
            return False, "not_enrolled", {}

        # 2. Section isolation
        if capsule.section_id is not None and student.section_id != capsule.section_id:
            return False, "not_in_section", {}

        # 3. Unlock mode evaluation
        mode = capsule.unlock_mode

        if mode == CapsuleUnlockMode.always:
            access_status = "accessible"
            ctx: dict = {}
        elif mode == CapsuleUnlockMode.session_active:
            sess = (
                db.query(AttendanceSession)
                .filter(
                    AttendanceSession.subject_id == capsule.subject_id,
                    AttendanceSession.status == SessionStatus.active,
                )
                .order_by(AttendanceSession.id.desc())
                .first()
            )
            if sess is None:
                return False, "locked_session_ended", {}
            access_status, ctx = "accessible", {"session_id": sess.id}
        elif mode == CapsuleUnlockMode.after_attendance_marked:
            today = date.today()
            sess = (
                db.query(AttendanceSession)
                .filter(
                    AttendanceSession.subject_id == capsule.subject_id,
                    AttendanceSession.date == today,
                )
                .order_by(AttendanceSession.id.desc())
                .first()
            )
            if not sess:
                return False, "locked_attend_first", {}
            rec = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == sess.id,
                AttendanceRecord.student_id == student.id,
                AttendanceRecord.status == AttendanceStatus.present,
            ).first()
            if not rec:
                return False, "locked_attend_first", {}
            access_status, ctx = "accessible", {"session_id": sess.id}
        elif mode == CapsuleUnlockMode.attendance_gated:
            pct, present, total = attendance_pct_for_subject(
                db, student.id, capsule.subject_id
            )
            ctx = {
                "attendance_pct": pct, "present": present,
                "total_sessions": total, "min_required": capsule.min_attendance_pct,
            }
            if total == 0:
                return False, "locked_no_attendance", ctx
            if pct >= capsule.min_attendance_pct:
                access_status = "accessible"
            elif pct >= ATTENDANCE_READ_ONLY_FLOOR:
                access_status = "read_only"
            elif pct > 0:
                access_status = "summary_only"
            else:
                return False, "locked_no_attendance", ctx
        else:
            access_status, ctx = "accessible", {}

        # 4. Mode-specific decision
        if require_mode == "view":
            if access_status == "summary_only":
                return False, "summary_only", ctx
            # accessible & read_only both grant view
            ctx["access_status"] = access_status
            return True, "", ctx

        # require_mode == "download"
        if access_status == "read_only":
            return False, "read_only_access", ctx
        if access_status != "accessible":
            return False, access_status, ctx

        inter = (
            db.query(CapsuleInteraction)
            .filter(
                CapsuleInteraction.capsule_id == capsule.id,
                CapsuleInteraction.student_id == student.id,
            )
            .first()
        )
        if not inter or not inter.quiz_passed or not inter.download_allowed:
            return False, "not_unlocked", ctx

        ctx["access_status"] = access_status
        return True, "", ctx

    except Exception as e:
        logger.exception("check_capsule_access fail-safe DENY: %s", e)
        return False, "error", {}
