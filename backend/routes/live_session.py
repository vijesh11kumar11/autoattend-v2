"""
ClassPulse Live — REST API routes (Prompt 2).

Sections:
  A. Session creation & lifecycle
  B. Join + heartbeat + liveness + leave
  C. AI brain (observation / intervention / whiteboard)
  D. Pulse checks
  E. Live doubt wall
  F. Pre-class brief + post-session reports
  G. Breakout rooms
  H. Student knowledge graph
  I. Analytics summaries

NOTE: WebRTC signalling is handled in Prompt 3. This module returns
      placeholder webrtc_config payloads on join.
"""

from __future__ import annotations

import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from config import settings
from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    Capsule,
    ClassWallPost,
    KnowledgeLevel,
    LiveConnectionQuality,
    LiveEventTrigger,
    LiveEventType,
    LiveParticipantType,
    LiveSession,
    LiveSessionBreakoutRoom,
    LiveSessionEvent,
    LiveSessionParticipant,
    LiveSessionStatus,
    LiveSessionType,
    MarkedBy,
    PulseCheck,
    PulseCheckAnswer,
    PulseCheckTrigger,
    Section,
    SessionStatus,
    StudentKnowledgeGraph,
    Subject,
    User,
    UserRole,
    WallPostStatus,
    get_db,
)
from utils.auth_utils import (
    decode_access_token,
    get_current_user,
    hod_or_above,
    teacher_or_above,
)
from utils.classpulse_ai import auto_answer_doubt
from utils.agora_token import generate_agora_token
from utils.live_session_ai import (
    generate_ai_observation,
    generate_auto_capsule_from_session,
    generate_intervention_suggestion,
    generate_pre_class_brief,
    generate_pulse_check_question,
    generate_session_health_report,
    update_student_knowledge_graph,
)
from utils.notification_utils import send_push_to_many

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/live", tags=["live-session"])

_bearer_scheme = HTTPBearer(auto_error=False)


# ═══════════════════════════════════════════════════════════════════════
# Constants & in-memory caches
# ═══════════════════════════════════════════════════════════════════════

GUEST_TOKEN_TTL_HOURS = 1
HEARTBEAT_GAIN_SECONDS = 30

# liveness challenges keyed by participant_id → (token, expires_at)
_liveness_challenges: dict[int, tuple[str, datetime]] = {}

# pulse-check responders kept in memory for prompt-2 scope
_pulse_responders: dict[int, set[int]] = {}


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _generate_join_link() -> str:
    """Return ABC-DEF-GHI style 11-char meeting code."""
    alphabet = string.ascii_uppercase + string.digits
    parts = ["".join(secrets.choice(alphabet) for _ in range(3)) for _ in range(3)]
    return "-".join(parts)


def _build_join_url(join_link: str) -> str:
    base = (getattr(settings, "FRONTEND_URL", None) or "http://localhost:5173").rstrip("/")
    return f"{base}/live/{join_link}"


def _create_guest_token(session_id: int, participant_id: int, guest_name: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=GUEST_TOKEN_TTL_HOURS)
    payload = {
        "sub": f"guest:{participant_id}",
        "role": "guest",
        "id": 0,
        "name": guest_name,
        "session_id": session_id,
        "participant_id": participant_id,
        "purpose": "live_guest",
        "iat": datetime.now(timezone.utc),
        "exp": expire,
        "jti": str(uuid4()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _build_webrtc_config(
    join_link: str,
    participant_token: str,
    *,
    uid: int = 0,
    role: str = "subscriber",
) -> dict:
    agora = generate_agora_token(
        channel_name=join_link,
        uid=uid,
        role=role,
        expiry_seconds=settings.AGORA_TOKEN_EXPIRY_SECONDS,
    )
    return {
        "room_id": join_link,
        "participant_token": participant_token,
        "agora": agora,
        "ice_servers": [
            {"urls": ["stun:stun.l.google.com:19302"]},
            {"urls": ["stun:stun1.l.google.com:19302"]},
        ],
    }


def _get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> Optional[dict]:
    """Return current user dict if a valid JWT is present; otherwise None."""
    if not credentials or not credentials.credentials:
        return None
    try:
        payload = decode_access_token(credentials.credentials)
    except HTTPException:
        return None

    user_id = payload.get("id")
    role = payload.get("role")
    if not user_id or not role:
        return None

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": role,
        "college_id": user.college_id,
        "department_id": user.department_id,
        "section_id": getattr(user, "section_id", None),
        "course_id": getattr(user, "course_id", None),
    }


def _require_session_owner(session_id: int, current_user: dict, db: Session) -> LiveSession:
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Live session not found.")
    if current_user["role"] not in ("teacher", "hod", "principal"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Teacher access required.")
    if sess.teacher_id != current_user["id"] and current_user["role"] == "teacher":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not the owner of this session.")
    return sess


def _is_student_in_section(db: Session, student_id: int, section_id: Optional[int]) -> bool:
    if section_id is None:
        return False
    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        return False
    return getattr(student, "section_id", None) == section_id


def _log_event(
    db: Session,
    session_id: int,
    event_type: LiveEventType,
    triggered_by: LiveEventTrigger,
    *,
    affected_student_ids: Optional[list[int]] = None,
    ai_observation_text: Optional[str] = None,
    teacher_action_taken: Optional[str] = None,
    metadata_json: Optional[dict] = None,
) -> LiveSessionEvent:
    ev = LiveSessionEvent(
        live_session_id=session_id,
        event_type=event_type,
        triggered_by=triggered_by,
        affected_student_ids=affected_student_ids,
        ai_observation_text=ai_observation_text,
        teacher_action_taken=teacher_action_taken,
        metadata_json=metadata_json,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


def _participant_for_session(
    db: Session, session_id: int, *, user_id: Optional[int] = None, participant_id: Optional[int] = None
) -> Optional[LiveSessionParticipant]:
    q = db.query(LiveSessionParticipant).filter(
        LiveSessionParticipant.live_session_id == session_id
    )
    if participant_id is not None:
        q = q.filter(LiveSessionParticipant.id == participant_id)
    elif user_id is not None:
        q = q.filter(LiveSessionParticipant.user_id == user_id)
    else:
        return None
    return q.first()


def _section_student_ids(db: Session, section_id: Optional[int]) -> list[int]:
    if section_id is None:
        return []
    rows = (
        db.query(User.id)
        .filter(User.role == UserRole.student, User.section_id == section_id)
        .all()
    )
    return [r[0] for r in rows]


# ═══════════════════════════════════════════════════════════════════════
# Pydantic schemas (compact, inline)
# ═══════════════════════════════════════════════════════════════════════

class CreateSessionReq(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    session_type: str
    subject_id: Optional[int] = None
    section_id: Optional[int] = None
    capsule_id: Optional[int] = None
    timetable_id: Optional[int] = None
    allow_guests: bool = False
    allow_guest_interaction: bool = False
    join_password: Optional[str] = None
    recording_enabled: bool = True


class JoinReq(BaseModel):
    password: Optional[str] = None
    guest_name: Optional[str] = None
    guest_email: Optional[str] = None


class HeartbeatReq(BaseModel):
    participant_id: int
    camera_on: bool = False
    mic_on: bool = False
    connection_quality: str = "good"


class LivenessReq(BaseModel):
    participant_id: int
    response_token: str


class AIObservationReq(BaseModel):
    transcript_chunk: str = ""
    current_topic: str = ""
    time_in_session_minutes: int = 0
    silent_students: list[int] = []


class TeacherResponseReq(BaseModel):
    event_id: int
    action: str  # approved | dismissed
    action_type: Optional[str] = None


class WhiteboardReq(BaseModel):
    prompt: str
    context: Optional[str] = ""


class PulseCreateReq(BaseModel):
    trigger_type: str = "manual"  # manual | ai
    question_text: Optional[str] = None
    option_a: Optional[str] = None
    option_b: Optional[str] = None
    option_c: Optional[str] = None
    option_d: Optional[str] = None
    correct_answer: Optional[str] = None
    duration_seconds: int = 30
    auto_generate: bool = False


class PulseRespondReq(BaseModel):
    answer: str  # A|B|C|D


class DoubtPostReq(BaseModel):
    question_text: str = Field(..., min_length=3, max_length=1000)


class BreakoutCreateReq(BaseModel):
    rooms: list[dict]  # [{name, participant_ids: [int]}]


# ═══════════════════════════════════════════════════════════════════════
# Background async tasks (post-session)
# ═══════════════════════════════════════════════════════════════════════

async def _generate_session_capsule_async(session_id: int) -> None:
    from database import SessionLocal
    db = SessionLocal()
    try:
        sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
        if not sess or not sess.subject_id:
            return
        events_rows = (
            db.query(LiveSessionEvent)
            .filter(LiveSessionEvent.live_session_id == session_id)
            .order_by(LiveSessionEvent.event_timestamp.asc())
            .all()
        )
        events_payload = [
            {
                "event_type": e.event_type.value if hasattr(e.event_type, "value") else str(e.event_type),
                "timestamp": str(e.event_timestamp),
                "ai_observation_text": e.ai_observation_text,
                "metadata_json": e.metadata_json,
                "triggered_by": e.triggered_by.value if hasattr(e.triggered_by, "value") else str(e.triggered_by),
            }
            for e in events_rows
        ]
        session_data = {
            "title": sess.title,
            "subject_id": sess.subject_id,
            "duration_minutes": sess.duration_minutes,
            "session_type": sess.session_type.value if hasattr(sess.session_type, "value") else str(sess.session_type),
        }
        result = await generate_auto_capsule_from_session(
            session_data=session_data,
            transcript=sess.transcript_text or "",
            ai_events=events_payload,
        )
        if not result or not result.get("title"):
            return

        cap = Capsule(
            subject_id=sess.subject_id,
            teacher_id=sess.teacher_id,
            section_id=sess.section_id,
            title=f"[Live] {result['title'][:170]}",
            description=result.get("homework_suggestion") or None,
            ai_summary=result.get("summary") or None,
            ai_quiz_json=result.get("quiz_questions") or None,
            ai_processed=True,
        )
        db.add(cap)
        db.commit()
        db.refresh(cap)
        sess.auto_capsule_id = cap.id
        db.commit()
        logger.info("Auto-capsule %s generated for live session %s", cap.id, session_id)
    except Exception as exc:
        logger.error("auto-capsule generation failed for session %s: %s", session_id, exc)
    finally:
        db.close()


async def _generate_health_report_async(session_id: int) -> None:
    from database import SessionLocal
    db = SessionLocal()
    try:
        sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
        if not sess:
            return
        participants = (
            db.query(LiveSessionParticipant)
            .filter(LiveSessionParticipant.live_session_id == session_id)
            .all()
        )
        pulses = (
            db.query(PulseCheck)
            .filter(PulseCheck.live_session_id == session_id)
            .all()
        )
        events = (
            db.query(LiveSessionEvent)
            .filter(LiveSessionEvent.live_session_id == session_id)
            .all()
        )
        doubts = (
            db.query(ClassWallPost)
            .filter(ClassWallPost.live_session_id == session_id)
            .count()
        )
        session_data = {
            "title": sess.title,
            "duration_minutes": sess.duration_minutes,
            "participants": [
                {
                    "user_id": p.user_id,
                    "type": p.participant_type.value if hasattr(p.participant_type, "value") else str(p.participant_type),
                    "duration_seconds": p.total_duration_seconds,
                    "attendance_counted": p.is_attendance_counted,
                }
                for p in participants
            ],
            "pulse_checks": [
                {
                    "question": p.question_text,
                    "total_responses": p.total_responses,
                    "correct_responses": p.correct_responses,
                    "distribution": p.response_distribution,
                }
                for p in pulses
            ],
            "ai_events_count": len(events),
            "doubts_count": doubts,
        }
        report = await generate_session_health_report(session_data)
        sess.health_report_json = report
        sess.session_health_score = int(report.get("health_score", 0))
        db.commit()
        logger.info("Health report saved for live session %s", session_id)
    except Exception as exc:
        logger.error("health-report generation failed for session %s: %s", session_id, exc)
    finally:
        db.close()


def _update_all_knowledge_graphs_sync(session_id: int) -> None:
    from database import SessionLocal
    db = SessionLocal()
    try:
        sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
        if not sess or not sess.subject_id:
            return

        events = (
            db.query(LiveSessionEvent)
            .filter(LiveSessionEvent.live_session_id == session_id)
            .all()
        )
        events_payload = [
            {
                "event_type": e.event_type.value if hasattr(e.event_type, "value") else str(e.event_type),
                "topic": (e.metadata_json or {}).get("topic", ""),
                "type": (e.metadata_json or {}).get("type", ""),
                "affected_student_ids": e.affected_student_ids or [],
                "metadata_json": e.metadata_json,
            }
            for e in events
        ]

        pulses = (
            db.query(PulseCheck)
            .filter(PulseCheck.live_session_id == session_id)
            .all()
        )

        students = (
            db.query(LiveSessionParticipant.user_id)
            .filter(
                LiveSessionParticipant.live_session_id == session_id,
                LiveSessionParticipant.participant_type == LiveParticipantType.student,
                LiveSessionParticipant.user_id.isnot(None),
            )
            .all()
        )
        student_ids = [s[0] for s in students]

        for sid in student_ids:
            pulse_results = []
            for p in pulses:
                pulse_results.append({
                    "topic": (p.ai_analysis or "")[:200] or sess.title,
                    "is_correct": (p.correct_responses or 0) >= max(1, (p.total_responses or 0) // 2),
                })
            try:
                update_student_knowledge_graph(
                    student_id=sid,
                    subject_id=sess.subject_id,
                    session_events=events_payload,
                    pulse_results=pulse_results,
                    db=db,
                    live_session_id=session_id,
                )
            except Exception as exc:
                logger.warning("KG update failed for student %s: %s", sid, exc)

        logger.info("Knowledge graphs updated for session %s (%d students)", session_id, len(student_ids))
    except Exception as exc:
        logger.error("knowledge-graph update failed for session %s: %s", session_id, exc)
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════
# Health probe
# ═══════════════════════════════════════════════════════════════════════

@router.get("/health")
def live_session_health():
    return {"status": "ok", "module": "live-session", "stage": "routes"}


# ═══════════════════════════════════════════════════════════════════════
# SECTION A — Session creation & lifecycle
# ═══════════════════════════════════════════════════════════════════════

@router.post("/sessions/create")
def create_session(
    body: CreateSessionReq,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    if body.session_type not in ("standalone", "capsule_locked", "public"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid session_type.")

    teacher_id = current_user["id"]
    subject_id = body.subject_id
    section_id = body.section_id
    capsule = None

    if body.session_type == "capsule_locked":
        if not body.capsule_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "capsule_id required for capsule_locked sessions.")
        capsule = db.query(Capsule).filter(Capsule.id == body.capsule_id).first()
        if not capsule:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Capsule not found.")
        if capsule.teacher_id != teacher_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Capsule does not belong to you.")
        subject_id = capsule.subject_id
        section_id = capsule.section_id

    if body.session_type == "standalone":
        if not subject_id or not section_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "subject_id and section_id required for standalone sessions.")

    # Generate unique join link
    link = ""
    for _ in range(5):
        candidate = _generate_join_link()
        if not db.query(LiveSession).filter(LiveSession.join_link == candidate).first():
            link = candidate
            break
    if not link:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not allocate join link.")

    sess = LiveSession(
        session_type=LiveSessionType(body.session_type),
        title=body.title.strip(),
        teacher_id=teacher_id,
        subject_id=subject_id,
        section_id=section_id,
        capsule_id=body.capsule_id if body.session_type == "capsule_locked" else None,
        timetable_id=body.timetable_id,
        status=LiveSessionStatus.waiting,
        join_link=link,
        join_password=body.join_password,
        allow_guests=body.allow_guests,
        allow_guest_interaction=body.allow_guest_interaction,
        recording_enabled=body.recording_enabled,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)

    # Auto-create teacher participant row
    teacher_part = LiveSessionParticipant(
        live_session_id=sess.id,
        user_id=teacher_id,
        participant_type=LiveParticipantType.teacher,
        is_active=False,
    )
    db.add(teacher_part)
    db.commit()

    return {
        "session_id": sess.id,
        "join_link": sess.join_link,
        "join_url": _build_join_url(sess.join_link),
        "title": sess.title,
        "session_type": sess.session_type.value,
        "capsule_locked": sess.session_type == LiveSessionType.capsule_locked,
        "capsule_title": capsule.title if capsule else None,
    }


@router.post("/sessions/{session_id}/start")
def start_live_session(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    if sess.status == LiveSessionStatus.live:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is already live.")
    if sess.status in (LiveSessionStatus.ended, LiveSessionStatus.cancelled):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Session is {sess.status.value}.")

    now = datetime.now(timezone.utc)

    # Create linked AttendanceSession (only if subject + section present)
    att_id: Optional[int] = None
    if sess.subject_id is not None:
        att = AttendanceSession(
            subject_id=sess.subject_id,
            teacher_id=sess.teacher_id,
            section_id=sess.section_id,
            date=now.date(),
            start_time=now.time().replace(microsecond=0),
            end_time=None,
            status=SessionStatus.active,
            qr_secret=secrets.token_hex(16),
            session_type="live_online",
            linked_live_session_id=sess.id,
        )
        db.add(att)
        db.commit()
        db.refresh(att)
        att_id = att.id

    sess.status = LiveSessionStatus.live
    sess.started_at = now
    db.commit()

    _log_event(
        db, sess.id, LiveEventType.session_start, LiveEventTrigger.teacher,
        teacher_action_taken="Session started",
        metadata_json={"attendance_session_id": att_id},
    )

    # Notify enrolled students
    student_ids = _section_student_ids(db, sess.section_id)
    if student_ids:
        subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None
        subj_name = subj.name if subj else "your class"
        try:
            send_push_to_many(
                user_ids=student_ids,
                title=f"{subj_name} class is live now",
                body=f"Tap to join: {_build_join_url(sess.join_link)}",
                db=db,
                data={"type": "live_session_started", "session_id": sess.id, "join_link": sess.join_link},
            )
        except Exception as exc:
            logger.warning("Failed to push live-session start: %s", exc)

    return {
        "status": "live",
        "attendance_session_id": att_id,
        "started_at": sess.started_at.isoformat() if sess.started_at else None,
    }


@router.post("/sessions/{session_id}/end")
def end_live_session(
    session_id: int,
    background: BackgroundTasks,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    if sess.status != LiveSessionStatus.live:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is not live.")

    now = datetime.now(timezone.utc)
    sess.status = LiveSessionStatus.ended
    sess.ended_at = now
    if sess.started_at:
        sess.duration_minutes = max(1, int((now - sess.started_at).total_seconds() // 60))

    # Mark all active participants as left
    active = (
        db.query(LiveSessionParticipant)
        .filter(
            LiveSessionParticipant.live_session_id == session_id,
            LiveSessionParticipant.is_active == True,  # noqa: E712
        )
        .all()
    )
    for p in active:
        p.left_at = now
        p.is_active = False

    # Close linked AttendanceSession + finalise attendance
    attendance_marked = 0
    att = (
        db.query(AttendanceSession)
        .filter(AttendanceSession.linked_live_session_id == session_id)
        .first()
    )
    if att:
        att.status = SessionStatus.ended
        att.end_time = now.time().replace(microsecond=0)
        min_seconds = settings.LIVE_SESSION_MIN_ATTENDANCE_MINUTES * 60

        student_parts = (
            db.query(LiveSessionParticipant)
            .filter(
                LiveSessionParticipant.live_session_id == session_id,
                LiveSessionParticipant.participant_type == LiveParticipantType.student,
                LiveSessionParticipant.user_id.isnot(None),
            )
            .all()
        )
        for sp in student_parts:
            existing = (
                db.query(AttendanceRecord)
                .filter(
                    AttendanceRecord.session_id == att.id,
                    AttendanceRecord.student_id == sp.user_id,
                )
                .first()
            )
            is_present = (sp.total_duration_seconds or 0) >= min_seconds
            status_val = AttendanceStatus.present if is_present else AttendanceStatus.absent
            if existing:
                existing.status = status_val
            else:
                rec = AttendanceRecord(
                    session_id=att.id,
                    student_id=sp.user_id,
                    status=status_val,
                    marked_at=now,
                    marked_by=MarkedBy.auto_absent if not is_present else MarkedBy.manual,
                )
                db.add(rec)
                db.flush()
                sp.attendance_record_id = rec.id
            sp.is_attendance_counted = is_present
            if is_present:
                attendance_marked += 1
        att.total_students = len(student_parts)
        att.present_count = attendance_marked

    db.commit()

    _log_event(
        db, sess.id, LiveEventType.session_end, LiveEventTrigger.teacher,
        teacher_action_taken="Session ended",
        metadata_json={"duration_minutes": sess.duration_minutes, "attendance_marked": attendance_marked},
    )

    # Background async tasks
    background.add_task(_generate_session_capsule_async, sess.id)
    background.add_task(_generate_health_report_async,   sess.id)
    background.add_task(_update_all_knowledge_graphs_sync, sess.id)

    return {
        "status": "ended",
        "duration_minutes": sess.duration_minutes or 0,
        "attendance_marked": attendance_marked,
        "auto_capsule_generating": True,
    }


@router.get("/sessions/my-sessions")
def my_sessions(
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    teacher_id = current_user["id"]
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    rows = (
        db.query(LiveSession)
        .filter(
            LiveSession.teacher_id == teacher_id,
            or_(
                LiveSession.created_at >= cutoff,
                LiveSession.status.in_([LiveSessionStatus.waiting, LiveSessionStatus.live]),
            ),
        )
        .order_by(LiveSession.created_at.desc())
        .limit(200)
        .all()
    )

    out = []
    for s in rows:
        pcount = (
            db.query(func.count(LiveSessionParticipant.id))
            .filter(
                LiveSessionParticipant.live_session_id == s.id,
                LiveSessionParticipant.participant_type == LiveParticipantType.student,
            )
            .scalar() or 0
        )
        out.append({
            "id": s.id,
            "title": s.title,
            "session_type": s.session_type.value,
            "status": s.status.value,
            "join_link": s.join_link,
            "subject_id": s.subject_id,
            "section_id": s.section_id,
            "capsule_id": s.capsule_id,
            "participant_count": int(pcount),
            "health_score": s.session_health_score,
            "capsule_generated": s.auto_capsule_id is not None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
        })

    upcoming = [s for s in out if s["status"] == "waiting"]
    live = [s for s in out if s["status"] == "live"]
    past = [s for s in out if s["status"] in ("ended", "cancelled")]
    return {"upcoming": upcoming, "live": live, "past": past}


@router.get("/sessions/{session_id}/details")
def session_details(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Live session not found.")

    role = current_user["role"]
    is_owner = sess.teacher_id == current_user["id"]
    teacher = db.query(User).filter(User.id == sess.teacher_id).first()
    subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None

    base = {
        "id": sess.id,
        "title": sess.title,
        "session_type": sess.session_type.value,
        "status": sess.status.value,
        "teacher_name": teacher.name if teacher else None,
        "subject_name": subj.name if subj else None,
        "section_id": sess.section_id,
        "join_link": sess.join_link,
        "started_at": sess.started_at.isoformat() if sess.started_at else None,
        "ended_at": sess.ended_at.isoformat() if sess.ended_at else None,
        "duration_minutes": sess.duration_minutes,
        "health_score": sess.session_health_score,
        "capsule_generated": sess.auto_capsule_id is not None,
    }

    if is_owner or role in ("hod", "principal"):
        participants = (
            db.query(LiveSessionParticipant)
            .filter(LiveSessionParticipant.live_session_id == session_id)
            .all()
        )
        base["participants"] = [
            {
                "id": p.id,
                "user_id": p.user_id,
                "type": p.participant_type.value,
                "guest_name": p.guest_name,
                "is_active": p.is_active,
                "duration_seconds": p.total_duration_seconds,
                "attendance_counted": p.is_attendance_counted,
            }
            for p in participants
        ]
        base["ai_event_count"] = (
            db.query(func.count(LiveSessionEvent.id))
            .filter(LiveSessionEvent.live_session_id == session_id)
            .scalar() or 0
        )
        base["health_report"] = sess.health_report_json
        return base

    # Student view: must be a participant
    me_part = _participant_for_session(db, session_id, user_id=current_user["id"])
    if not me_part:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a participant of this session.")
    base["my_participation"] = {
        "duration_seconds": me_part.total_duration_seconds,
        "attendance_counted": me_part.is_attendance_counted,
        "joined_at": me_part.joined_at.isoformat() if me_part.joined_at else None,
        "left_at": me_part.left_at.isoformat() if me_part.left_at else None,
    }
    return base


# ═══════════════════════════════════════════════════════════════════════
# SECTION B — Join, heartbeat, liveness, leave
# ═══════════════════════════════════════════════════════════════════════

@router.post("/join/{join_link}")
def join_live_session(
    join_link: str,
    body: JoinReq,
    user: Optional[dict] = Depends(_get_optional_user),
    db: Session = Depends(get_db),
):
    sess = db.query(LiveSession).filter(LiveSession.join_link == join_link.upper()).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    # Step 1 — status
    if sess.status == LiveSessionStatus.ended:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This session has ended.")
    if sess.status == LiveSessionStatus.cancelled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session cancelled.")
    if sess.status == LiveSessionStatus.waiting:
        return {
            "status": "waiting",
            "message": "Teacher hasn't started yet. You'll be notified when the session begins.",
            "session_id": sess.id,
            "title": sess.title,
        }

    # Step 2 — password
    if sess.join_password and (body.password or "") != sess.join_password:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect meeting password.")

    # Step 3 — guest path
    if user is None:
        if not sess.allow_guests:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This is a private session. Please login.")
        if not body.guest_name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "guest_name required.")
        new_part = LiveSessionParticipant(
            live_session_id=sess.id,
            participant_type=LiveParticipantType.guest,
            guest_name=body.guest_name.strip()[:100],
            guest_email=(body.guest_email or "").strip()[:200] or None,
            joined_at=datetime.now(timezone.utc),
            is_active=True,
            last_heartbeat=datetime.now(timezone.utc),
        )
        db.add(new_part)
        db.commit()
        db.refresh(new_part)
        guest_token = _create_guest_token(sess.id, new_part.id, body.guest_name)
        teacher = db.query(User).filter(User.id == sess.teacher_id).first()
        subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None
        _log_event(db, sess.id, LiveEventType.student_joined, LiveEventTrigger.system,
                   metadata_json={"guest": True, "name": body.guest_name})
        return {
            "allowed": True,
            "participant_id": new_part.id,
            "session": {
                "id": sess.id,
                "title": sess.title,
                "teacher_name": teacher.name if teacher else None,
                "subject": subj.name if subj else None,
                "session_type": sess.session_type.value,
                "recording_enabled": sess.recording_enabled,
                "allow_guest_interaction": sess.allow_guest_interaction,
            },
            "webrtc_config": _build_webrtc_config(
                sess.join_link, guest_token,
                uid=-new_part.id,  # negative-id space for guests; agora helper masks to uint32
                role="subscriber",
            ),
            "guest_token": guest_token,
            "low_bandwidth_mode": False,
            "attendance_will_be_counted": False,
        }

    # Authenticated user
    user_id = user["id"]
    role = user["role"]

    # Step 4 — access control
    if sess.session_type == LiveSessionType.standalone:
        if role == "student" and not _is_student_in_section(db, user_id, sess.section_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not enrolled in this section.")
    elif sess.session_type == LiveSessionType.capsule_locked:
        capsule = db.query(Capsule).filter(Capsule.id == sess.capsule_id).first() if sess.capsule_id else None
        target_section = capsule.section_id if capsule else sess.section_id
        if role == "student" and not _is_student_in_section(db, user_id, target_section):
            subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None
            section = db.query(Section).filter(Section.id == target_section).first() if target_section else None
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                {
                    "error": "Access Denied",
                    "message": (
                        f"This session is for {subj.name if subj else 'this subject'} "
                        f"{section.name if section else 'the assigned section'} only. "
                        "You are not enrolled in this capsule."
                    ),
                    "capsule_title": capsule.title if capsule else None,
                    "subject": subj.name if subj else None,
                },
            )
    # public — anyone allowed

    # Step 5 — create or update participant
    p_type = LiveParticipantType.teacher if role == "teacher" and sess.teacher_id == user_id else (
        LiveParticipantType.student if role == "student" else LiveParticipantType.external
    )

    part = (
        db.query(LiveSessionParticipant)
        .filter(
            LiveSessionParticipant.live_session_id == sess.id,
            LiveSessionParticipant.user_id == user_id,
        )
        .first()
    )
    now = datetime.now(timezone.utc)
    if part:
        part.is_active = True
        part.left_at = None
        if not part.joined_at:
            part.joined_at = now
        part.last_heartbeat = now
        part.participant_type = p_type
    else:
        part = LiveSessionParticipant(
            live_session_id=sess.id,
            user_id=user_id,
            participant_type=p_type,
            joined_at=now,
            last_heartbeat=now,
            is_active=True,
        )
        db.add(part)
    db.commit()
    db.refresh(part)

    _log_event(db, sess.id, LiveEventType.student_joined, LiveEventTrigger.system,
               affected_student_ids=[user_id] if p_type == LiveParticipantType.student else None,
               metadata_json={"user_id": user_id, "role": role})

    teacher = db.query(User).filter(User.id == sess.teacher_id).first()
    subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None
    return {
        "allowed": True,
        "participant_id": part.id,
        "session": {
            "id": sess.id,
            "title": sess.title,
            "teacher_name": teacher.name if teacher else None,
            "subject": subj.name if subj else None,
            "session_type": sess.session_type.value,
            "recording_enabled": sess.recording_enabled,
            "allow_guest_interaction": sess.allow_guest_interaction,
        },
        "webrtc_config": _build_webrtc_config(
            sess.join_link, str(uuid4()),
            uid=user_id,
            role="publisher" if p_type == LiveParticipantType.teacher else "subscriber",
        ),
        "low_bandwidth_mode": part.connection_quality == LiveConnectionQuality.poor,
        "attendance_will_be_counted": p_type == LiveParticipantType.student,
    }


@router.post("/sessions/{session_id}/heartbeat")
def heartbeat(
    session_id: int,
    body: HeartbeatReq,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    part = db.query(LiveSessionParticipant).filter(
        LiveSessionParticipant.id == body.participant_id,
        LiveSessionParticipant.live_session_id == session_id,
    ).first()
    if not part:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found.")
    if part.user_id and part.user_id != current_user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your participant record.")

    now = datetime.now(timezone.utc)
    part.last_heartbeat = now
    part.is_active = True
    part.total_duration_seconds = (part.total_duration_seconds or 0) + HEARTBEAT_GAIN_SECONDS
    part.camera_on = bool(body.camera_on)
    part.mic_on = bool(body.mic_on)
    quality = (body.connection_quality or "good").lower()
    if quality not in ("excellent", "good", "poor", "offline"):
        quality = "good"
    part.connection_quality = LiveConnectionQuality(quality)
    db.commit()

    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    session_active = bool(sess and sess.status == LiveSessionStatus.live)
    low_bw = quality == "poor"

    needs_liveness = False
    if part.user_id and part.participant_type == LiveParticipantType.student and session_active:
        last_check = part.liveness_check_time
        if not last_check or (now - last_check).total_seconds() > settings.LIVE_SESSION_LIVENESS_CHECK_INTERVAL:
            needs_liveness = True

    return {
        "status": "ok",
        "session_active": session_active,
        "low_bandwidth_mode": low_bw,
        "liveness_check_required": needs_liveness,
    }


@router.get("/sessions/{session_id}/liveness-challenge/{participant_id}")
def liveness_challenge(
    session_id: int,
    participant_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    part = db.query(LiveSessionParticipant).filter(
        LiveSessionParticipant.id == participant_id,
        LiveSessionParticipant.live_session_id == session_id,
    ).first()
    if not part or part.user_id != current_user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed.")
    token = secrets.token_urlsafe(16)
    expires = datetime.now(timezone.utc) + timedelta(seconds=30)
    _liveness_challenges[participant_id] = (token, expires)
    return {
        "challenge_token": token,
        "expires_at": expires.isoformat(),
        "button_position": {"x": secrets.randbelow(80) + 10, "y": secrets.randbelow(80) + 10},
    }


@router.post("/sessions/{session_id}/liveness-check")
def liveness_check(
    session_id: int,
    body: LivenessReq,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    part = db.query(LiveSessionParticipant).filter(
        LiveSessionParticipant.id == body.participant_id,
        LiveSessionParticipant.live_session_id == session_id,
    ).first()
    if not part or part.user_id != current_user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed.")

    challenge = _liveness_challenges.pop(body.participant_id, None)
    now = datetime.now(timezone.utc)
    verified = bool(challenge and challenge[0] == body.response_token and now <= challenge[1])
    if verified:
        part.liveness_check_passed = True
        part.liveness_check_time = now
        db.commit()
        _log_event(db, session_id, LiveEventType.liveness_check, LiveEventTrigger.system,
                   affected_student_ids=[current_user["id"]],
                   metadata_json={"result": "passed"})
    else:
        _log_event(db, session_id, LiveEventType.liveness_check, LiveEventTrigger.system,
                   affected_student_ids=[current_user["id"]],
                   metadata_json={"result": "failed"})
    return {"verified": verified}


@router.post("/sessions/{session_id}/leave")
def leave_session(
    session_id: int,
    participant_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    part = db.query(LiveSessionParticipant).filter(
        LiveSessionParticipant.id == participant_id,
        LiveSessionParticipant.live_session_id == session_id,
    ).first()
    if not part:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Participant not found.")
    if part.user_id and part.user_id != current_user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your participant record.")

    now = datetime.now(timezone.utc)
    part.left_at = now
    part.is_active = False
    db.commit()

    min_seconds = settings.LIVE_SESSION_MIN_ATTENDANCE_MINUTES * 60
    counted = (part.total_duration_seconds or 0) >= min_seconds
    return {
        "total_time_minutes": round((part.total_duration_seconds or 0) / 60, 1),
        "attendance_counted": counted,
    }


# ═══════════════════════════════════════════════════════════════════════
# SECTION C — AI brain
# ═══════════════════════════════════════════════════════════════════════

@router.post("/sessions/{session_id}/ai/observation")
async def ai_observation(
    session_id: int,
    body: AIObservationReq,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)

    if body.transcript_chunk:
        existing = sess.transcript_text or ""
        sess.transcript_text = (existing + "\n" + body.transcript_chunk)[-50000:]
        db.commit()

    subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None
    prev_obs_rows = (
        db.query(LiveSessionEvent)
        .filter(
            LiveSessionEvent.live_session_id == session_id,
            LiveSessionEvent.event_type == LiveEventType.ai_observation,
        )
        .order_by(LiveSessionEvent.event_timestamp.desc())
        .limit(5)
        .all()
    )
    context = {
        "subject": subj.name if subj else "",
        "topic_being_taught": body.current_topic,
        "student_responses": [],
        "time_in_session": f"{body.time_in_session_minutes} minutes",
        "previous_observations": [r.ai_observation_text for r in prev_obs_rows if r.ai_observation_text],
    }

    obs = await generate_ai_observation(body.transcript_chunk, context)
    if not obs.get("observation"):
        return {
            "observation": None, "type": obs.get("type", "engagement"),
            "intervention": None, "affected_students": [],
        }

    affected_ids = obs.get("affected_students") or []
    if not affected_ids and body.silent_students:
        affected_ids = body.silent_students[:10]

    ev = _log_event(
        db, session_id, LiveEventType.ai_observation, LiveEventTrigger.ai,
        affected_student_ids=affected_ids,
        ai_observation_text=obs.get("observation"),
        metadata_json={"type": obs.get("type"), "topic": body.current_topic, "confidence": obs.get("confidence")},
    )

    intervention = None
    if obs.get("type") in ("confusion", "pace"):
        intervention = await generate_intervention_suggestion(
            obs["observation"],
            {"subject": subj.name if subj else "", "topic": body.current_topic},
        )

    students = []
    if affected_ids:
        rows = db.query(User.id, User.name).filter(User.id.in_(affected_ids)).all()
        students = [{"id": r.id, "name": r.name} for r in rows]

    return {
        "event_id": ev.id,
        "observation": obs.get("observation"),
        "type": obs.get("type"),
        "intervention": intervention,
        "affected_students": students,
    }


@router.post("/sessions/{session_id}/ai/teacher-response")
def ai_teacher_response(
    session_id: int,
    body: TeacherResponseReq,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    ev = db.query(LiveSessionEvent).filter(
        LiveSessionEvent.id == body.event_id,
        LiveSessionEvent.live_session_id == session_id,
    ).first()
    if not ev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found.")

    if body.action not in ("approved", "dismissed"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid action.")

    if body.action == "dismissed":
        ev.teacher_action_taken = "dismissed"
        db.commit()
        return {"executed": False, "result": "Dismissed"}

    action_type = (body.action_type or "").strip()
    affected = ev.affected_student_ids or []
    executed = False
    result_msg = ""

    if action_type == "send_recap":
        if affected:
            try:
                send_push_to_many(
                    user_ids=affected,
                    title="Quick Recap",
                    body=f"Your teacher sent a brief recap for the last topic in {sess.title}.",
                    db=db,
                    data={"type": "live_recap", "session_id": session_id},
                )
                executed = True
                result_msg = f"Recap notification sent to {len(affected)} students."
            except Exception as exc:
                result_msg = f"Failed to send recap: {exc}"
    elif action_type == "pulse_check":
        result_msg = "Pulse check should be created via /pulse/create with auto_generate=true."
        executed = True
    elif action_type == "slow_down":
        executed = True
        result_msg = "Pace alert logged."
        _log_event(db, session_id, LiveEventType.pace_alert, LiveEventTrigger.teacher,
                   teacher_action_taken="approved slow_down")
    elif action_type == "peer_help":
        executed = True
        result_msg = "Peer help suggestion noted."
    elif action_type == "break":
        executed = True
        result_msg = "Break suggestion logged."
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown action_type.")

    ev.teacher_action_taken = f"approved:{action_type}"
    db.commit()
    return {"executed": executed, "result": result_msg}


@router.post("/sessions/{session_id}/ai/generate-whiteboard")
async def ai_whiteboard(
    session_id: int,
    body: WhiteboardReq,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    from utils.live_session_ai import _ai_json  # local import to avoid circular

    schema = (
        '{"diagram_type": "mermaid|html", '
        '"diagram_code": "string", '
        '"title": "string"}'
    )
    prompt = (
        "Generate a teaching diagram for a live class.\n"
        f"Subject context: {body.context or 'general'}\n"
        f"Diagram request: {body.prompt}\n\n"
        "Prefer mermaid (graph TD) syntax when the concept is hierarchical or a flow.\n"
        "Use plain HTML (with inline CSS) only for tables / matrices.\n"
        "Return ONLY valid JSON (no markdown fences):\n"
        f"{schema}"
    )
    result = await _ai_json(prompt, system="You are an instructor designing whiteboard visuals. Return only valid JSON.")
    if not isinstance(result, dict) or not result.get("diagram_code"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI failed to produce a diagram.")

    diagram_type = str(result.get("diagram_type", "mermaid")).lower()
    if diagram_type not in ("mermaid", "html"):
        diagram_type = "mermaid"

    _log_event(db, session_id, LiveEventType.whiteboard_generated, LiveEventTrigger.teacher,
               metadata_json={"prompt": body.prompt, "diagram_type": diagram_type})

    return {
        "diagram_type": diagram_type,
        "diagram_code": str(result["diagram_code"])[:5000],
        "title": str(result.get("title", body.prompt))[:200],
    }


# ═══════════════════════════════════════════════════════════════════════
# SECTION D — Pulse checks
# ═══════════════════════════════════════════════════════════════════════

@router.post("/sessions/{session_id}/pulse/create")
async def pulse_create(
    session_id: int,
    body: PulseCreateReq,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    if sess.status != LiveSessionStatus.live:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is not live.")

    trigger_type = (body.trigger_type or "manual").lower()
    if trigger_type not in ("manual", "ai"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid trigger_type.")

    if body.auto_generate or trigger_type == "ai":
        recent_transcript = (sess.transcript_text or "")[-3000:]
        gen = await generate_pulse_check_question(
            topic=sess.title,
            difficulty="intermediate",
            recent_transcript=recent_transcript,
        )
        if not gen.get("question"):
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI failed to generate a pulse-check question.")
        qdata = gen
        triggered_by_enum = PulseCheckTrigger.ai
    else:
        if not all([body.question_text, body.option_a, body.option_b, body.option_c, body.option_d, body.correct_answer]):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "All question fields required for manual pulse check.")
        if body.correct_answer.upper() not in ("A", "B", "C", "D"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "correct_answer must be A|B|C|D.")
        qdata = {
            "question": body.question_text.strip(),
            "option_a": body.option_a.strip(),
            "option_b": body.option_b.strip(),
            "option_c": body.option_c.strip(),
            "option_d": body.option_d.strip(),
            "correct_answer": body.correct_answer.upper(),
            "explanation": "",
        }
        triggered_by_enum = PulseCheckTrigger.teacher

    pulse = PulseCheck(
        live_session_id=session_id,
        question_text=qdata["question"][:2000],
        option_a=qdata["option_a"][:300],
        option_b=qdata["option_b"][:300],
        option_c=qdata["option_c"][:300],
        option_d=qdata["option_d"][:300],
        correct_answer=PulseCheckAnswer(qdata["correct_answer"]),
        explanation=(qdata.get("explanation") or "")[:1000],
        triggered_by=triggered_by_enum,
        duration_seconds=max(10, min(180, body.duration_seconds)),
        response_distribution={"A": 0, "B": 0, "C": 0, "D": 0},
    )
    db.add(pulse)
    db.commit()
    db.refresh(pulse)

    _log_event(db, session_id, LiveEventType.pulse_check_started,
               LiveEventTrigger.teacher if triggered_by_enum == PulseCheckTrigger.teacher else LiveEventTrigger.ai,
               metadata_json={"pulse_check_id": pulse.id, "duration": pulse.duration_seconds})

    return {
        "pulse_check_id": pulse.id,
        "question": pulse.question_text,
        "options": {"A": pulse.option_a, "B": pulse.option_b, "C": pulse.option_c, "D": pulse.option_d},
        "duration_seconds": pulse.duration_seconds,
        "triggered_by": triggered_by_enum.value,
    }


@router.post("/sessions/{session_id}/pulse/{pulse_id}/respond")
def pulse_respond(
    session_id: int,
    pulse_id: int,
    body: PulseRespondReq,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pulse = db.query(PulseCheck).filter(
        PulseCheck.id == pulse_id,
        PulseCheck.live_session_id == session_id,
    ).first()
    if not pulse:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pulse check not found.")
    if pulse.closed_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pulse check has closed.")

    elapsed = (datetime.now(timezone.utc) - pulse.triggered_at).total_seconds()
    if elapsed > pulse.duration_seconds:
        pulse.closed_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pulse check window expired.")

    answer = body.answer.upper()
    if answer not in ("A", "B", "C", "D"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "answer must be A|B|C|D.")

    part = _participant_for_session(db, session_id, user_id=current_user["id"])
    if not part:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a participant.")
    if current_user.get("role") == "guest":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Guests cannot respond to pulse checks.")

    responders = _pulse_responders.setdefault(pulse_id, set())
    if current_user["id"] in responders:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You already responded.")
    responders.add(current_user["id"])

    dist = pulse.response_distribution or {"A": 0, "B": 0, "C": 0, "D": 0}
    dist[answer] = dist.get(answer, 0) + 1
    pulse.response_distribution = dist
    pulse.total_responses = (pulse.total_responses or 0) + 1
    correct = answer == pulse.correct_answer.value
    if correct:
        pulse.correct_responses = (pulse.correct_responses or 0) + 1
    db.commit()

    return {"received": True, "correct": correct}


@router.get("/sessions/{session_id}/pulse/{pulse_id}/results")
def pulse_results(
    session_id: int,
    pulse_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pulse = db.query(PulseCheck).filter(
        PulseCheck.id == pulse_id,
        PulseCheck.live_session_id == session_id,
    ).first()
    if not pulse:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pulse check not found.")

    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    is_owner = sess and sess.teacher_id == current_user["id"]
    closed = pulse.closed_at is not None or (
        (datetime.now(timezone.utc) - pulse.triggered_at).total_seconds() > pulse.duration_seconds
    )
    if not is_owner and not closed and current_user["role"] not in ("hod", "principal"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Results visible after pulse closes.")

    total_part = (
        db.query(func.count(LiveSessionParticipant.id))
        .filter(
            LiveSessionParticipant.live_session_id == session_id,
            LiveSessionParticipant.participant_type == LiveParticipantType.student,
        )
        .scalar() or 0
    )
    total_responses = pulse.total_responses or 0
    correct = pulse.correct_responses or 0
    response_pct = round(total_responses / total_part * 100, 1) if total_part else 0.0
    correct_pct = round(correct / total_responses * 100, 1) if total_responses else 0.0

    return {
        "total_participants": int(total_part),
        "total_responded": int(total_responses),
        "response_percentage": response_pct,
        "correct_percentage": correct_pct,
        "distribution": pulse.response_distribution or {"A": 0, "B": 0, "C": 0, "D": 0},
        "correct_answer": pulse.correct_answer.value if (closed or is_owner) else None,
        "ai_analysis": pulse.ai_analysis or "",
    }


# ═══════════════════════════════════════════════════════════════════════
# SECTION E — Live doubt wall
# ═══════════════════════════════════════════════════════════════════════

@router.post("/sessions/{session_id}/doubts")
async def post_doubt(
    session_id: int,
    body: DoubtPostReq,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] == "guest":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Guests cannot post doubts.")

    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    if sess.status != LiveSessionStatus.live:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is not live.")

    part = _participant_for_session(db, session_id, user_id=current_user["id"])
    if not part:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Join the session first.")

    if not sess.subject_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session has no subject; cannot post doubt.")

    post = ClassWallPost(
        subject_id=sess.subject_id,
        section_id=sess.section_id,
        student_id=current_user["id"],
        capsule_id=sess.capsule_id,
        live_session_id=sess.id,
        content=body.question_text.strip(),
        status=WallPostStatus.open,
        is_anonymous_to_peers=True,
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    subj = db.query(Subject).filter(Subject.id == sess.subject_id).first()
    capsule = db.query(Capsule).filter(Capsule.id == sess.capsule_id).first() if sess.capsule_id else None
    ai_suggestion = None
    confidence = 0.0
    try:
        result = await auto_answer_doubt(
            post.content,
            subj.name if subj else "",
            (capsule.ai_summary if capsule else None),
        )
        post.ai_suggested_answer = result.get("answer") or None
        post.ai_answer_confidence = float(result.get("confidence", 0.0))
        db.commit()
        ai_suggestion = result.get("answer")
        confidence = float(result.get("confidence", 0.0))
    except Exception as exc:
        logger.warning("auto_answer_doubt failed for live post %s: %s", post.id, exc)

    return {
        "doubt_id": post.id,
        "ai_suggestion": ai_suggestion,
        "confidence": confidence,
    }


@router.get("/sessions/{session_id}/doubts")
def list_doubts(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    is_owner = sess.teacher_id == current_user["id"]

    rows = (
        db.query(ClassWallPost)
        .filter(ClassWallPost.live_session_id == session_id)
        .order_by(ClassWallPost.resonance_count.desc(), ClassWallPost.created_at.desc())
        .limit(200)
        .all()
    )

    out = []
    for p in rows:
        author_name = None
        if is_owner or current_user["role"] in ("hod", "principal"):
            student = db.query(User).filter(User.id == p.student_id).first()
            author_name = student.name if student else None
        out.append({
            "id": p.id,
            "content": p.content,
            "resonance_count": p.resonance_count,
            "is_hot": p.is_hot,
            "ai_suggested_answer": p.ai_suggested_answer,
            "ai_confidence": p.ai_answer_confidence,
            "teacher_answer": p.teacher_answer,
            "status": p.status.value,
            "author_name": author_name,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return {"doubts": out, "total": len(out)}


# ═══════════════════════════════════════════════════════════════════════
# SECTION F — Pre-class brief / Health report / Student report
# ═══════════════════════════════════════════════════════════════════════

@router.get("/sessions/{session_id}/pre-class-brief")
async def pre_class_brief(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    if not sess.subject_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session has no subject; pre-class brief unavailable.")
    context = {
        "title": sess.title,
        "session_type": sess.session_type.value,
        "section_id": sess.section_id,
    }
    brief = await generate_pre_class_brief(
        teacher_id=sess.teacher_id,
        subject_id=sess.subject_id,
        upcoming_session_context=context,
        db=db,
    )
    return brief


@router.get("/sessions/{session_id}/health-report")
def health_report(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    if sess.teacher_id != current_user["id"] and current_user["role"] not in ("hod", "principal"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed.")
    if sess.status != LiveSessionStatus.ended:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Health report available after the session ends.")
    if not sess.health_report_json:
        return {"status": "generating", "estimated_seconds": 30}
    return {"status": "ready", "report": sess.health_report_json, "health_score": sess.session_health_score}


@router.get("/sessions/{session_id}/student-report/{student_id}")
def student_report(
    session_id: int,
    student_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    if current_user["role"] not in ("teacher", "hod", "principal"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed.")
    if current_user["role"] == "teacher" and sess.teacher_id != current_user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your session.")

    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    part = _participant_for_session(db, session_id, user_id=student_id)
    duration = part.total_duration_seconds if part else 0
    counted = part.is_attendance_counted if part else False

    doubts = (
        db.query(ClassWallPost)
        .filter(
            ClassWallPost.live_session_id == session_id,
            ClassWallPost.student_id == student_id,
        )
        .all()
    )

    obs_events = (
        db.query(LiveSessionEvent)
        .filter(LiveSessionEvent.live_session_id == session_id)
        .all()
    )
    relevant_events = [
        {
            "type": e.event_type.value,
            "observation": e.ai_observation_text,
            "metadata": e.metadata_json,
            "ts": e.event_timestamp.isoformat() if e.event_timestamp else None,
        }
        for e in obs_events
        if (e.affected_student_ids or []) and student_id in (e.affected_student_ids or [])
    ]

    kg_rows = (
        db.query(StudentKnowledgeGraph)
        .filter(
            StudentKnowledgeGraph.student_id == student_id,
            StudentKnowledgeGraph.subject_id == sess.subject_id,
            StudentKnowledgeGraph.last_assessed_session_id == session_id,
        )
        .all()
    )

    return {
        "student_name": student.name,
        "duration_seconds": duration,
        "duration_minutes": round(duration / 60, 1),
        "attendance_counted": counted,
        "doubts_posted": [{"id": d.id, "content": d.content, "status": d.status.value} for d in doubts],
        "ai_observations": relevant_events,
        "knowledge_graph_updates": [
            {
                "topic": k.topic_name,
                "level": k.understanding_level.value,
                "confidence": k.confidence_score,
                "times_confused": k.times_confused,
                "times_understood": k.times_understood,
            }
            for k in kg_rows
        ],
    }


# ═══════════════════════════════════════════════════════════════════════
# SECTION G — Breakout rooms
# ═══════════════════════════════════════════════════════════════════════

@router.post("/sessions/{session_id}/breakout/create")
def breakout_create(
    session_id: int,
    body: BreakoutCreateReq,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    if sess.status != LiveSessionStatus.live:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is not live.")
    if not body.rooms:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "At least one room required.")

    created = []
    for idx, r in enumerate(body.rooms, start=1):
        name = str(r.get("name", f"Room {idx}"))[:100]
        pids = r.get("participant_ids") or []
        if not isinstance(pids, list):
            continue
        room = LiveSessionBreakoutRoom(
            live_session_id=session_id,
            room_name=name,
            room_number=idx,
            participant_ids=[int(x) for x in pids if isinstance(x, (int, str)) and str(x).isdigit()],
        )
        db.add(room)
        db.flush()
        created.append(room)
    db.commit()

    _log_event(db, session_id, LiveEventType.breakout_started, LiveEventTrigger.teacher,
               metadata_json={"rooms": [{"id": r.id, "name": r.room_name} for r in created]})

    return {
        "rooms": [
            {
                "id": r.id,
                "name": r.room_name,
                "room_number": r.room_number,
                "participant_ids": r.participant_ids,
                "room_join_token": str(uuid4()),
            }
            for r in created
        ]
    }


@router.post("/sessions/{session_id}/breakout/{room_id}/ai-status")
def breakout_ai_status(
    session_id: int,
    room_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    _require_session_owner(session_id, current_user, db)
    room = db.query(LiveSessionBreakoutRoom).filter(
        LiveSessionBreakoutRoom.id == room_id,
        LiveSessionBreakoutRoom.live_session_id == session_id,
    ).first()
    if not room:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found.")

    log = room.ai_monitoring_log or {}
    productivity = int(log.get("productivity_score") or 65)
    is_stuck = bool(log.get("is_stuck") or False)
    observation = log.get("observation") or "Group is discussing actively."
    peer_id = log.get("peer_expert_user_id") or room.peer_expert_detected_user_id
    peer = db.query(User).filter(User.id == peer_id).first() if peer_id else None

    return {
        "productivity_score": productivity,
        "is_stuck": is_stuck,
        "observation": observation,
        "peer_expert_detected": {"user_id": peer.id, "name": peer.name} if peer else None,
        "teacher_intervention_recommended": is_stuck or productivity < 50,
    }


@router.post("/sessions/{session_id}/breakout/end-all")
def breakout_end_all(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    _require_session_owner(session_id, current_user, db)
    rooms = (
        db.query(LiveSessionBreakoutRoom)
        .filter(
            LiveSessionBreakoutRoom.live_session_id == session_id,
            LiveSessionBreakoutRoom.ended_at.is_(None),
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    peer_experts = []
    for r in rooms:
        r.ended_at = now
        if r.peer_expert_detected_user_id:
            u = db.query(User).filter(User.id == r.peer_expert_detected_user_id).first()
            if u:
                peer_experts.append({"name": u.name, "topic": r.room_name})
    db.commit()

    _log_event(db, session_id, LiveEventType.breakout_ended, LiveEventTrigger.teacher,
               metadata_json={"rooms_closed": len(rooms)})

    return {"rooms_closed": len(rooms), "peer_experts_identified": peer_experts}


# ═══════════════════════════════════════════════════════════════════════
# SECTION H — Knowledge graph
# ═══════════════════════════════════════════════════════════════════════

def _kg_response(rows: list[StudentKnowledgeGraph], student_name: str, subject_name: Optional[str]) -> dict:
    if not rows:
        return {
            "student_name": student_name,
            "subject_name": subject_name,
            "topics": [],
            "overall_subject_health": "moderate",
            "last_session_performance": "No data yet.",
        }

    topics = [
        {
            "topic_name": r.topic_name,
            "understanding_level": r.understanding_level.value,
            "confidence_score": round(r.confidence_score, 2),
            "times_confused": r.times_confused,
            "times_understood": r.times_understood,
            "last_updated": r.last_updated.isoformat() if r.last_updated else None,
            "ai_notes": r.ai_notes,
        }
        for r in rows
    ]
    weak = sum(1 for r in rows if r.understanding_level == KnowledgeLevel.weak)
    strong = sum(1 for r in rows if r.understanding_level == KnowledgeLevel.strong)
    if weak >= len(rows) // 2 and weak > 0:
        health = "at_risk"
    elif strong >= len(rows) // 2:
        health = "strong"
    else:
        health = "moderate"
    return {
        "student_name": student_name,
        "subject_name": subject_name,
        "topics": topics,
        "overall_subject_health": health,
        "last_session_performance": f"{strong} strong, {weak} weak topics across {len(rows)} concepts.",
    }


@router.get("/students/{student_id}/knowledge-graph")
def student_knowledge_graph(
    student_id: int,
    subject_id: Optional[int] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user["role"]
    if role not in ("teacher", "hod", "principal", "student"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed.")
    if role == "student" and current_user["id"] != student_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Students can only view their own graph.")

    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    q = db.query(StudentKnowledgeGraph).filter(StudentKnowledgeGraph.student_id == student_id)
    if subject_id is not None:
        q = q.filter(StudentKnowledgeGraph.subject_id == subject_id)
    rows = q.order_by(StudentKnowledgeGraph.last_updated.desc()).all()

    subj_name = None
    if subject_id is not None:
        subj = db.query(Subject).filter(Subject.id == subject_id).first()
        subj_name = subj.name if subj else None

    return _kg_response(rows, student.name, subj_name)


@router.get("/students/my-knowledge-graph")
def my_knowledge_graph(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] != "student":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Student endpoint only.")
    rows = (
        db.query(StudentKnowledgeGraph)
        .filter(StudentKnowledgeGraph.student_id == current_user["id"])
        .order_by(StudentKnowledgeGraph.subject_id.asc(), StudentKnowledgeGraph.last_updated.desc())
        .all()
    )
    by_subject: dict[int, list[StudentKnowledgeGraph]] = {}
    for r in rows:
        by_subject.setdefault(r.subject_id, []).append(r)

    out = []
    for sid, srows in by_subject.items():
        subj = db.query(Subject).filter(Subject.id == sid).first()
        payload = _kg_response(srows, current_user.get("name", "Student"), subj.name if subj else None)
        payload["subject_id"] = sid
        out.append(payload)

    suggestions = []
    weak_topics = [r for r in rows if r.understanding_level == KnowledgeLevel.weak][:3]
    for w in weak_topics:
        suggestions.append(f"Review topic: {w.topic_name}")
    return {"subjects": out, "suggestions": suggestions}


# ═══════════════════════════════════════════════════════════════════════
# SECTION I — Analytics summaries
# ═══════════════════════════════════════════════════════════════════════

@router.get("/analytics/teacher-summary")
def analytics_teacher_summary(
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    teacher_id = current_user["id"]
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    sessions = (
        db.query(LiveSession)
        .filter(
            LiveSession.teacher_id == teacher_id,
            LiveSession.created_at >= cutoff,
        )
        .all()
    )
    health_scores = [s.session_health_score for s in sessions if s.session_health_score is not None]
    avg_health = round(sum(health_scores) / len(health_scores), 1) if health_scores else 0.0

    attendance_avgs: list[float] = []
    for s in sessions:
        total = (
            db.query(func.count(LiveSessionParticipant.id))
            .filter(
                LiveSessionParticipant.live_session_id == s.id,
                LiveSessionParticipant.participant_type == LiveParticipantType.student,
            )
            .scalar() or 0
        )
        present = (
            db.query(func.count(LiveSessionParticipant.id))
            .filter(
                LiveSessionParticipant.live_session_id == s.id,
                LiveSessionParticipant.participant_type == LiveParticipantType.student,
                LiveSessionParticipant.is_attendance_counted == True,  # noqa: E712
            )
            .scalar() or 0
        )
        if total:
            attendance_avgs.append(present / total * 100)
    avg_attendance = round(sum(attendance_avgs) / len(attendance_avgs), 1) if attendance_avgs else 0.0

    sids = [s.id for s in sessions]
    confused_topics: dict[str, int] = {}
    if sids:
        events = (
            db.query(LiveSessionEvent)
            .filter(
                LiveSessionEvent.live_session_id.in_(sids),
                LiveSessionEvent.event_type == LiveEventType.ai_observation,
            )
            .all()
        )
        for e in events:
            md = e.metadata_json or {}
            if md.get("type") == "confusion":
                topic = (md.get("topic") or "general")[:80]
                confused_topics[topic] = confused_topics.get(topic, 0) + 1
    top_confused = sorted(confused_topics.items(), key=lambda x: x[1], reverse=True)[:5]

    best = sorted(sessions, key=lambda s: s.session_health_score or 0, reverse=True)[:5]

    follow_up_students: list[dict] = []
    subj_ids_for_teacher = list({s.subject_id for s in sessions if s.subject_id})
    if subj_ids_for_teacher:
        weak_rows = (
            db.query(StudentKnowledgeGraph, User)
            .join(User, User.id == StudentKnowledgeGraph.student_id)
            .filter(
                StudentKnowledgeGraph.subject_id.in_(subj_ids_for_teacher),
                StudentKnowledgeGraph.understanding_level == KnowledgeLevel.weak,
            )
            .order_by(StudentKnowledgeGraph.confidence_score.asc())
            .limit(10)
            .all()
        )
        seen = set()
        for kg, u in weak_rows:
            if u.id in seen:
                continue
            seen.add(u.id)
            follow_up_students.append({"id": u.id, "name": u.name, "weak_topic": kg.topic_name})

    return {
        "session_count": len(sessions),
        "average_health_score": avg_health,
        "average_attendance_pct": avg_attendance,
        "most_confused_topics": [{"topic": t, "count": c} for t, c in top_confused],
        "best_performing_sessions": [
            {"id": s.id, "title": s.title, "health_score": s.session_health_score} for s in best
        ],
        "students_needing_followup": follow_up_students,
    }


@router.get("/analytics/hod-overview")
def analytics_hod_overview(
    current_user: dict = Depends(hod_or_above),
    db: Session = Depends(get_db),
):
    department_id = current_user.get("department_id")
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)

    subj_ids: list[int] = []
    if department_id and hasattr(Subject, "course_id"):
        from database import Course
        subj_ids = [
            r[0] for r in (
                db.query(Subject.id)
                .join(Course, Course.id == Subject.course_id)
                .filter(Course.department_id == department_id)
                .all()
            )
        ]
    if not subj_ids:
        subj_ids = [r[0] for r in db.query(Subject.id).all()]

    q = db.query(LiveSession).filter(LiveSession.created_at >= cutoff)
    if subj_ids:
        q = q.filter(LiveSession.subject_id.in_(subj_ids))
    sessions = q.all()

    per_subject: dict[int, int] = {}
    for s in sessions:
        if s.subject_id:
            per_subject[s.subject_id] = per_subject.get(s.subject_id, 0) + 1

    by_teacher: dict[int, list[int]] = {}
    for s in sessions:
        if s.session_health_score is not None:
            by_teacher.setdefault(s.teacher_id, []).append(s.session_health_score)
    teacher_health = []
    for tid, scores in by_teacher.items():
        u = db.query(User).filter(User.id == tid).first()
        teacher_health.append({
            "teacher_id": tid,
            "teacher_name": u.name if u else f"#{tid}",
            "avg_health_score": round(sum(scores) / len(scores), 1),
            "sessions": len(scores),
        })

    comp_scores = []
    for s in sessions:
        rep = s.health_report_json or {}
        if isinstance(rep, dict) and rep.get("comprehension_score") is not None:
            try:
                comp_scores.append(int(rep["comprehension_score"]))
            except (TypeError, ValueError):
                pass
    avg_comprehension = round(sum(comp_scores) / len(comp_scores), 1) if comp_scores else 0.0

    at_risk = []
    if subj_ids:
        rows = (
            db.query(StudentKnowledgeGraph, User)
            .join(User, User.id == StudentKnowledgeGraph.student_id)
            .filter(
                StudentKnowledgeGraph.subject_id.in_(subj_ids),
                StudentKnowledgeGraph.understanding_level == KnowledgeLevel.weak,
            )
            .order_by(StudentKnowledgeGraph.confidence_score.asc())
            .limit(20)
            .all()
        )
        seen = set()
        for kg, u in rows:
            if u.id in seen:
                continue
            seen.add(u.id)
            at_risk.append({
                "id": u.id, "name": u.name,
                "weak_topic": kg.topic_name,
                "confidence": round(kg.confidence_score, 2),
            })

    return {
        "total_sessions_30d": len(sessions),
        "sessions_per_subject": [
            {"subject_id": sid, "count": c} for sid, c in per_subject.items()
        ],
        "avg_health_by_teacher": teacher_health,
        "avg_department_comprehension": avg_comprehension,
        "at_risk_students": at_risk,
    }
