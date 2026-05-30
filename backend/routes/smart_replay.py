"""
Smart Replay — text-based replay of completed live sessions (issue #118).

A completed session already stores every event (joins, doubts, pulse
checks, AI observations, …) in ``LiveSessionEvent``. Smart Replay turns
that into:

  • GET  /api/smart-replay/{session_id}                 — full timeline
  • POST /api/smart-replay/{session_id}/clip-request    — student doubt → AI clip
  • GET  /api/smart-replay/{session_id}/my-clips        — student's own clips
  • GET  /api/smart-replay/{session_id}/all-clips       — staff: all clips

Optional video (S3) — the recording itself is stored in S3 and served via
short-lived pre-signed URLs:

  • POST /api/smart-replay/{session_id}/recording/upload-url — owner: presigned PUT
  • POST /api/smart-replay/{session_id}/recording            — owner: persist key
  • GET  /api/smart-replay/{session_id}/recording            — viewer: presigned GET

Rules:
  • Replay endpoints require the session to be COMPLETED (status=ended).
  • Replay data is retained 30 days after session end → 404 afterwards.
  • AI degrades gracefully: no Gemini/Groq key → timeline still works,
    clip-request returns a "not configured" stub.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import settings
from database import (
    LiveSession,
    LiveSessionEvent,
    LiveSessionParticipant,
    LiveSessionStatus,
    SmartReplayClip,
    Subject,
    User,
    get_db,
)
from utils.auth_utils import get_current_user
from utils.live_session_ai import _ai_json
from utils import s3_utils

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/smart-replay", tags=["smart-replay"])

REPLAY_RETENTION_DAYS = 30
_STAFF_ROLES = ("teacher", "hod", "principal")
_RECORDING_KEY_PREFIX = "session-recordings/"


# ═══════════════════════════════════════════════════════════════════════
# Pydantic schemas
# ═══════════════════════════════════════════════════════════════════════

class ClipRequestBody(BaseModel):
    topic: str = Field(..., min_length=2, max_length=300)
    doubt_text: str = Field("", max_length=2000)


class PersistRecordingBody(BaseModel):
    s3_key: str = Field(..., min_length=1, max_length=500)


class RecordingUploadUrlBody(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _get_session_or_404(session_id: int, db: Session) -> LiveSession:
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Live session not found.")
    return sess


def _require_completed_replay(sess: LiveSession) -> None:
    """Replay endpoints: session must be ended and within retention window."""
    if sess.status != LiveSessionStatus.ended:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Session must be completed to view replay",
        )
    ended = sess.ended_at
    if ended is not None:
        if ended.tzinfo is None:
            ended = ended.replace(tzinfo=timezone.utc)
        cutoff = datetime.now(timezone.utc) - timedelta(days=REPLAY_RETENTION_DAYS)
        if ended < cutoff:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "Replay data is no longer available (30-day retention).",
            )


def _student_attended(db: Session, session_id: int, student_id: int) -> bool:
    return (
        db.query(LiveSessionParticipant.id)
        .filter(
            LiveSessionParticipant.live_session_id == session_id,
            LiveSessionParticipant.user_id == student_id,
        )
        .first()
        is not None
    )


def _ensure_can_view_timeline(sess: LiveSession, current_user: dict, db: Session) -> None:
    role = current_user["role"]
    if role in _STAFF_ROLES:
        return
    if role == "student":
        if not _student_attended(db, sess.id, current_user["id"]):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "You can only replay sessions you attended.",
            )
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed.")


def _session_start(sess: LiveSession) -> Optional[datetime]:
    start = sess.started_at or sess.created_at
    if start is not None and start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    return start


def _offset_seconds(start: Optional[datetime], ts: Optional[datetime]) -> Optional[int]:
    if start is None or ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return max(0, int((ts - start).total_seconds()))


def _build_timeline(db: Session, sess: LiveSession) -> list[dict]:
    events = (
        db.query(LiveSessionEvent)
        .filter(LiveSessionEvent.live_session_id == sess.id)
        .order_by(LiveSessionEvent.event_timestamp.asc())
        .all()
    )

    teacher = db.query(User).filter(User.id == sess.teacher_id).first()
    teacher_name = teacher.name if teacher else "Teacher"

    # Resolve affected-student names in a single batch.
    student_ids: set[int] = set()
    for ev in events:
        for sid in (ev.affected_student_ids or []):
            if isinstance(sid, int):
                student_ids.add(sid)
    name_map: dict[int, str] = {}
    if student_ids:
        rows = db.query(User.id, User.name).filter(User.id.in_(student_ids)).all()
        name_map = {r[0]: r[1] for r in rows}

    start = _session_start(sess)
    timeline: list[dict] = []
    for ev in events:
        trigger = ev.triggered_by.value if ev.triggered_by else "system"
        if trigger == "teacher":
            actor_name = teacher_name
        elif trigger == "ai":
            actor_name = "AI Assistant"
        elif trigger == "student":
            ids = [s for s in (ev.affected_student_ids or []) if isinstance(s, int)]
            actor_name = name_map.get(ids[0], "Student") if ids else "Student"
        else:
            actor_name = "System"

        data = {
            "ai_observation": ev.ai_observation_text,
            "teacher_action": ev.teacher_action_taken,
            "metadata": ev.metadata_json,
            "triggered_by": trigger,
        }
        timeline.append(
            {
                "id": ev.id,
                "event_type": ev.event_type.value if ev.event_type else "unknown",
                "timestamp": ev.event_timestamp.isoformat() if ev.event_timestamp else None,
                "offset_seconds": _offset_seconds(start, ev.event_timestamp),
                "actor_name": actor_name,
                "data": data,
            }
        )
    return timeline


def _session_meta(db: Session, sess: LiveSession) -> dict:
    teacher = db.query(User).filter(User.id == sess.teacher_id).first()
    subject = (
        db.query(Subject).filter(Subject.id == sess.subject_id).first()
        if sess.subject_id
        else None
    )
    participant_count = (
        db.query(LiveSessionParticipant.id)
        .filter(LiveSessionParticipant.live_session_id == sess.id)
        .count()
    )
    return {
        "session_id": sess.id,
        "title": sess.title,
        "subject": subject.name if subject else None,
        "teacher": teacher.name if teacher else None,
        "duration_minutes": sess.duration_minutes,
        "start_time": sess.started_at.isoformat() if sess.started_at else None,
        "end_time": sess.ended_at.isoformat() if sess.ended_at else None,
        "participant_count": participant_count,
        "has_recording": bool(sess.recording_url),
    }


def _ai_configured() -> bool:
    return bool(settings.GEMINI_API_KEY or settings.GROQ_API_KEY)


async def _analyze_clip(topic: str, doubt_text: str, timeline: list[dict]) -> Optional[dict]:
    """Ask the AI to find the offset range where ``topic`` was taught.

    Returns a dict with start/end offsets, confidence and explanation,
    or ``None`` when the AI is unavailable / could not parse.
    """
    if not _ai_configured():
        return None

    # Trim each event to the fields useful for localisation.
    compact = [
        {
            "offset_seconds": e["offset_seconds"],
            "event_type": e["event_type"],
            "observation": (e["data"].get("ai_observation") or "")[:300],
            "metadata": e["data"].get("metadata"),
        }
        for e in timeline
    ][:120]

    max_offset = max((e["offset_seconds"] or 0 for e in timeline), default=0)
    prompt = (
        "You are analysing the event timeline of a recorded class session. "
        "Each event has an offset_seconds (seconds from session start).\n\n"
        f"Session timeline (JSON): {json.dumps(compact)}\n\n"
        f"The session is {max_offset} seconds long.\n"
        f"A student asks about the topic: '{topic}'.\n"
        f"Their doubt: '{doubt_text or '(no extra detail)'}'.\n\n"
        "Find the time range where this topic was most likely taught. "
        "Respond with STRICT JSON only, no prose:\n"
        '{"start_offset_seconds": <int>, "end_offset_seconds": <int>, '
        '"confidence": <float 0..1>, "explanation": "<one sentence>"}'
    )
    system = "You are a precise teaching assistant. Return only valid JSON."

    try:
        parsed = await _ai_json(prompt, system)
    except Exception as exc:  # pragma: no cover - provider/network errors
        logger.warning("smart-replay AI analysis failed: %s", exc)
        return None
    if not isinstance(parsed, dict):
        return None

    def _as_int(v, default=0):
        try:
            return max(0, int(float(v)))
        except (TypeError, ValueError):
            return default

    def _as_conf(v):
        try:
            return max(0.0, min(1.0, float(v)))
        except (TypeError, ValueError):
            return None

    start = _as_int(parsed.get("start_offset_seconds"))
    end = _as_int(parsed.get("end_offset_seconds"))
    if max_offset and end > max_offset:
        end = max_offset
    if end < start:
        start, end = end, start
    return {
        "start_offset_seconds": start,
        "end_offset_seconds": end,
        "confidence": _as_conf(parsed.get("confidence")),
        "explanation": str(parsed.get("explanation") or "")[:1000],
    }


def _serialize_clip(clip: SmartReplayClip) -> dict:
    return {
        "id": clip.id,
        "topic": clip.topic,
        "doubt_text": clip.doubt_text,
        "start_offset_seconds": clip.start_offset_seconds,
        "end_offset_seconds": clip.end_offset_seconds,
        "ai_confidence": clip.ai_confidence,
        "ai_explanation": clip.ai_explanation,
        "created_at": clip.created_at.isoformat() if clip.created_at else None,
    }


# ═══════════════════════════════════════════════════════════════════════
# 1. Full timeline
# ═══════════════════════════════════════════════════════════════════════

@router.get("/{session_id}")
def get_replay_timeline(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sess = _get_session_or_404(session_id, db)
    _require_completed_replay(sess)
    _ensure_can_view_timeline(sess, current_user, db)

    return {
        "session": _session_meta(db, sess),
        "timeline": _build_timeline(db, sess),
        "ai_enabled": _ai_configured(),
        "viewer_role": current_user["role"],
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. Clip request (student doubt → AI clip)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/{session_id}/clip-request")
async def request_clip(
    session_id: int,
    body: ClipRequestBody,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] != "student":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Students only.")

    sess = _get_session_or_404(session_id, db)
    _require_completed_replay(sess)
    if not _student_attended(db, session_id, current_user["id"]):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You can only replay sessions you attended.",
        )

    timeline = _build_timeline(db, sess)
    ai_result = await _analyze_clip(body.topic, body.doubt_text, timeline)

    if ai_result is None and not _ai_configured():
        return {"clip": None, "message": "AI analysis not configured"}

    clip = SmartReplayClip(
        session_id=session_id,
        student_id=current_user["id"],
        college_id=current_user.get("college_id"),
        topic=body.topic.strip(),
        doubt_text=(body.doubt_text or "").strip() or None,
        start_offset_seconds=ai_result.get("start_offset_seconds") if ai_result else None,
        end_offset_seconds=ai_result.get("end_offset_seconds") if ai_result else None,
        ai_confidence=ai_result.get("confidence") if ai_result else None,
        ai_explanation=ai_result.get("explanation") if ai_result else None,
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)

    if ai_result is None:
        return {
            "clip": _serialize_clip(clip),
            "message": "Could not pinpoint this topic — try rephrasing.",
        }
    return {"clip": _serialize_clip(clip), "message": "ok"}


# ═══════════════════════════════════════════════════════════════════════
# 3. Student's own clips
# ═══════════════════════════════════════════════════════════════════════

@router.get("/{session_id}/my-clips")
def my_clips(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] != "student":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Students only.")
    _get_session_or_404(session_id, db)

    clips = (
        db.query(SmartReplayClip)
        .filter(
            SmartReplayClip.session_id == session_id,
            SmartReplayClip.student_id == current_user["id"],
        )
        .order_by(SmartReplayClip.created_at.desc())
        .all()
    )
    return {"clips": [_serialize_clip(c) for c in clips]}


# ═══════════════════════════════════════════════════════════════════════
# 4. All clips (staff)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/{session_id}/all-clips")
def all_clips(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] not in _STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Teacher access required.")
    _get_session_or_404(session_id, db)

    clips = (
        db.query(SmartReplayClip)
        .filter(SmartReplayClip.session_id == session_id)
        .order_by(SmartReplayClip.created_at.desc())
        .all()
    )
    # Resolve student names in one batch.
    sids = {c.student_id for c in clips}
    names: dict[int, str] = {}
    if sids:
        rows = db.query(User.id, User.name).filter(User.id.in_(sids)).all()
        names = {r[0]: r[1] for r in rows}

    out = []
    for c in clips:
        item = _serialize_clip(c)
        item["student_id"] = c.student_id
        item["student_name"] = names.get(c.student_id, "Student")
        out.append(item)
    return {"clips": out}


# ═══════════════════════════════════════════════════════════════════════
# 5-7. Recording (video) storage on S3
# ═══════════════════════════════════════════════════════════════════════

def _require_owner(sess: LiveSession, current_user: dict) -> None:
    role = current_user["role"]
    if role not in _STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Teacher access required.")
    if role == "teacher" and sess.teacher_id != current_user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not the owner of this session.")


@router.post("/{session_id}/recording/upload-url")
def recording_upload_url(
    session_id: int,
    body: RecordingUploadUrlBody,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Owner-only: return a pre-signed S3 PUT URL to upload the recording."""
    sess = _get_session_or_404(session_id, db)
    _require_owner(sess, current_user)
    if not s3_utils.is_s3_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Video storage not configured",
        )
    return s3_utils.generate_recording_upload_url(session_id, body.filename)


@router.post("/{session_id}/recording")
def persist_recording(
    session_id: int,
    body: PersistRecordingBody,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Owner-only: persist the uploaded recording's S3 key on the session."""
    sess = _get_session_or_404(session_id, db)
    _require_owner(sess, current_user)
    if not body.s3_key.startswith(_RECORDING_KEY_PREFIX):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid recording key")
    sess.recording_url = body.s3_key
    db.commit()
    return {"ok": True, "s3_key": body.s3_key}


@router.get("/{session_id}/recording")
def get_recording(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a short-lived pre-signed GET URL for the session recording.

    Staff always allowed; students must have attended. Falls back to the
    raw stored value when it is already a plain URL (legacy).
    """
    sess = _get_session_or_404(session_id, db)
    _ensure_can_view_timeline(sess, current_user, db)

    stored = sess.recording_url
    if not stored:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No recording available.")

    if stored.startswith(_RECORDING_KEY_PREFIX):
        url = s3_utils.generate_signed_url(stored, expiry_seconds=3600)
        return {"url": url, "source": "s3"}
    # Legacy: a full external URL was stored verbatim.
    return {"url": stored, "source": "external"}


# ═══════════════════════════════════════════════════════════════════════
# Retention cleanup — invoked by the weekly APScheduler job in main.py
# ═══════════════════════════════════════════════════════════════════════

def purge_old_clips(db: Session, retention_days: int = REPLAY_RETENTION_DAYS) -> int:
    """Hard-delete SmartReplayClip rows older than ``retention_days``.

    Returns the number of rows removed. Uses ``include_deleted`` so the
    soft-delete listener does not hide rows from the purge.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    rows = (
        db.query(SmartReplayClip)
        .filter(SmartReplayClip.created_at < cutoff)
        .execution_options(include_deleted=True)
        .all()
    )
    n = len(rows)
    for r in rows:
        db.delete(r)
    db.commit()
    return n
