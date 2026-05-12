"""
AutoAttend AI v2.0 — ClassPulse: Session-Aware Learning Space

Prefix: /api/classpulse

Roles:
  • teacher  — author capsules, view analytics, answer doubts
  • student  — consume capsules (gated), take quiz, post wall doubts
  • hod      — department-level analytics
  • principal — soft delete (escalation) and view-all where applicable

All access is mediated by:
  1. Section enrollment
  2. Capsule.unlock_mode
  3. Live attendance state
  4. Cumulative attendance percentage
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import aiofiles
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, func as sqlfunc
from sqlalchemy.orm import Session

from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    Capsule,
    CapsuleAccessAction,
    CapsuleAccessLog,
    CapsuleInteraction,
    CapsuleType,
    CapsuleUnlockMode,
    ClassWallPost,
    ClassWallResonance,
    Department,
    SessionLocal,
    SessionStatus,
    Section,
    Subject,
    Timetable,
    TutorAssignment,
    User,
    UserRole,
    WallPostStatus,
    get_db,
)
from config import settings
from utils.auth_utils import get_current_user
from utils.classpulse_access import (
    check_capsule_access,
    verify_student_subject_access,
)
from utils.classpulse_ai import (
    auto_answer_doubt,
    extract_text_from_pdf_url,
    generate_capsule_quiz,
    generate_capsule_summary,
)
from utils.notification_utils import send_push_notification
from utils.pdf_watermark import (
    cleanup_expired_watermarks,
    watermark_pdf_for_student,
)
from utils.signed_urls import generate_signed_capsule_url, verify_signed_url
from utils.sms import send_sms
from utils.whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/classpulse", tags=["ClassPulse"])

# ── Constants ──────────────────────────────────────────────────────────
UPLOAD_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "uploads", "classpulse"))
WATERMARK_TMP = os.path.join(UPLOAD_ROOT, "_watermarked")
ALLOWED_FILE_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
    "text/plain",
}
ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/webm", "audio/ogg", "audio/m4a", "audio/x-m4a"}
MAX_FILE_BYTES = 25 * 1024 * 1024            # 25 MB
MAX_AUDIO_BYTES = 10 * 1024 * 1024           # 10 MB
HEARTBEAT_INCREMENT_SEC = 30
QUIZ_PASS_SCORE = 2
HOT_DOUBT_THRESHOLD = 5
WATERMARK_TTL_SECONDS = 3600                 # 1 hour
ATTENDANCE_READ_ONLY_FLOOR = 65.0            # below min_pct but >=65 → read_only
ATTENDANCE_NO_DOWNLOAD_FLOOR = 0.0
QUIZ_MAX_ATTEMPTS = 2                        # Prompt 6: allow up to 2 attempts
QUIZ_RETRY_COOLDOWN_HOURS = 24               # Prompt 6: wait 24h between attempts
HOD_ESCALATION_FAIL_THRESHOLD = 3            # ≥3 fails in last 7d for same subj → notify HOD
HOD_ESCALATION_WINDOW_DAYS = 7


os.makedirs(UPLOAD_ROOT, exist_ok=True)
os.makedirs(WATERMARK_TMP, exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════
# Request schemas
# ═══════════════════════════════════════════════════════════════════════

class CapsuleUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=4000)
    unlock_mode: Optional[str] = None
    min_attendance_pct: Optional[float] = Field(None, ge=0.0, le=100.0)
    is_active: Optional[bool] = None


class TeacherAnswerRequest(BaseModel):
    answer: str = Field(..., min_length=1, max_length=4000)


class QuizSubmitRequest(BaseModel):
    answers: dict[str, str]
    elapsed_seconds: Optional[int] = Field(default=None, ge=0)


class HeartbeatRequest(BaseModel):
    pages_viewed: int = Field(default=0, ge=0)
    total_pages: int = Field(default=0, ge=0)


class WallPostRequest(BaseModel):
    subject_id: int
    section_id: Optional[int] = None
    content: str = Field(..., min_length=10, max_length=1000)
    capsule_id: Optional[int] = None
    page_number: Optional[int] = Field(default=None, ge=1)


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _require_role(user: dict, *roles: str) -> None:
    if user.get("role") not in roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role(s): {', '.join(roles)}")


def _teacher_owns_subject(db: Session, teacher_id: int, subject_id: int) -> bool:
    subj = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subj:
        return False
    if subj.teacher_id == teacher_id:
        return True
    # Also accept if teacher has any timetable entry for this subject
    exists = db.query(Timetable.id).filter(
        Timetable.subject_id == subject_id, Timetable.teacher_id == teacher_id
    ).first()
    return exists is not None


def _student_in_subject(db: Session, student: User, subject_id: int) -> bool:
    subj = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subj:
        return False
    if not student.course_id or subj.course_id != student.course_id:
        return False
    if student.semester is not None and subj.semester != student.semester:
        return False
    return True


def _attendance_pct_for_subject(db: Session, student_id: int, subject_id: int) -> tuple[float, int, int]:
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


def _today_session_for_subject(db: Session, subject_id: int) -> Optional[AttendanceSession]:
    today = date.today()
    return (
        db.query(AttendanceSession)
        .filter(
            AttendanceSession.subject_id == subject_id,
            AttendanceSession.date == today,
        )
        .order_by(desc(AttendanceSession.id))
        .first()
    )


def _active_session_for_subject(db: Session, subject_id: int) -> Optional[AttendanceSession]:
    return (
        db.query(AttendanceSession)
        .filter(
            AttendanceSession.subject_id == subject_id,
            AttendanceSession.status == SessionStatus.active,
        )
        .order_by(desc(AttendanceSession.id))
        .first()
    )


def _resolve_access_status(db: Session, student: User, capsule: Capsule) -> tuple[str, dict]:
    """
    Returns (access_status, meta_dict).
    access_status ∈ {accessible, read_only, summary_only,
        not_enrolled, locked_session_ended, locked_attend_first,
        locked_no_attendance, capsule_inactive, wrong_section}
    """
    if not capsule.is_active:
        return "capsule_inactive", {}

    if not _student_in_subject(db, student, capsule.subject_id):
        return "not_enrolled", {}

    if capsule.section_id is not None and student.section_id != capsule.section_id:
        return "wrong_section", {}

    mode = capsule.unlock_mode

    if mode == CapsuleUnlockMode.always:
        return "accessible", {}

    if mode == CapsuleUnlockMode.session_active:
        sess = _active_session_for_subject(db, capsule.subject_id)
        if sess is not None:
            return "accessible", {"session_id": sess.id}
        return "locked_session_ended", {}

    if mode == CapsuleUnlockMode.after_attendance_marked:
        sess = _today_session_for_subject(db, capsule.subject_id)
        if sess:
            rec = db.query(AttendanceRecord).filter(
                AttendanceRecord.session_id == sess.id,
                AttendanceRecord.student_id == student.id,
                AttendanceRecord.status == AttendanceStatus.present,
            ).first()
            if rec:
                return "accessible", {"session_id": sess.id}
        return "locked_attend_first", {}

    if mode == CapsuleUnlockMode.attendance_gated:
        pct, present, total = _attendance_pct_for_subject(db, student.id, capsule.subject_id)
        meta = {"attendance_pct": pct, "present": present, "total_sessions": total,
                "min_required": capsule.min_attendance_pct}
        if total == 0 or pct == ATTENDANCE_NO_DOWNLOAD_FLOOR and present == 0:
            if total == 0:
                return "locked_no_attendance", meta
        if pct >= capsule.min_attendance_pct:
            return "accessible", meta
        if pct >= ATTENDANCE_READ_ONLY_FLOOR:
            return "read_only", meta
        if pct > 0:
            return "summary_only", meta
        return "locked_no_attendance", meta

    return "accessible", {}


def _log_access(
    db: Session,
    capsule_id: int,
    user_id: int,
    action: CapsuleAccessAction,
    request: Optional[Request] = None,
    deny_reason: Optional[str] = None,
) -> None:
    try:
        ip = None
        ua = None
        if request is not None:
            ip = request.client.host if request.client else None
            ua = request.headers.get("user-agent")
            if ua:
                ua = ua[:500]
        db.add(CapsuleAccessLog(
            capsule_id=capsule_id,
            user_id=user_id,
            action=action,
            deny_reason=deny_reason[:200] if deny_reason else None,
            ip_address=ip,
            user_agent=ua,
        ))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("📒 access log write failed: %s", exc)


def _get_or_create_interaction(db: Session, capsule_id: int, student_id: int) -> CapsuleInteraction:
    inter = db.query(CapsuleInteraction).filter(
        CapsuleInteraction.capsule_id == capsule_id,
        CapsuleInteraction.student_id == student_id,
    ).first()
    if inter:
        return inter
    inter = CapsuleInteraction(capsule_id=capsule_id, student_id=student_id)
    db.add(inter)
    db.commit()
    db.refresh(inter)
    return inter


def _capsule_summary_text(capsule: Capsule) -> str:
    """Best-effort summary string for AI doubt context."""
    if not capsule.ai_summary:
        return capsule.description or ""
    try:
        data = json.loads(capsule.ai_summary)
        if isinstance(data, dict):
            return str(data.get("summary", ""))[:2000]
    except (json.JSONDecodeError, TypeError):
        pass
    return capsule.ai_summary[:2000]


def _strip_quiz_answers(quiz_json) -> list[dict]:
    """Return quiz items with correct_answer + explanation removed."""
    if not isinstance(quiz_json, list):
        return []
    out = []
    for item in quiz_json:
        if not isinstance(item, dict):
            continue
        out.append({
            "question": item.get("question"),
            "options": item.get("options"),
        })
    return out


# ═══════════════════════════════════════════════════════════════════════
# Background task: AI processing
# ═══════════════════════════════════════════════════════════════════════

async def _process_capsule_ai(capsule_id: int) -> None:
    """Background — extract PDF, generate summary + quiz, save to capsule."""
    db: Session = SessionLocal()
    try:
        capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
        if not capsule:
            logger.warning("🤖 AI process: capsule %d not found", capsule_id)
            return

        subj = db.query(Subject).filter(Subject.id == capsule.subject_id).first()
        subject_name = subj.name if subj else "this subject"

        text = ""
        if capsule.file_url:
            text = await extract_text_from_pdf_url(capsule.file_url)
        if not text and capsule.description:
            text = capsule.description

        if not text.strip():
            logger.info("🤖 AI process: no extractable text for capsule %d, skipping", capsule_id)
            capsule.ai_processed = True
            db.commit()
            return

        logger.info("🤖 AI process: capsule %d (%d chars)", capsule_id, len(text))
        summary = await generate_capsule_summary(text, subject_name, capsule.title)
        difficulty = summary.get("difficulty_level", "intermediate")
        quiz = await generate_capsule_quiz(text, subject_name, difficulty)

        capsule.ai_summary = json.dumps(summary, ensure_ascii=False)
        if quiz:
            capsule.ai_quiz_json = quiz
        capsule.ai_processed = True
        db.commit()
        logger.info("✅ AI process complete for capsule %d (quiz items=%d)", capsule_id, len(quiz))
    except Exception as exc:
        db.rollback()
        logger.error("❌ AI process failed for capsule %d: %s", capsule_id, exc)
    finally:
        db.close()


async def _process_doubt_ai(post_id: int) -> None:
    """Background — populate AI suggested answer on a wall post."""
    db: Session = SessionLocal()
    try:
        post = db.query(ClassWallPost).filter(ClassWallPost.id == post_id).first()
        if not post:
            return
        subj = db.query(Subject).filter(Subject.id == post.subject_id).first()
        subject_name = subj.name if subj else "this subject"
        capsule_summary = None
        if post.capsule_id:
            cap = db.query(Capsule).filter(Capsule.id == post.capsule_id).first()
            if cap:
                capsule_summary = _capsule_summary_text(cap)
        result = await auto_answer_doubt(post.content, subject_name, capsule_summary)
        post.ai_suggested_answer = result.get("answer") or None
        post.ai_answer_confidence = float(result.get("confidence", 0.0))
        db.commit()
        logger.info("🤖 wall post %d AI-answered (conf=%.2f)", post_id, post.ai_answer_confidence)
    except Exception as exc:
        db.rollback()
        logger.error("❌ Doubt AI failed for post %d: %s", post_id, exc)
    finally:
        db.close()


def _notify_teacher_new_doubt(subject_id: int, post_id: int) -> None:
    db: Session = SessionLocal()
    try:
        subj = db.query(Subject).filter(Subject.id == subject_id).first()
        if not subj or not subj.teacher_id:
            return
        send_push_notification(
            user_id=subj.teacher_id,
            title="📩 New ClassPulse doubt",
            body=f"A new doubt was posted in {subj.name}",
            db=db,
            data={"type": "classpulse_doubt", "post_id": post_id, "subject_id": subject_id},
        )
    except Exception as exc:
        logger.warning("notify_teacher_new_doubt failed: %s", exc)
    finally:
        db.close()


def _notify_hot_doubt(post_id: int) -> None:
    db: Session = SessionLocal()
    try:
        post = db.query(ClassWallPost).filter(ClassWallPost.id == post_id).first()
        if not post:
            return
        subj = db.query(Subject).filter(Subject.id == post.subject_id).first()
        if not subj or not subj.teacher_id:
            return
        snippet = (post.content or "")[:80]
        send_push_notification(
            user_id=subj.teacher_id,
            title=f"🔥 HOT doubt in {subj.name}",
            body=f"'{snippet}' — {post.resonance_count}+ students confused",
            db=db,
            data={"type": "classpulse_hot_doubt", "post_id": post_id, "subject_id": subj.id},
        )
    except Exception as exc:
        logger.warning("notify_hot_doubt failed: %s", exc)
    finally:
        db.close()


def _notify_tutor_quiz_fail(student_id: int, capsule_id: int, score: int) -> None:
    db: Session = SessionLocal()
    try:
        ta = db.query(TutorAssignment).filter(
            TutorAssignment.student_id == student_id,
            TutorAssignment.is_active == True,  # noqa: E712
        ).first()
        student = db.query(User).filter(User.id == student_id).first()
        capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
        if not (student and capsule):
            return
        subj = db.query(Subject).filter(Subject.id == capsule.subject_id).first()
        subject_name = subj.name if subj else "subject"

        # ── (1) Notify direct tutor: WhatsApp + Push + SMS ────────────
        tutor = db.query(User).filter(User.id == ta.tutor_id).first() if ta else None
        if tutor:
            wa_msg = (
                f"Your ward {student.name} ({student.roll_number or 'N/A'}) failed comprehension "
                f"check for '{capsule.title}' in {subject_name}. Score: {score}/3. "
                f"May need academic support."
            )
            if tutor.phone:
                try:
                    send_whatsapp_message(tutor.phone, wa_msg)
                except Exception as e:
                    logger.warning("tutor WA failed: %s", e)
                try:
                    sms_msg = (
                        f"AutoAttend: Your ward {student.name} failed quiz '{capsule.title}' "
                        f"({subject_name}) with {score}/3. Please review."
                    )
                    send_sms(tutor.phone, sms_msg)
                except Exception as e:
                    logger.warning("tutor SMS failed: %s", e)
            try:
                send_push_notification(
                    user_id=tutor.id,
                    title=f"⚠️ Ward quiz failure: {student.name}",
                    body=f"{student.name} failed '{capsule.title}' ({subject_name}) — {score}/3",
                    db=db,
                    data={
                        "type": "classpulse_tutor_alert",
                        "student_id": student.id,
                        "capsule_id": capsule.id,
                        "subject_id": capsule.subject_id,
                        "screen": "TWMDashboard",
                    },
                )
            except Exception as e:
                logger.warning("tutor push failed: %s", e)

        # ── (2) HOD escalation: ≥3 fails in last 7d for same subject ──
        try:
            cutoff = datetime.now(tz=timezone.utc) - timedelta(days=HOD_ESCALATION_WINDOW_DAYS)
            cap_ids_subj = [
                c.id for c in db.query(Capsule).filter(Capsule.subject_id == capsule.subject_id).all()
            ]
            recent_fails = db.query(CapsuleInteraction).filter(
                CapsuleInteraction.student_id == student_id,
                CapsuleInteraction.capsule_id.in_(cap_ids_subj) if cap_ids_subj else False,
                CapsuleInteraction.quiz_attempted == True,  # noqa: E712
                CapsuleInteraction.quiz_passed == False,  # noqa: E712
                CapsuleInteraction.last_quiz_at.isnot(None),
                CapsuleInteraction.last_quiz_at >= cutoff,
            ).count() if cap_ids_subj else 0

            if recent_fails >= HOD_ESCALATION_FAIL_THRESHOLD and student.department_id:
                hod = db.query(User).filter(
                    User.department_id == student.department_id,
                    User.role == UserRole.hod,
                    User.is_active == True,  # noqa: E712
                ).first()
                if hod:
                    send_push_notification(
                        user_id=hod.id,
                        title="🚨 ClassPulse academic alert",
                        body=(
                            f"{student.name} ({student.roll_number or 'N/A'}) — "
                            f"{recent_fails} quiz failures in {subject_name} (7d)"
                        ),
                        db=db,
                        data={
                            "type": "classpulse_hod_escalation",
                            "student_id": student.id,
                            "subject_id": capsule.subject_id,
                            "fail_count": recent_fails,
                            "screen": "HODClassPulse",
                        },
                    )
                    logger.info(
                        "🚨 HOD escalation: student=%d subject=%d fails=%d",
                        student_id, capsule.subject_id, recent_fails,
                    )
        except Exception as e:
            logger.warning("HOD escalation check failed: %s", e)

        logger.info(
            "📱 tutor channels notified for quiz fail (student=%d, capsule=%d)",
            student_id, capsule_id,
        )
    except Exception as exc:
        logger.warning("notify_tutor_quiz_fail failed: %s", exc)
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════
# File upload helpers
# ═══════════════════════════════════════════════════════════════════════

async def _save_upload(file: UploadFile, subject_id: int, max_bytes: int, allowed_types: set[str]) -> dict:
    if file.content_type and file.content_type not in allowed_types:
        # Allow some unknown types only for audio fallback handled by caller
        raise HTTPException(415, f"Unsupported media type: {file.content_type}")

    subj_dir = os.path.join(UPLOAD_ROOT, str(subject_id))
    os.makedirs(subj_dir, exist_ok=True)
    safe_name = os.path.basename(file.filename or "upload.bin").replace(" ", "_")
    fname = f"{uuid.uuid4().hex}_{safe_name}"
    fpath = os.path.join(subj_dir, fname)

    written = 0
    async with aiofiles.open(fpath, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                await out.close()
                try:
                    os.remove(fpath)
                except OSError:
                    pass
                raise HTTPException(413, f"File too large (max {max_bytes // (1024*1024)} MB)")
            await out.write(chunk)
    return {
        "path": fpath,
        "name": safe_name,
        "size_kb": max(1, written // 1024),
        "mime": file.content_type or "application/octet-stream",
    }


def _watermark_pdf(source_path: str, footer_text: str) -> str:
    """Embed a footer on every page. Returns the new file path."""
    try:
        import fitz  # PyMuPDF
    except ImportError as e:
        raise HTTPException(500, "Watermarking unavailable (PyMuPDF not installed)") from e

    out_name = f"{uuid.uuid4().hex}.pdf"
    out_path = os.path.join(WATERMARK_TMP, out_name)
    with fitz.open(source_path) as doc:
        for page in doc:
            rect = page.rect
            footer_rect = fitz.Rect(
                rect.x0 + 18, rect.y1 - 28, rect.x1 - 18, rect.y1 - 8,
            )
            page.draw_rect(footer_rect, color=(1, 1, 1), fill=(1, 1, 1), overlay=True)
            page.insert_textbox(
                footer_rect, footer_text,
                fontsize=8, fontname="helv",
                color=(0.35, 0.35, 0.35), align=1, overlay=True,
            )
        doc.save(out_path, deflate=True)
    return out_path


def _cleanup_old_watermarks() -> None:
    """Best-effort: delete watermarked PDFs older than WATERMARK_TTL_SECONDS."""
    try:
        cutoff = datetime.now().timestamp() - WATERMARK_TTL_SECONDS
        for fname in os.listdir(WATERMARK_TMP):
            fpath = os.path.join(WATERMARK_TMP, fname)
            try:
                if os.path.isfile(fpath) and os.path.getmtime(fpath) < cutoff:
                    os.remove(fpath)
            except OSError:
                continue
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════
# Rate limiting (lightweight in-memory; resets on process restart)
# ═══════════════════════════════════════════════════════════════════════
# Buckets keyed by (route_tag, user_id, scope_id, window_id) -> count
_RATE_BUCKETS: dict[tuple, int] = {}
_RATE_LAST_GC = [datetime.utcnow()]

RATE_LIMITS = {
    # tag                     : (max_calls, window_seconds, scope_label)
    "open_capsule":             (10, 86400, "per capsule per day"),
    "wall_post":                (5,  86400, "per subject per day"),
    "wall_resonate":            (50, 3600,  "per hour"),
    "submit_quiz":              (2,  86400, "per capsule per day"),
}


def _rate_limit_check(tag: str, user_id: int, scope_id: int = 0) -> None:
    """Raise HTTP 429 when the caller exceeds the configured bucket."""
    cfg = RATE_LIMITS.get(tag)
    if not cfg:
        return
    max_calls, window_sec, scope_label = cfg
    now = datetime.utcnow()
    # Periodic GC of stale buckets
    if (now - _RATE_LAST_GC[0]).total_seconds() > 600:
        cutoff_window = int(now.timestamp() // window_sec) - 2
        for k in list(_RATE_BUCKETS.keys()):
            if k[0] == tag and k[3] < cutoff_window:
                _RATE_BUCKETS.pop(k, None)
        _RATE_LAST_GC[0] = now
    window_id = int(now.timestamp() // window_sec)
    key = (tag, int(user_id), int(scope_id), window_id)
    current = _RATE_BUCKETS.get(key, 0)
    if current >= max_calls:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded ({max_calls} {scope_label}). Try again later.",
        )
    _RATE_BUCKETS[key] = current + 1


# ═══════════════════════════════════════════════════════════════════════
# Suspicious activity detection (logged, NOT blocking)
# ═══════════════════════════════════════════════════════════════════════
SUSPICIOUS_PREFIX = "suspicious:"


def check_suspicious_activity(
    student_id: int,
    capsule_id: int,
    db: Session,
    request: Optional[Request] = None,
    quiz_seconds: Optional[int] = None,
    download_attempt: bool = False,
) -> list[str]:
    """
    Inspect interaction telemetry, log any anomalies, and return the list
    of detected flags (purely informational — never blocks the request).

    Flags:
      • opened_short_visit  — opened but spent < 10 seconds total
      • download_no_heartbeat — download attempt without any heartbeats
      • quiz_too_fast        — quiz submitted in < 30 seconds
    """
    flags: list[str] = []
    try:
        inter = db.query(CapsuleInteraction).filter(
            CapsuleInteraction.capsule_id == capsule_id,
            CapsuleInteraction.student_id == student_id,
        ).first()

        if inter and inter.first_opened_at and (inter.total_time_spent_sec or 0) < 10:
            flags.append("opened_short_visit")

        if download_attempt and (not inter or (inter.total_time_spent_sec or 0) == 0):
            flags.append("download_no_heartbeat")

        if quiz_seconds is not None and quiz_seconds < 30:
            flags.append("quiz_too_fast")

        if not flags:
            return flags

        ip = request.client.host if (request and request.client) else None
        ua = request.headers.get("user-agent") if request else None
        if ua:
            ua = ua[:500]
        for flag in flags:
            db.add(CapsuleAccessLog(
                capsule_id=capsule_id,
                user_id=student_id,
                action=CapsuleAccessAction.view_denied,  # reuse enum, prefix in deny_reason
                deny_reason=f"{SUSPICIOUS_PREFIX}{flag}",
                ip_address=ip,
                user_agent=ua,
            ))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("suspicious activity logger failed: %s", e)
    return flags


# ═══════════════════════════════════════════════════════════════════════
# TEACHER ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

@router.post("/capsule")
async def create_capsule(
    background: BackgroundTasks,
    subject_id: int = Form(...),
    title: str = Form(..., min_length=1, max_length=200),
    description: Optional[str] = Form(None),
    capsule_type: str = Form("notes"),
    unlock_mode: str = Form("always"),
    section_id: int = Form(0),
    min_attendance_pct: float = Form(75.0),
    file: Optional[UploadFile] = File(None),
    voice_memo: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Teacher creates a new capsule. AI processes in background."""
    _require_role(current_user, "teacher")

    if not _teacher_owns_subject(db, current_user["id"], subject_id):
        raise HTTPException(403, "You do not teach this subject")

    if capsule_type not in {ct.value for ct in CapsuleType}:
        raise HTTPException(400, f"Invalid capsule_type. Allowed: {sorted(ct.value for ct in CapsuleType)}")
    if unlock_mode not in {um.value for um in CapsuleUnlockMode}:
        raise HTTPException(400, f"Invalid unlock_mode. Allowed: {sorted(um.value for um in CapsuleUnlockMode)}")
    if min_attendance_pct < 0 or min_attendance_pct > 100:
        raise HTTPException(400, "min_attendance_pct must be 0-100")

    section_pk: Optional[int] = section_id if section_id and section_id > 0 else None
    if section_pk is not None:
        sec = db.query(Section).filter(Section.id == section_pk).first()
        if not sec:
            raise HTTPException(404, "Section not found")

    file_meta = None
    if file is not None and (file.filename or "").strip():
        file_meta = await _save_upload(file, subject_id, MAX_FILE_BYTES, ALLOWED_FILE_TYPES)

    voice_meta = None
    if voice_memo is not None and (voice_memo.filename or "").strip():
        # be permissive about audio mimetypes
        allowed_audio = ALLOWED_AUDIO_TYPES | {"application/octet-stream"}
        voice_meta = await _save_upload(voice_memo, subject_id, MAX_AUDIO_BYTES, allowed_audio)

    capsule = Capsule(
        subject_id=subject_id,
        teacher_id=current_user["id"],
        section_id=section_pk,
        title=title.strip(),
        description=(description or "").strip() or None,
        capsule_type=CapsuleType(capsule_type),
        unlock_mode=CapsuleUnlockMode(unlock_mode),
        min_attendance_pct=float(min_attendance_pct),
        file_url=file_meta["path"] if file_meta else None,
        file_name=file_meta["name"] if file_meta else None,
        file_size_kb=file_meta["size_kb"] if file_meta else None,
        file_mime_type=file_meta["mime"] if file_meta else None,
        voice_memo_url=voice_meta["path"] if voice_meta else None,
        voice_memo_duration_sec=None,
        ai_processed=False,
    )
    db.add(capsule)
    db.commit()
    db.refresh(capsule)

    if file_meta and (file_meta["mime"] == "application/pdf" or capsule.description):
        background.add_task(_process_capsule_ai, capsule.id)
    elif capsule.description:
        background.add_task(_process_capsule_ai, capsule.id)
    else:
        capsule.ai_processed = True
        db.commit()

    logger.info("📦 Capsule created id=%d title=%s by teacher=%d", capsule.id, capsule.title, current_user["id"])
    return {
        "id": capsule.id,
        "subject_id": capsule.subject_id,
        "section_id": capsule.section_id,
        "title": capsule.title,
        "capsule_type": capsule.capsule_type.value,
        "unlock_mode": capsule.unlock_mode.value,
        "min_attendance_pct": capsule.min_attendance_pct,
        "file_name": capsule.file_name,
        "file_size_kb": capsule.file_size_kb,
        "ai_processed": capsule.ai_processed,
        "created_at": capsule.created_at.isoformat() if capsule.created_at else None,
    }


@router.put("/capsule/{capsule_id}")
def update_capsule(
    capsule_id: int,
    body: CapsuleUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "teacher")
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")
    if capsule.teacher_id != current_user["id"]:
        raise HTTPException(403, "You did not create this capsule")

    if body.title is not None:
        capsule.title = body.title.strip()
    if body.description is not None:
        capsule.description = body.description.strip() or None
    if body.unlock_mode is not None:
        if body.unlock_mode not in {um.value for um in CapsuleUnlockMode}:
            raise HTTPException(400, "Invalid unlock_mode")
        capsule.unlock_mode = CapsuleUnlockMode(body.unlock_mode)
    if body.min_attendance_pct is not None:
        capsule.min_attendance_pct = body.min_attendance_pct
    if body.is_active is not None:
        capsule.is_active = body.is_active

    db.commit()
    db.refresh(capsule)
    logger.info("✏️  Capsule %d updated", capsule_id)
    return {"ok": True, "id": capsule.id, "updated_at": capsule.updated_at.isoformat() if capsule.updated_at else None}


@router.delete("/capsule/{capsule_id}")
def delete_capsule(
    capsule_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "teacher", "hod", "principal")
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")
    if current_user["role"] == "teacher" and capsule.teacher_id != current_user["id"]:
        raise HTTPException(403, "Only the author or HOD/Principal can delete")

    capsule.is_active = False
    db.commit()
    logger.info("🗑️  Capsule %d soft-deleted by user=%d", capsule_id, current_user["id"])
    return {"ok": True, "id": capsule_id, "is_active": False}


@router.get("/teacher/subject/{subject_id}/capsules")
def teacher_list_capsules(
    subject_id: int,
    include_inactive: bool = Query(False),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "teacher")
    if not _teacher_owns_subject(db, current_user["id"], subject_id):
        raise HTTPException(403, "You do not teach this subject")

    q = db.query(Capsule).filter(
        Capsule.subject_id == subject_id,
        Capsule.teacher_id == current_user["id"],
    )
    if not include_inactive:
        q = q.filter(Capsule.is_active == True)  # noqa: E712
    capsules = q.order_by(desc(Capsule.created_at)).all()

    # Total enrolled students for this subject
    subj = db.query(Subject).filter(Subject.id == subject_id).first()
    total_students_query = db.query(User).filter(
        User.role == UserRole.student,
        User.is_active == True,  # noqa: E712
    )
    if subj:
        total_students_query = total_students_query.filter(
            User.course_id == subj.course_id,
            User.semester == subj.semester,
        )

    out = []
    for c in capsules:
        total_students = total_students_query.count()
        if c.section_id is not None:
            total_students = db.query(User).filter(
                User.role == UserRole.student,
                User.is_active == True,  # noqa: E712
                User.section_id == c.section_id,
            ).count()

        interactions = db.query(CapsuleInteraction).filter(CapsuleInteraction.capsule_id == c.id).all()
        opened = [i for i in interactions if i.first_opened_at is not None]
        quiz_done = [i for i in interactions if i.quiz_attempted]
        avg_quiz = round(sum(i.quiz_score for i in quiz_done) / len(quiz_done), 2) if quiz_done else 0
        failed = sum(1 for i in quiz_done if not i.quiz_passed)
        not_opened = max(total_students - len(opened), 0)

        out.append({
            "id": c.id,
            "title": c.title,
            "capsule_type": c.capsule_type.value,
            "unlock_mode": c.unlock_mode.value,
            "min_attendance_pct": c.min_attendance_pct,
            "is_active": c.is_active,
            "ai_processed": c.ai_processed,
            "view_count": c.view_count,
            "download_count": c.download_count,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "interactions_summary": {
                "total_students": total_students,
                "read_count": len(opened),
                "avg_quiz_score": avg_quiz,
                "failed_comprehension_count": failed,
                "not_opened_count": not_opened,
            },
        })
    return {"subject_id": subject_id, "capsules": out, "total": len(out)}


@router.get("/teacher/capsule/{capsule_id}/analytics")
def teacher_capsule_analytics(
    capsule_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "teacher")
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")
    if capsule.teacher_id != current_user["id"]:
        raise HTTPException(403, "You did not create this capsule")

    subj = db.query(Subject).filter(Subject.id == capsule.subject_id).first()
    student_q = db.query(User).filter(
        User.role == UserRole.student,
        User.is_active == True,  # noqa: E712
    )
    if subj:
        student_q = student_q.filter(User.course_id == subj.course_id, User.semester == subj.semester)
    if capsule.section_id is not None:
        student_q = student_q.filter(User.section_id == capsule.section_id)
    students = student_q.all()

    inter_map = {
        i.student_id: i for i in
        db.query(CapsuleInteraction).filter(CapsuleInteraction.capsule_id == capsule.id).all()
    }
    section_map = {s.id: s.name for s in db.query(Section).all()}

    breakdown = []
    opened_count = 0
    pass_count = 0
    fail_count = 0
    total_time = 0
    total_completion = 0.0
    comprehension_issues = []
    for s in students:
        i = inter_map.get(s.id)
        opened = bool(i and i.first_opened_at)
        if opened:
            opened_count += 1
            total_time += i.total_time_spent_sec
            total_completion += i.completion_pct
            if i.quiz_attempted and i.quiz_passed:
                pass_count += 1
            elif i.quiz_attempted and not i.quiz_passed:
                fail_count += 1
                comprehension_issues.append({
                    "student_id": s.id,
                    "name": s.name,
                    "roll_no": s.roll_number,
                    "quiz_score": i.quiz_score,
                })
        breakdown.append({
            "student_id": s.id,
            "name": s.name,
            "roll_no": s.roll_number,
            "section_name": section_map.get(s.section_id),
            "opened": opened,
            "time_spent_sec": i.total_time_spent_sec if i else 0,
            "completion_pct": i.completion_pct if i else 0.0,
            "quiz_score": i.quiz_score if i and i.quiz_attempted else None,
            "quiz_passed": i.quiz_passed if i and i.quiz_attempted else None,
            "last_opened_at": i.last_opened_at.isoformat() if i and i.last_opened_at else None,
        })

    total_enrolled = len(students)
    not_opened_count = max(total_enrolled - opened_count, 0)
    avg_time_sec = round(total_time / opened_count, 1) if opened_count else 0
    avg_completion_pct = round(total_completion / opened_count, 1) if opened_count else 0.0

    return {
        "capsule": {
            "id": capsule.id,
            "title": capsule.title,
            "capsule_type": capsule.capsule_type.value,
            "unlock_mode": capsule.unlock_mode.value,
            "is_active": capsule.is_active,
            "view_count": capsule.view_count,
            "download_count": capsule.download_count,
            "created_at": capsule.created_at.isoformat() if capsule.created_at else None,
        },
        "per_student_breakdown": breakdown,
        "summary": {
            "total_enrolled": total_enrolled,
            "opened_count": opened_count,
            "avg_time_sec": avg_time_sec,
            "avg_completion_pct": avg_completion_pct,
            "pass_count": pass_count,
            "fail_count": fail_count,
            "not_opened_count": not_opened_count,
        },
        "comprehension_issues": comprehension_issues,
    }


@router.get("/teacher/subject/{subject_id}/wall")
def teacher_view_wall(
    subject_id: int,
    status_filter: str = Query("all", alias="status"),
    is_hot: Optional[bool] = Query(None),
    capsule_id: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "teacher", "hod", "principal")
    if current_user["role"] == "teacher":
        if not _teacher_owns_subject(db, current_user["id"], subject_id):
            raise HTTPException(403, "You do not teach this subject")

    q = db.query(ClassWallPost).filter(ClassWallPost.subject_id == subject_id)
    if status_filter != "all":
        if status_filter not in {s.value for s in WallPostStatus}:
            raise HTTPException(400, "Invalid status filter")
        q = q.filter(ClassWallPost.status == WallPostStatus(status_filter))
    if is_hot is not None:
        q = q.filter(ClassWallPost.is_hot == is_hot)
    if capsule_id is not None:
        q = q.filter(ClassWallPost.capsule_id == capsule_id)

    posts = q.order_by(desc(ClassWallPost.is_hot), desc(ClassWallPost.created_at)).all()
    student_ids = list({p.student_id for p in posts})
    capsule_ids = list({p.capsule_id for p in posts if p.capsule_id})
    students = {u.id: u for u in db.query(User).filter(User.id.in_(student_ids)).all()} if student_ids else {}
    capsules = {c.id: c for c in db.query(Capsule).filter(Capsule.id.in_(capsule_ids)).all()} if capsule_ids else {}

    out = []
    for p in posts:
        s = students.get(p.student_id)
        c = capsules.get(p.capsule_id) if p.capsule_id else None
        out.append({
            "id": p.id,
            "content": p.content,
            "student_name": s.name if s else None,
            "student_roll_no": s.roll_number if s else None,
            "capsule_id": p.capsule_id,
            "capsule_title": c.title if c else None,
            "page_number": p.page_number,
            "ai_suggested_answer": p.ai_suggested_answer,
            "ai_answer_confidence": p.ai_answer_confidence,
            "teacher_answer": p.teacher_answer,
            "resonance_count": p.resonance_count,
            "status": p.status.value,
            "is_hot": p.is_hot,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return {"subject_id": subject_id, "posts": out, "total": len(out)}


@router.post("/teacher/wall/{post_id}/answer")
def teacher_answer_wall(
    post_id: int,
    body: TeacherAnswerRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "teacher")
    post = db.query(ClassWallPost).filter(ClassWallPost.id == post_id).first()
    if not post:
        raise HTTPException(404, "Post not found")
    if not _teacher_owns_subject(db, current_user["id"], post.subject_id):
        raise HTTPException(403, "You do not teach the subject of this post")

    post.teacher_answer = body.answer.strip()
    post.teacher_answered_by = current_user["id"]
    post.teacher_answered_at = datetime.now(tz=timezone.utc)
    post.status = WallPostStatus.answered
    db.commit()

    try:
        send_push_notification(
            user_id=post.student_id,
            title="✅ Your doubt was answered",
            body=f"Teacher replied to your doubt: '{post.content[:60]}'",
            db=db,
            data={"type": "classpulse_answer", "post_id": post.id, "subject_id": post.subject_id},
        )
    except Exception as exc:
        logger.warning("notify student of teacher answer failed: %s", exc)

    logger.info("💬 Teacher %d answered wall post %d", current_user["id"], post_id)
    return {"ok": True, "post_id": post.id, "status": post.status.value}


@router.get("/teacher/dashboard")
def teacher_dashboard(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "teacher")
    teacher_id = current_user["id"]
    subjects = db.query(Subject).filter(Subject.teacher_id == teacher_id).all()
    section_map = {s.id: s.name for s in db.query(Section).all()}

    subjects_out = []
    for s in subjects:
        capsules = db.query(Capsule).filter(
            Capsule.subject_id == s.id, Capsule.teacher_id == teacher_id, Capsule.is_active == True  # noqa: E712
        ).all()
        capsule_ids = [c.id for c in capsules]

        total_students = db.query(User).filter(
            User.role == UserRole.student, User.is_active == True,  # noqa: E712
            User.course_id == s.course_id, User.semester == s.semester,
        ).count()

        if capsule_ids and total_students:
            interactions = db.query(CapsuleInteraction).filter(
                CapsuleInteraction.capsule_id.in_(capsule_ids)
            ).all()
            opened = sum(1 for i in interactions if i.first_opened_at is not None)
            possible = len(capsule_ids) * total_students
            avg_engagement = round((opened / possible) * 100, 1) if possible else 0.0
        else:
            avg_engagement = 0.0

        hot = db.query(ClassWallPost).filter(
            ClassWallPost.subject_id == s.id, ClassWallPost.is_hot == True  # noqa: E712
        ).count()
        unanswered = db.query(ClassWallPost).filter(
            ClassWallPost.subject_id == s.id,
            ClassWallPost.status == WallPostStatus.open,
        ).count()
        # primary section for display (multi-section subject just shows first)
        any_section = next((c.section_id for c in capsules if c.section_id), None)
        subjects_out.append({
            "subject_id": s.id,
            "subject_name": s.name,
            "section_name": section_map.get(any_section),
            "capsule_count": len(capsules),
            "total_students": total_students,
            "avg_engagement_pct": avg_engagement,
            "hot_doubts_count": hot,
            "unanswered_doubts_count": unanswered,
        })

    # recent activity (last 10 across all this teacher's capsules)
    capsule_ids = [c.id for c in db.query(Capsule).filter(Capsule.teacher_id == teacher_id).all()]
    recent = []
    if capsule_ids:
        recent_q = (
            db.query(CapsuleAccessLog)
            .filter(CapsuleAccessLog.capsule_id.in_(capsule_ids))
            .order_by(desc(CapsuleAccessLog.created_at))
            .limit(10).all()
        )
        users = {u.id: u for u in db.query(User).filter(User.id.in_({r.user_id for r in recent_q})).all()}
        capsule_titles = {c.id: c.title for c in db.query(Capsule).filter(Capsule.id.in_(capsule_ids)).all()}
        for r in recent_q:
            u = users.get(r.user_id)
            recent.append({
                "capsule_id": r.capsule_id,
                "capsule_title": capsule_titles.get(r.capsule_id),
                "student_name": u.name if u else None,
                "student_roll_no": u.roll_number if u else None,
                "action": r.action.value,
                "deny_reason": r.deny_reason,
                "at": r.created_at.isoformat() if r.created_at else None,
            })

    # attention_needed
    attention = []
    for c in db.query(Capsule).filter(Capsule.teacher_id == teacher_id, Capsule.is_active == True).all():  # noqa: E712
        subj = next((x for x in subjects if x.id == c.subject_id), None)
        total_enrolled = db.query(User).filter(
            User.role == UserRole.student, User.is_active == True,  # noqa: E712
            User.course_id == subj.course_id if subj else 0,
            User.semester == subj.semester if subj else 0,
        ).count() if subj else 0
        if c.section_id is not None:
            total_enrolled = db.query(User).filter(
                User.role == UserRole.student, User.is_active == True,  # noqa: E712
                User.section_id == c.section_id,
            ).count()

        interactions = db.query(CapsuleInteraction).filter(CapsuleInteraction.capsule_id == c.id).all()
        opened = sum(1 for i in interactions if i.first_opened_at is not None)
        failed = sum(1 for i in interactions if i.quiz_attempted and not i.quiz_passed)
        not_opened_pct = round((1 - (opened / total_enrolled)) * 100, 1) if total_enrolled else 0.0
        if failed >= 3 or not_opened_pct >= 50:
            attention.append({
                "capsule_id": c.id,
                "capsule_title": c.title,
                "subject_name": subj.name if subj else None,
                "failed_comprehension_students": failed,
                "not_opened_pct": not_opened_pct,
            })

    return {
        "subjects": subjects_out,
        "recent_activity": recent,
        "attention_needed": attention,
    }


# ═══════════════════════════════════════════════════════════════════════
# STUDENT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

@router.get("/student/subject/{subject_id}/capsules")
def student_list_capsules(
    subject_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student:
        raise HTTPException(404, "User not found")
    if not _student_in_subject(db, student, subject_id):
        raise HTTPException(403, "You are not enrolled in this subject")

    capsules = db.query(Capsule).filter(
        Capsule.subject_id == subject_id, Capsule.is_active == True  # noqa: E712
    )
    # Section-targeted capsules: include if student's section matches OR capsule is for all
    capsules = capsules.filter(
        (Capsule.section_id.is_(None)) | (Capsule.section_id == student.section_id)
    ).order_by(desc(Capsule.created_at)).all()

    teacher_ids = list({c.teacher_id for c in capsules})
    teachers = {u.id: u.name for u in db.query(User).filter(User.id.in_(teacher_ids)).all()} if teacher_ids else {}
    capsule_ids = [c.id for c in capsules]
    interactions = {
        i.capsule_id: i for i in
        db.query(CapsuleInteraction).filter(
            CapsuleInteraction.capsule_id.in_(capsule_ids),
            CapsuleInteraction.student_id == student.id,
        ).all()
    } if capsule_ids else {}

    out = []
    for c in capsules:
        access_status, meta = _resolve_access_status(db, student, c)

        summary_obj = None
        key_points = []
        est_read = None
        if c.ai_summary:
            try:
                parsed = json.loads(c.ai_summary)
                if isinstance(parsed, dict):
                    summary_obj = parsed.get("summary")
                    key_points = parsed.get("key_points") or []
                    est_read = parsed.get("estimated_read_time_min")
            except (json.JSONDecodeError, TypeError):
                summary_obj = c.ai_summary

        i = interactions.get(c.id)
        my_interaction = None
        if i:
            my_interaction = {
                "opened": bool(i.first_opened_at),
                "quiz_attempted": i.quiz_attempted,
                "quiz_passed": i.quiz_passed,
                "quiz_score": i.quiz_score,
                "completion_pct": i.completion_pct,
                "download_allowed": i.download_allowed,
            }

        out.append({
            "capsule_id": c.id,
            "title": c.title,
            "capsule_type": c.capsule_type.value,
            "description": c.description,
            "ai_summary": summary_obj,
            "key_points": key_points,
            "estimated_read_time_min": est_read,
            "ai_processed": c.ai_processed,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "teacher_name": teachers.get(c.teacher_id),
            "access_status": access_status,
            "access_meta": meta,
            "my_interaction": my_interaction,
            "featured": bool(getattr(c, "featured", False)),
            "featured_at": c.featured_at.isoformat() if getattr(c, "featured_at", None) else None,
        })
    return {"subject_id": subject_id, "capsules": out, "total": len(out)}


@router.get("/student/capsule/{capsule_id}/file")
def student_stream_capsule_file(
    capsule_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream the (un-watermarked) source file inline for in-browser viewing.

    Access is re-validated on every request. Used by the student PDF viewer.
    Watermarked downloads still go through the dedicated /download endpoint.
    """
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student:
        raise HTTPException(404, "User not found")
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")

    access_status, _meta = _resolve_access_status(db, student, capsule)
    DENY = {
        "not_enrolled", "wrong_section", "capsule_inactive",
        "locked_session_ended", "locked_attend_first", "locked_no_attendance",
        "summary_only",
    }
    if access_status in DENY:
        _log_access(db, capsule_id, student.id, CapsuleAccessAction.view_denied,
                    request=request, deny_reason=access_status)
        raise HTTPException(403, "Access denied for this capsule")

    if not capsule.file_url or not os.path.isfile(capsule.file_url):
        raise HTTPException(404, "No file attached to this capsule")

    return FileResponse(
        capsule.file_url,
        media_type=capsule.file_mime_type or "application/octet-stream",
        filename=capsule.file_name or os.path.basename(capsule.file_url),
        headers={"Content-Disposition": f'inline; filename="{capsule.file_name or "capsule"}"'},
    )


@router.get("/student/capsule/{capsule_id}/voice")
def student_stream_capsule_voice(
    capsule_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stream the teacher's voice memo for a capsule (authenticated)."""
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student:
        raise HTTPException(404, "User not found")
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")

    access_status, _meta = _resolve_access_status(db, student, capsule)
    DENY = {
        "not_enrolled", "wrong_section", "capsule_inactive",
        "locked_session_ended", "locked_attend_first", "locked_no_attendance",
    }
    if access_status in DENY:
        raise HTTPException(403, "Access denied for this capsule")

    if not capsule.voice_memo_url or not os.path.isfile(capsule.voice_memo_url):
        raise HTTPException(404, "No voice memo for this capsule")

    return FileResponse(
        capsule.voice_memo_url,
        media_type="audio/webm",
        headers={"Content-Disposition": 'inline; filename="voice-memo.webm"'},
    )


@router.post("/student/capsule/{capsule_id}/open")
def student_open_capsule(
    capsule_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student:
        raise HTTPException(404, "User not found")
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")

    # Subject enrollment guard (centralized)
    if not verify_student_subject_access(student.id, capsule.subject_id, db):
        _log_access(db, capsule_id, student.id, CapsuleAccessAction.view_denied,
                    request=request, deny_reason="not_enrolled")
        raise HTTPException(403, detail={"error": "Access denied", "reason": "not_enrolled"})

    # Rate limit: max 10 opens per capsule per day
    _rate_limit_check("open_capsule", student.id, capsule_id)

    _log_access(db, capsule_id, student.id, CapsuleAccessAction.view_attempt, request=request)

    access_status, meta = _resolve_access_status(db, student, capsule)
    DENY = {
        "not_enrolled", "wrong_section", "capsule_inactive",
        "locked_session_ended", "locked_attend_first", "locked_no_attendance",
    }
    if access_status in DENY:
        _log_access(db, capsule_id, student.id, CapsuleAccessAction.view_denied,
                    request=request, deny_reason=access_status)
        raise HTTPException(
            403,
            detail={
                "error": "Access denied",
                "reason": access_status,
                "attendance_pct": meta.get("attendance_pct"),
                "min_required": meta.get("min_required"),
            },
        )

    inter = _get_or_create_interaction(db, capsule_id, student.id)
    now = datetime.now(tz=timezone.utc)
    if inter.first_opened_at is None:
        inter.first_opened_at = now
    inter.last_opened_at = now
    capsule.view_count = (capsule.view_count or 0) + 1
    db.commit()
    db.refresh(inter)
    db.refresh(capsule)

    _log_access(db, capsule_id, student.id, CapsuleAccessAction.view_granted, request=request)

    summary_obj = None
    if capsule.ai_summary:
        try:
            summary_obj = json.loads(capsule.ai_summary)
        except (json.JSONDecodeError, TypeError):
            summary_obj = {"summary": capsule.ai_summary}

    quiz_for_student = _strip_quiz_answers(capsule.ai_quiz_json) if capsule.ai_quiz_json else []

    file_url = capsule.file_url
    voice_url = capsule.voice_memo_url
    # In summary_only mode we don't return file_url
    if access_status == "summary_only":
        file_url = None
        voice_url = None

    # ── Signed URLs (replace direct file_url for the PDF viewer) ────────
    signed_view_url = None
    signed_download_url = None
    signed_url_expires_at = None
    if file_url:
        signed_view_url = generate_signed_capsule_url(
            file_path=capsule.file_url,
            student_id=student.id,
            capsule_id=capsule.id,
            expires_in_minutes=30,
            mode="view",
        )
        signed_url_expires_at = (now + timedelta(minutes=30)).isoformat()
        if inter.download_allowed:
            signed_download_url = generate_signed_capsule_url(
                file_path=capsule.file_url,
                student_id=student.id,
                capsule_id=capsule.id,
                expires_in_minutes=30,
                mode="download",
            )

    return {
        "capsule_id": capsule.id,
        "title": capsule.title,
        "capsule_type": capsule.capsule_type.value,
        "access_status": access_status,
        "access_meta": meta,
        "file_url": file_url,
        "file_name": capsule.file_name,
        "file_mime_type": capsule.file_mime_type,
        "voice_memo_url": voice_url,
        "signed_view_url": signed_view_url,
        "signed_download_url": signed_download_url,
        "signed_url_expires_at": signed_url_expires_at,
        "signed_url_ttl_minutes": 30,
        "ai_summary": summary_obj,
        "ai_quiz_json": quiz_for_student,
        "interaction": {
            "id": inter.id,
            "first_opened_at": inter.first_opened_at.isoformat() if inter.first_opened_at else None,
            "last_opened_at": inter.last_opened_at.isoformat() if inter.last_opened_at else None,
            "total_time_spent_sec": inter.total_time_spent_sec,
            "completion_pct": inter.completion_pct,
            "quiz_attempted": inter.quiz_attempted,
            "quiz_passed": inter.quiz_passed,
            "quiz_score": inter.quiz_score,
            "download_allowed": inter.download_allowed,
        },
    }


@router.post("/student/capsule/{capsule_id}/heartbeat")
def student_heartbeat(
    capsule_id: int,
    body: HeartbeatRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "student")
    inter = db.query(CapsuleInteraction).filter(
        CapsuleInteraction.capsule_id == capsule_id,
        CapsuleInteraction.student_id == current_user["id"],
    ).first()
    if not inter:
        raise HTTPException(404, "Open the capsule first")

    inter.total_time_spent_sec = (inter.total_time_spent_sec or 0) + HEARTBEAT_INCREMENT_SEC
    if body.total_pages > 0:
        inter.total_pages = body.total_pages
        inter.pages_viewed = max(inter.pages_viewed, min(body.pages_viewed, body.total_pages))
        inter.completion_pct = round((inter.pages_viewed / body.total_pages) * 100, 1)
    inter.last_opened_at = datetime.now(tz=timezone.utc)
    db.commit()
    return {"ok": True, "total_time_spent_sec": inter.total_time_spent_sec, "completion_pct": inter.completion_pct}


@router.post("/student/capsule/{capsule_id}/submit-quiz")
def student_submit_quiz(
    capsule_id: int,
    body: QuizSubmitRequest,
    background: BackgroundTasks,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student:
        raise HTTPException(404, "User not found")
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")
    if not capsule.ai_quiz_json:
        raise HTTPException(400, "No quiz available for this capsule yet")

    inter = _get_or_create_interaction(db, capsule_id, student.id)
    # ── Quiz retry policy (Prompt 6): up to 2 attempts, 24h cooldown ──
    now_dt = datetime.now(tz=timezone.utc)
    if inter.quiz_passed:
        raise HTTPException(403, "Quiz already passed")
    attempts_used = inter.quiz_attempts_count or 0
    if attempts_used >= QUIZ_MAX_ATTEMPTS:
        raise HTTPException(403, "Max quiz attempts (2) reached")
    if attempts_used > 0 and inter.last_quiz_at:
        last = inter.last_quiz_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        elapsed = now_dt - last
        cooldown = timedelta(hours=QUIZ_RETRY_COOLDOWN_HOURS)
        if elapsed < cooldown:
            secs = int((cooldown - elapsed).total_seconds())
            raise HTTPException(
                429,
                f"Please wait {secs // 3600}h {(secs % 3600) // 60}m before retrying",
            )

    # Suspicious-activity flag for ultra-fast quiz answers (logged, not blocking)
    if body.elapsed_seconds is not None:
        check_suspicious_activity(
            student.id, capsule.id, db,
            request=request, quiz_seconds=body.elapsed_seconds,
        )

    _log_access(db, capsule_id, student.id, CapsuleAccessAction.quiz_submit, request=request)

    quiz = capsule.ai_quiz_json if isinstance(capsule.ai_quiz_json, list) else []
    score = 0
    correct_answers = {}
    explanations = {}
    detail = []
    for idx, q in enumerate(quiz):
        if not isinstance(q, dict):
            continue
        key = f"Q{idx + 1}"
        correct = str(q.get("correct_answer", "")).upper()
        student_ans = str(body.answers.get(key, "")).upper()
        is_correct = (student_ans == correct and correct in {"A", "B", "C", "D"})
        if is_correct:
            score += 1
        correct_answers[key] = correct
        explanations[key] = q.get("explanation", "")
        detail.append({
            "key": key,
            "question": q.get("question"),
            "your_answer": student_ans,
            "correct_answer": correct,
            "is_correct": is_correct,
            "explanation": q.get("explanation"),
        })

    passed = score >= QUIZ_PASS_SCORE
    inter.quiz_attempted = True
    inter.quiz_attempts_count = (inter.quiz_attempts_count or 0) + 1
    inter.last_quiz_at = now_dt
    inter.quiz_score = score
    inter.quiz_passed = passed
    inter.quiz_answers_json = body.answers

    # Decide download_allowed:
    # if not in read_only access mode → unlock when passed
    access_status, _ = _resolve_access_status(db, student, capsule)
    if passed and access_status != "read_only":
        inter.download_allowed = True
    db.commit()

    _log_access(
        db, capsule_id, student.id,
        CapsuleAccessAction.quiz_pass if passed else CapsuleAccessAction.quiz_fail,
        request=request,
    )

    if not passed:
        background.add_task(_notify_tutor_quiz_fail, student.id, capsule.id, score)

    attempts_remaining = max(0, QUIZ_MAX_ATTEMPTS - (inter.quiz_attempts_count or 0))
    can_retry = (not passed) and attempts_remaining > 0

    return {
        "score": score,
        "out_of": len(quiz),
        "passed": passed,
        "download_allowed": inter.download_allowed,
        "correct_answers": correct_answers,
        "explanations": explanations,
        "detail": detail,
        "attempts_used": inter.quiz_attempts_count,
        "attempts_remaining": attempts_remaining,
        "can_retry": can_retry,
        "retry_after": (now_dt + timedelta(hours=QUIZ_RETRY_COOLDOWN_HOURS)).isoformat() if can_retry else None,
        "message": "Great job!" if passed else "Review the material and revisit key points.",
    }


@router.post("/student/capsule/{capsule_id}/download")
async def student_download_capsule(
    capsule_id: int,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student:
        raise HTTPException(404, "User not found")
    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not capsule:
        raise HTTPException(404, "Capsule not found")
    if not capsule.file_url or not os.path.isfile(capsule.file_url):
        raise HTTPException(404, "No downloadable file for this capsule")

    _log_access(db, capsule_id, student.id, CapsuleAccessAction.download_attempt, request=request)

    inter = _get_or_create_interaction(db, capsule_id, student.id)
    inter.download_attempted = True
    db.commit()

    # Suspicious flag: download attempt without any heartbeats
    check_suspicious_activity(student.id, capsule.id, db,
                              request=request, download_attempt=True)

    # Centralized download access check
    allowed, deny_reason, ctx = await check_capsule_access(
        capsule, student, db, require_mode="download"
    )
    if not allowed:
        _log_access(db, capsule_id, student.id, CapsuleAccessAction.download_denied,
                    request=request, deny_reason=deny_reason)
        raise HTTPException(403, detail={
            "error": "Download not allowed",
            "reason": deny_reason,
            "access_meta": ctx,
        })

    # Periodic GC of expired watermarks
    _cleanup_old_watermarks()
    try:
        cleanup_expired_watermarks()
    except Exception:
        pass

    is_pdf = (capsule.file_mime_type or "").lower() == "application/pdf" or \
             (capsule.file_url or "").lower().endswith(".pdf")

    subj = db.query(Subject).filter(Subject.id == capsule.subject_id).first()
    subject_name = subj.name if subj else "Subject"
    college_name = getattr(settings, "COLLEGE_NAME", "AutoAttend AI")

    if is_pdf:
        try:
            wm_path = await watermark_pdf_for_student(
                file_path=capsule.file_url,
                student_name=student.name or "Student",
                roll_no=student.roll_number or "N/A",
                subject_name=subject_name,
                capsule_title=capsule.title,
                college_name=college_name,
            )
        except Exception as exc:
            logger.error("watermark failed for capsule %d: %s", capsule_id, exc)
            raise HTTPException(500, "Failed to prepare watermarked file")
        inter.watermarked_url = wm_path
        capsule.download_count = (capsule.download_count or 0) + 1
        db.commit()
        _log_access(db, capsule_id, student.id, CapsuleAccessAction.download_granted, request=request)
        safe_title = (capsule.title or "capsule").replace(" ", "_")
        safe_roll = (student.roll_number or str(student.id)).replace("/", "_")
        return FileResponse(
            wm_path,
            media_type="application/pdf",
            filename=f"{safe_title}_{safe_roll}.pdf",
        )

    # non-PDF — serve as-is (no watermark possible)
    capsule.download_count = (capsule.download_count or 0) + 1
    db.commit()
    _log_access(db, capsule_id, student.id, CapsuleAccessAction.download_granted, request=request)
    return FileResponse(
        capsule.file_url,
        media_type=capsule.file_mime_type or "application/octet-stream",
        filename=capsule.file_name or os.path.basename(capsule.file_url),
    )


@router.get("/student/subject/{subject_id}/wall")
def student_view_wall(
    subject_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student or not _student_in_subject(db, student, subject_id):
        raise HTTPException(403, "You are not enrolled in this subject")

    posts = (
        db.query(ClassWallPost)
        .filter(ClassWallPost.subject_id == subject_id)
        .order_by(desc(ClassWallPost.is_hot), desc(ClassWallPost.created_at))
        .all()
    )
    capsule_ids = list({p.capsule_id for p in posts if p.capsule_id})
    capsules = {c.id: c for c in db.query(Capsule).filter(Capsule.id.in_(capsule_ids)).all()} if capsule_ids else {}

    my_resonances = {
        r.post_id for r in db.query(ClassWallResonance).filter(
            ClassWallResonance.post_id.in_([p.id for p in posts]),
            ClassWallResonance.student_id == student.id,
        ).all()
    } if posts else set()

    out = []
    for p in posts:
        ai_answer = None
        if p.ai_suggested_answer and (p.ai_answer_confidence or 0) >= 0.6:
            ai_answer = p.ai_suggested_answer
        c = capsules.get(p.capsule_id) if p.capsule_id else None
        out.append({
            "id": p.id,
            "content": p.content if p.student_id == student.id else (p.content[:150] + ("…" if len(p.content) > 150 else "")),
            "full_content_for_owner": p.content if p.student_id == student.id else None,
            "resonance_count": p.resonance_count,
            "is_hot": p.is_hot,
            "status": p.status.value,
            "teacher_answer": p.teacher_answer,
            "ai_suggested_answer": ai_answer,
            "ai_answer_confidence": p.ai_answer_confidence if ai_answer else None,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "is_mine": p.student_id == student.id,
            "capsule_id": p.capsule_id,
            "capsule_title": c.title if c else None,
            "page_number": p.page_number,
            "i_resonated": p.id in my_resonances,
        })
    return {"subject_id": subject_id, "posts": out, "total": len(out)}


@router.post("/student/wall/post")
def student_post_doubt(
    body: WallPostRequest,
    background: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student:
        raise HTTPException(404, "User not found")
    if not verify_student_subject_access(student.id, body.subject_id, db):
        raise HTTPException(403, "You are not enrolled in this subject")

    # Rate-limit: max 5 posts per student per subject per day
    _rate_limit_check("wall_post", student.id, body.subject_id)

    section_id = body.section_id if body.section_id else student.section_id

    capsule_id = None
    if body.capsule_id:
        cap = db.query(Capsule).filter(Capsule.id == body.capsule_id).first()
        if not cap or cap.subject_id != body.subject_id:
            raise HTTPException(400, "capsule_id does not belong to this subject")
        capsule_id = cap.id

    post = ClassWallPost(
        subject_id=body.subject_id,
        section_id=section_id,
        student_id=student.id,
        capsule_id=capsule_id,
        page_number=body.page_number,
        content=body.content.strip(),
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    background.add_task(_process_doubt_ai, post.id)
    background.add_task(_notify_teacher_new_doubt, body.subject_id, post.id)

    logger.info("📝 Wall post %d created by student=%d subject=%d", post.id, student.id, body.subject_id)
    return {
        "id": post.id,
        "subject_id": post.subject_id,
        "capsule_id": post.capsule_id,
        "page_number": post.page_number,
        "content": post.content,
        "status": post.status.value,
        "resonance_count": post.resonance_count,
        "is_hot": post.is_hot,
        "created_at": post.created_at.isoformat() if post.created_at else None,
    }


@router.post("/student/wall/{post_id}/resonate")
def student_resonate(
    post_id: int,
    background: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "student")
    student_id = current_user["id"]
    post = db.query(ClassWallPost).filter(ClassWallPost.id == post_id).first()
    if not post:
        raise HTTPException(404, "Post not found")
    if post.student_id == student_id:
        raise HTTPException(400, "Cannot resonate your own post")

    # Rate-limit: max 50 resonances per student per hour
    _rate_limit_check("wall_resonate", student_id, 0)

    existing = db.query(ClassWallResonance).filter(
        ClassWallResonance.post_id == post_id,
        ClassWallResonance.student_id == student_id,
    ).first()

    if existing:
        db.delete(existing)
        post.resonance_count = max((post.resonance_count or 1) - 1, 0)
        if post.resonance_count < HOT_DOUBT_THRESHOLD:
            post.is_hot = False
        db.commit()
        return {"resonated": False, "resonance_count": post.resonance_count}

    db.add(ClassWallResonance(post_id=post_id, student_id=student_id))
    post.resonance_count = (post.resonance_count or 0) + 1
    became_hot = False
    if not post.is_hot and post.resonance_count >= HOT_DOUBT_THRESHOLD:
        post.is_hot = True
        became_hot = True
    db.commit()

    if became_hot:
        background.add_task(_notify_hot_doubt, post.id)

    return {"resonated": True, "resonance_count": post.resonance_count, "is_hot": post.is_hot}


# ═══════════════════════════════════════════════════════════════════════
# HOD ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

@router.get("/hod/department-analytics")
def hod_department_analytics(
    department_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "hod", "principal")
    hod = db.query(User).filter(User.id == current_user["id"]).first()
    # Principal may pass any department_id; HOD always uses their own
    if current_user["role"] == "principal" and department_id is not None:
        dept_id = department_id
    else:
        if not hod or hod.department_id is None:
            raise HTTPException(404, "Department context missing")
        dept_id = hod.department_id
    # Subjects in this department
    subjects = (
        db.query(Subject)
        .join(Subject.course)
        .filter(Subject.course.has(department_id=dept_id))
        .all()
    )
    subject_ids = [s.id for s in subjects]
    teachers = {u.id: u for u in db.query(User).filter(User.role == UserRole.teacher).all()}
    now = datetime.now(tz=timezone.utc)

    subjects_overview = []
    total_capsules = 0
    total_interactions = 0
    total_engagement = 0.0
    total_comprehension = 0.0
    counted_subjects = 0
    students_at_risk: set[int] = set()

    for s in subjects:
        capsules = db.query(Capsule).filter(
            Capsule.subject_id == s.id, Capsule.is_active == True  # noqa: E712
        ).all()
        capsule_ids = [c.id for c in capsules]
        total_capsules += len(capsules)

        last_upload_days = None
        if capsules:
            last_dt = max((c.created_at for c in capsules if c.created_at), default=None)
            if last_dt:
                last_upload_days = (now - last_dt).days

        interactions = []
        if capsule_ids:
            interactions = db.query(CapsuleInteraction).filter(
                CapsuleInteraction.capsule_id.in_(capsule_ids)
            ).all()
        total_interactions += len(interactions)

        opened = sum(1 for i in interactions if i.first_opened_at is not None)
        quiz_done = [i for i in interactions if i.quiz_attempted]
        comp_pct = round(
            (sum(1 for i in quiz_done if i.quiz_passed) / len(quiz_done)) * 100, 1
        ) if quiz_done else 0.0

        total_students = db.query(User).filter(
            User.role == UserRole.student, User.is_active == True,  # noqa: E712
            User.course_id == s.course_id, User.semester == s.semester,
        ).count()
        possible = len(capsule_ids) * total_students
        engagement_pct = round((opened / possible) * 100, 1) if possible else 0.0

        if capsule_ids:
            counted_subjects += 1
            total_engagement += engagement_pct
            total_comprehension += comp_pct

        # students with multiple quiz failures count as at-risk
        from collections import Counter
        fail_counter = Counter(i.student_id for i in interactions if i.quiz_attempted and not i.quiz_passed)
        for sid, n in fail_counter.items():
            if n > 2:
                students_at_risk.add(sid)

        hot_count = db.query(ClassWallPost).filter(
            ClassWallPost.subject_id == s.id, ClassWallPost.is_hot == True  # noqa: E712
        ).count()

        subjects_overview.append({
            "subject_id": s.id,
            "subject_name": s.name,
            "teacher_id": s.teacher_id,
            "teacher_name": teachers[s.teacher_id].name if s.teacher_id in teachers else None,
            "total_capsules": len(capsules),
            "avg_engagement_pct": engagement_pct,
            "avg_comprehension_pct": comp_pct,
            "hot_doubts_count": hot_count,
            "last_upload_days_ago": last_upload_days,
            "content_gap_alert": (last_upload_days is None) or (last_upload_days > 14),
        })

    avg_engagement = round(total_engagement / counted_subjects, 1) if counted_subjects else 0.0
    avg_comprehension = round(total_comprehension / counted_subjects, 1) if counted_subjects else 0.0

    # top 5 most resonated wall posts in dept
    top_posts_q = (
        db.query(ClassWallPost)
        .filter(ClassWallPost.subject_id.in_(subject_ids) if subject_ids else False)
        .order_by(desc(ClassWallPost.resonance_count), desc(ClassWallPost.created_at))
        .limit(5)
        .all()
    ) if subject_ids else []
    subj_name_map = {s.id: s.name for s in subjects}
    top_doubts = [{
        "id": p.id,
        "subject_id": p.subject_id,
        "subject_name": subj_name_map.get(p.subject_id),
        "content": p.content[:200],
        "resonance_count": p.resonance_count,
        "is_hot": p.is_hot,
        "status": p.status.value,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    } for p in top_posts_q]

    # last 7-day daily engagement counts
    seven_days_ago = (now - timedelta(days=7)).date()
    daily_counts = {}
    if subject_ids:
        capsule_id_list = [c.id for c in db.query(Capsule).filter(Capsule.subject_id.in_(subject_ids)).all()]
        if capsule_id_list:
            rows = (
                db.query(
                    sqlfunc.date(CapsuleAccessLog.created_at).label("d"),
                    sqlfunc.count(CapsuleAccessLog.id).label("n"),
                )
                .filter(
                    CapsuleAccessLog.capsule_id.in_(capsule_id_list),
                    CapsuleAccessLog.created_at >= seven_days_ago,
                )
                .group_by("d").order_by("d").all()
            )
            for d, n in rows:
                daily_counts[str(d)] = int(n)
    engagement_trend = [{"date": str(seven_days_ago + timedelta(days=i)),
                         "count": daily_counts.get(str(seven_days_ago + timedelta(days=i)), 0)}
                        for i in range(8)]

    # teachers not using
    dept_teachers = db.query(User).filter(
        User.department_id == dept_id, User.role == UserRole.teacher, User.is_active == True  # noqa: E712
    ).all()
    teachers_not_using = []
    for t in dept_teachers:
        last_capsule = db.query(Capsule).filter(Capsule.teacher_id == t.id).order_by(desc(Capsule.created_at)).first()
        if not last_capsule:
            teachers_not_using.append({"teacher_id": t.id, "name": t.name, "last_upload": None})
        elif last_capsule.created_at and (now - last_capsule.created_at).days > 14:
            teachers_not_using.append({
                "teacher_id": t.id, "name": t.name,
                "last_upload": last_capsule.created_at.isoformat(),
                "days_ago": (now - last_capsule.created_at).days,
            })

    return {
        "department_id": dept_id,
        "subjects_overview": subjects_overview,
        "department_stats": {
            "total_capsules": total_capsules,
            "total_interactions": total_interactions,
            "avg_engagement_pct": avg_engagement,
            "avg_comprehension_pct": avg_comprehension,
            "students_at_risk_count": len(students_at_risk),
        },
        "top_doubts": top_doubts,
        "engagement_trend": engagement_trend,
        "teachers_not_using": teachers_not_using,
    }


@router.get("/hod/subject/{subject_id}/full-report")
def hod_subject_full_report(
    subject_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_role(current_user, "hod", "principal")
    hod = db.query(User).filter(User.id == current_user["id"]).first()
    subj = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subj:
        raise HTTPException(404, "Subject not found")
    if current_user["role"] == "hod":
        course = subj.course
        if not course or hod.department_id != course.department_id:
            raise HTTPException(403, "Subject not in your department")

    capsules = db.query(Capsule).filter(Capsule.subject_id == subject_id).order_by(desc(Capsule.created_at)).all()
    students = db.query(User).filter(
        User.role == UserRole.student, User.is_active == True,  # noqa: E712
        User.course_id == subj.course_id, User.semester == subj.semester,
    ).all()
    capsule_ids = [c.id for c in capsules]
    interactions = (
        db.query(CapsuleInteraction).filter(CapsuleInteraction.capsule_id.in_(capsule_ids)).all()
        if capsule_ids else []
    )
    inter_idx = {(i.capsule_id, i.student_id): i for i in interactions}

    # Build per-student matrix
    matrix = []
    for s in students:
        row = {"student_id": s.id, "name": s.name, "roll_no": s.roll_number, "capsules": []}
        for c in capsules:
            i = inter_idx.get((c.id, s.id))
            row["capsules"].append({
                "capsule_id": c.id,
                "title": c.title,
                "opened": bool(i and i.first_opened_at),
                "completion_pct": i.completion_pct if i else 0.0,
                "quiz_passed": i.quiz_passed if i and i.quiz_attempted else None,
                "quiz_score": i.quiz_score if i and i.quiz_attempted else None,
            })
        matrix.append(row)

    wall_posts = db.query(ClassWallPost).filter(ClassWallPost.subject_id == subject_id).all()
    wall_summary = {
        "total": len(wall_posts),
        "open": sum(1 for p in wall_posts if p.status == WallPostStatus.open),
        "answered": sum(1 for p in wall_posts if p.status == WallPostStatus.answered),
        "hot": sum(1 for p in wall_posts if p.is_hot),
    }

    return {
        "subject": {
            "id": subj.id, "name": subj.name, "code": subj.code,
            "teacher_id": subj.teacher_id,
        },
        "capsules": [{
            "id": c.id, "title": c.title, "capsule_type": c.capsule_type.value,
            "unlock_mode": c.unlock_mode.value, "is_active": c.is_active,
            "view_count": c.view_count, "download_count": c.download_count,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        } for c in capsules],
        "per_student_matrix": matrix,
        "wall_summary": wall_summary,
    }


# ═══════════════════════════════════════════════════════════════════════
# SIGNED-URL FILE SERVING — no auth header (URL itself is the auth)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/serve/{token}")
async def serve_signed_capsule(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Serve a capsule file via a short-lived signed URL.

    No Bearer token is required — the JWT in the path IS the credential.
    Verifies signature + expiry + purpose, then re-checks live access via
    ``check_capsule_access`` (fail-safe: any error → 403).
    """
    payload = verify_signed_url(token)  # raises 403 on bad/expired
    file_path = payload.get("file_path")
    student_id = int(payload.get("student_id"))
    capsule_id = int(payload.get("capsule_id"))
    mode = payload.get("mode", "view")

    capsule = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    student = db.query(User).filter(User.id == student_id).first()
    if not capsule or not student:
        raise HTTPException(403, "Resource not found")

    # Re-verify live access (in case the unlock state changed)
    allowed, deny_reason, _ctx = await check_capsule_access(
        capsule, student, db, require_mode=mode
    )
    if not allowed:
        _log_access(db, capsule_id, student.id, CapsuleAccessAction.view_denied,
                    request=request,
                    deny_reason=f"signed_{mode}:{deny_reason}")
        raise HTTPException(403, f"Access denied: {deny_reason}")

    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(404, "File missing")

    if mode == "download":
        # Download path — must produce/serve a watermarked copy
        inter = _get_or_create_interaction(db, capsule.id, student.id)
        wm_path = inter.watermarked_url if inter.watermarked_url and \
            os.path.isfile(inter.watermarked_url) else None
        if not wm_path:
            try:
                subj = db.query(Subject).filter(Subject.id == capsule.subject_id).first()
                wm_path = await watermark_pdf_for_student(
                    file_path=file_path,
                    student_name=student.name or "Student",
                    roll_no=student.roll_number or "N/A",
                    subject_name=subj.name if subj else "Subject",
                    capsule_title=capsule.title,
                    college_name=getattr(settings, "COLLEGE_NAME", "AutoAttend AI"),
                )
                inter.watermarked_url = wm_path
                capsule.download_count = (capsule.download_count or 0) + 1
                db.commit()
            except Exception as exc:
                logger.error("signed download watermark failed: %s", exc)
                raise HTTPException(500, "Failed to prepare watermarked file")
        _log_access(db, capsule.id, student.id,
                    CapsuleAccessAction.download_granted, request=request)
        safe_title = (capsule.title or "capsule").replace(" ", "_")
        safe_roll = (student.roll_number or str(student.id)).replace("/", "_")
        return FileResponse(
            wm_path,
            media_type="application/pdf",
            filename=f"{safe_title}_{safe_roll}.pdf",
        )

    # mode == "view" — inline serve original with anti-embed headers
    _log_access(db, capsule.id, student.id,
                CapsuleAccessAction.view_granted, request=request)
    return FileResponse(
        file_path,
        media_type=capsule.file_mime_type or "application/pdf",
        filename=capsule.file_name or os.path.basename(file_path),
        headers={
            "Content-Disposition": "inline",
            "X-Frame-Options": "SAMEORIGIN",
            "Content-Security-Policy": "frame-ancestors 'self'",
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ═══════════════════════════════════════════════════════════════════════
# HOD / PRINCIPAL — Security Audit
# ═══════════════════════════════════════════════════════════════════════

@router.get("/hod/security-audit")
def hod_security_audit(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Surface suspicious activity for HOD / Principal review.
      • recent_suspicious_events  — last 20 entries flagged as suspicious
      • students_with_high_denials — > 5 view_denied in 7 days
      • bulk_download_attempts    — > 10 downloads in 1 day
    """
    _require_role(current_user, "hod", "principal")
    requester = db.query(User).filter(User.id == current_user["id"]).first()

    # Optional dept scoping (HOD = own dept, Principal = all)
    capsule_filter = None
    if current_user["role"] == "hod" and requester and requester.department_id:
        dept_capsule_ids = [
            c.id for c in db.query(Capsule)
            .join(Subject, Subject.id == Capsule.subject_id)
            .join(Subject.course)
            .filter(Subject.course.has(department_id=requester.department_id))
            .all()
        ]
        capsule_filter = dept_capsule_ids

    base_q = db.query(CapsuleAccessLog)
    if capsule_filter is not None:
        if not capsule_filter:
            return {
                "recent_suspicious_events": [],
                "students_with_high_denials": [],
                "bulk_download_attempts": [],
            }
        base_q = base_q.filter(CapsuleAccessLog.capsule_id.in_(capsule_filter))

    # 1. Recent suspicious events
    susp_rows = (
        base_q.filter(CapsuleAccessLog.deny_reason.like(f"{SUSPICIOUS_PREFIX}%"))
        .order_by(desc(CapsuleAccessLog.created_at))
        .limit(20).all()
    )
    user_ids = {r.user_id for r in susp_rows}
    capsule_ids_set = {r.capsule_id for r in susp_rows}
    users_idx = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    caps_idx = {c.id: c for c in db.query(Capsule).filter(Capsule.id.in_(capsule_ids_set)).all()} if capsule_ids_set else {}
    subj_idx = {s.id: s for s in db.query(Subject).filter(
        Subject.id.in_([c.subject_id for c in caps_idx.values()])
    ).all()} if caps_idx else {}

    recent_suspicious_events = []
    for r in susp_rows:
        u = users_idx.get(r.user_id)
        c = caps_idx.get(r.capsule_id)
        s = subj_idx.get(c.subject_id) if c else None
        recent_suspicious_events.append({
            "id": r.id,
            "student_name": u.name if u else None,
            "student_roll": u.roll_number if u else None,
            "capsule_id": r.capsule_id,
            "capsule_title": c.title if c else None,
            "subject_name": s.name if s else None,
            "action": r.action.value if r.action else None,
            "deny_reason": r.deny_reason,
            "ip_address": r.ip_address,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    # 2. Students with > 5 view_denied in last 7 days
    seven_days_ago = datetime.now(tz=timezone.utc) - timedelta(days=7)
    high_denial_q = (
        base_q
        .filter(
            CapsuleAccessLog.action == CapsuleAccessAction.view_denied,
            CapsuleAccessLog.created_at >= seven_days_ago,
        )
        .with_entities(
            CapsuleAccessLog.user_id,
            sqlfunc.count(CapsuleAccessLog.id).label("n"),
        )
        .group_by(CapsuleAccessLog.user_id)
        .having(sqlfunc.count(CapsuleAccessLog.id) > 5)
        .order_by(desc("n"))
        .all()
    )
    hd_user_ids = [uid for uid, _ in high_denial_q]
    hd_users = {u.id: u for u in db.query(User).filter(User.id.in_(hd_user_ids)).all()} if hd_user_ids else {}
    students_with_high_denials = [{
        "student_id": uid,
        "name": hd_users[uid].name if uid in hd_users else None,
        "roll_number": hd_users[uid].roll_number if uid in hd_users else None,
        "denial_count": int(n),
    } for uid, n in high_denial_q]

    # 3. Bulk download attempts (> 10 downloads in 1 day per student)
    one_day_ago = datetime.now(tz=timezone.utc) - timedelta(days=1)
    bulk_q = (
        base_q
        .filter(
            CapsuleAccessLog.action == CapsuleAccessAction.download_granted,
            CapsuleAccessLog.created_at >= one_day_ago,
        )
        .with_entities(
            CapsuleAccessLog.user_id,
            sqlfunc.count(CapsuleAccessLog.id).label("n"),
        )
        .group_by(CapsuleAccessLog.user_id)
        .having(sqlfunc.count(CapsuleAccessLog.id) > 10)
        .order_by(desc("n"))
        .all()
    )
    bd_user_ids = [uid for uid, _ in bulk_q]
    bd_users = {u.id: u for u in db.query(User).filter(User.id.in_(bd_user_ids)).all()} if bd_user_ids else {}
    bulk_download_attempts = [{
        "student_id": uid,
        "name": bd_users[uid].name if uid in bd_users else None,
        "roll_number": bd_users[uid].roll_number if uid in bd_users else None,
        "download_count_24h": int(n),
    } for uid, n in bulk_q]

    return {
        "recent_suspicious_events": recent_suspicious_events,
        "students_with_high_denials": students_with_high_denials,
        "bulk_download_attempts": bulk_download_attempts,
    }


# ═══════════════════════════════════════════════════════════════════════
# Prompt 6 — New endpoints: reprocess-ai, my-progress, retry-status, feature
# ═══════════════════════════════════════════════════════════════════════

@router.post("/teacher/capsule/{capsule_id}/reprocess-ai")
async def teacher_reprocess_capsule_ai(
    capsule_id: int,
    background: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-run AI summary + quiz generation for a capsule (teacher-only)."""
    _require_role(current_user, "teacher", "hod", "principal")
    cap = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not cap:
        raise HTTPException(404, "Capsule not found")
    if current_user["role"] == "teacher" and not _teacher_owns_subject(db, current_user["id"], cap.subject_id):
        raise HTTPException(403, "Not your subject")
    cap.ai_processed = False
    cap.ai_summary = None
    cap.ai_quiz_json = None
    db.commit()
    background.add_task(_process_capsule_ai, capsule_id)
    logger.info("♻️ AI reprocess queued for capsule %d by user %d", capsule_id, current_user["id"])
    return {"ok": True, "capsule_id": capsule_id, "message": "AI reprocessing queued"}


@router.get("/student/my-progress")
def student_my_progress(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-subject + overall progress + learning streak for the student."""
    _require_role(current_user, "student")
    student = db.query(User).filter(User.id == current_user["id"]).first()
    if not student:
        raise HTTPException(404, "User not found")

    subjects = db.query(Subject).filter(
        Subject.course_id == student.course_id,
        Subject.semester == student.semester,
    ).all()

    per_subject = []
    overall_total = overall_opened = overall_attempted = overall_passed = 0

    for subj in subjects:
        cap_ids = [
            c.id for c in db.query(Capsule).filter(
                Capsule.subject_id == subj.id, Capsule.is_active == True,  # noqa: E712
            ).all()
        ]
        total = len(cap_ids)
        if not total:
            continue
        inters = db.query(CapsuleInteraction).filter(
            CapsuleInteraction.student_id == student.id,
            CapsuleInteraction.capsule_id.in_(cap_ids),
        ).all()
        opened = sum(1 for i in inters if i.first_opened_at)
        attempted = sum(1 for i in inters if i.quiz_attempted)
        passed = sum(1 for i in inters if i.quiz_passed)
        per_subject.append({
            "subject_id": subj.id,
            "subject_name": subj.name,
            "subject_code": subj.code,
            "capsules_total": total,
            "capsules_opened": opened,
            "quizzes_attempted": attempted,
            "quizzes_passed": passed,
            "completion_pct": round((opened / total) * 100, 1) if total else 0.0,
            "comprehension_pct": round((passed / attempted) * 100, 1) if attempted else 0.0,
        })
        overall_total += total
        overall_opened += opened
        overall_attempted += attempted
        overall_passed += passed

    # Learning streak: consecutive days (ending today) with at least one CapsuleAccessLog
    streak_days = 0
    try:
        today = date.today()
        for d_offset in range(0, 60):  # cap streak at 60d
            day = today - timedelta(days=d_offset)
            day_start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
            day_end = day_start + timedelta(days=1)
            has_act = db.query(CapsuleAccessLog.id).filter(
                CapsuleAccessLog.user_id == student.id,
                CapsuleAccessLog.created_at >= day_start,
                CapsuleAccessLog.created_at < day_end,
            ).first()
            if has_act:
                streak_days += 1
            else:
                if d_offset == 0:
                    # no activity today — streak still counted from yesterday onward
                    continue
                break
    except Exception as e:
        logger.warning("streak calc failed: %s", e)
        streak_days = 0

    return {
        "per_subject": per_subject,
        "overall": {
            "capsules_total": overall_total,
            "capsules_opened": overall_opened,
            "quizzes_attempted": overall_attempted,
            "quizzes_passed": overall_passed,
            "completion_pct": round((overall_opened / overall_total) * 100, 1) if overall_total else 0.0,
            "comprehension_pct": round((overall_passed / overall_attempted) * 100, 1) if overall_attempted else 0.0,
        },
        "learning_streak_days": streak_days,
    }


@router.get("/student/capsule/{capsule_id}/quiz-retry-status")
def student_quiz_retry_status(
    capsule_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Check if student can retry the quiz, attempts left, and cooldown remaining."""
    _require_role(current_user, "student")
    student_id = current_user["id"]
    inter = db.query(CapsuleInteraction).filter(
        CapsuleInteraction.capsule_id == capsule_id,
        CapsuleInteraction.student_id == student_id,
    ).first()
    attempts_used = (inter.quiz_attempts_count or 0) if inter else 0
    attempts_remaining = max(0, QUIZ_MAX_ATTEMPTS - attempts_used)
    passed = bool(inter and inter.quiz_passed)
    cooldown_remaining_sec = 0
    next_retry_at = None
    if inter and inter.last_quiz_at and not passed and attempts_used > 0:
        last = inter.last_quiz_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        cooldown = timedelta(hours=QUIZ_RETRY_COOLDOWN_HOURS)
        elapsed = datetime.now(tz=timezone.utc) - last
        if elapsed < cooldown:
            cooldown_remaining_sec = int((cooldown - elapsed).total_seconds())
            next_retry_at = (last + cooldown).isoformat()
    can_retry = (
        not passed
        and attempts_remaining > 0
        and cooldown_remaining_sec == 0
    )
    return {
        "capsule_id": capsule_id,
        "passed": passed,
        "attempts_used": attempts_used,
        "attempts_remaining": attempts_remaining,
        "max_attempts": QUIZ_MAX_ATTEMPTS,
        "cooldown_remaining_sec": cooldown_remaining_sec,
        "next_retry_at": next_retry_at,
        "can_retry": can_retry,
    }


class FeatureToggleRequest(BaseModel):
    featured: bool


@router.post("/hod/capsule/{capsule_id}/feature")
def hod_feature_capsule(
    capsule_id: int,
    body: FeatureToggleRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """HOD toggles 'featured' status of a capsule within their department."""
    _require_role(current_user, "hod", "principal")
    requester = db.query(User).filter(User.id == current_user["id"]).first()
    cap = db.query(Capsule).filter(Capsule.id == capsule_id).first()
    if not cap:
        raise HTTPException(404, "Capsule not found")

    # Verify capsule belongs to HOD's department (Principal: any)
    if current_user["role"] == "hod":
        if not requester or not requester.department_id:
            raise HTTPException(403, "HOD has no department assigned")
        subj = db.query(Subject).filter(Subject.id == cap.subject_id).first()
        if not subj:
            raise HTTPException(404, "Subject not found")
        from database import Course
        course = db.query(Course).filter(Course.id == subj.course_id).first()
        if not course or course.department_id != requester.department_id:
            raise HTTPException(403, "Capsule not in your department")

    cap.featured = bool(body.featured)
    cap.featured_by = current_user["id"] if body.featured else None
    cap.featured_at = datetime.now(tz=timezone.utc) if body.featured else None
    db.commit()
    logger.info(
        "⭐ Capsule %d featured=%s by user %d",
        capsule_id, cap.featured, current_user["id"],
    )
    return {
        "ok": True,
        "capsule_id": capsule_id,
        "featured": cap.featured,
        "featured_at": cap.featured_at.isoformat() if cap.featured_at else None,
    }
