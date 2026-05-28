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
from typing import List, Optional
from uuid import uuid4

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
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
    CapsuleType,
    CapsuleUnlockMode,
    ClassWallPost,
    KnowledgeLevel,
    LiveConnectionQuality,
    LiveEventTrigger,
    LiveEventType,
    LiveParticipantType,
    LivePulseCheck,
    LivePulseResponse,
    LiveSession,
    LiveSessionBreakoutRoom,
    LiveSessionEvent,
    LiveSessionObservation,
    LiveSessionParticipant,
    LiveSessionStatus,
    LiveSessionType,
    LiveAIIntervention,
    LiveEngagementSnapshot,
    LiveSessionBookmark,
    LiveStudentEngagement,
    MarkedBy,
    PulseCheck,
    PulseCheckAnswer,
    PulseCheckTrigger,
    Section,
    SessionStatus,
    SessionLocal,
    StudentKnowledgeGraph,
    StudentPreclassWarmup,
    StudentTopicMastery,
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
from utils.sanitization import clean_text
from utils.agora_token import generate_agora_token
from utils.session_manager import manager as live_ws_manager
from utils.live_session_ai import (
    _ai_json,
    _call_ai_text,
    generate_ai_observation,
    generate_auto_capsule_from_session,
    generate_diagram_from_code,
    generate_ai_intervention,
    generate_intervention_suggestion,
    generate_pre_class_brief,
    generate_pulse_check_question,
    generate_session_health_report,
    generate_session_narrative,
    update_student_knowledge_graph,
    update_student_topic_mastery,
)
from utils.notification_utils import send_push_notification, send_push_to_many

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
    from utils.auth_utils import jwt_signing_key
    return jwt.encode(payload, jwt_signing_key(), algorithm=settings.ALGORITHM)


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
    from database import SessionLocal, CapsuleInteraction
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

        # Build "homework + topics" combined description for backwards compat
        topic_labels = result.get("topic_labels") or []
        cap = Capsule(
            subject_id=sess.subject_id,
            teacher_id=sess.teacher_id,
            section_id=sess.section_id,
            title=f"[Live] {result['title'][:170]}",
            description=(
                f"Auto-generated from live session on "
                f"{(sess.started_at or datetime.utcnow()).strftime('%d %b %Y')}"
            ),
            capsule_type=CapsuleType.notes,
            unlock_mode=CapsuleUnlockMode.after_attendance_marked,
            ai_summary=result.get("summary") or None,
            ai_quiz_json=result.get("quiz_questions") or None,
            ai_processed=True,
            # ── Auto-capsule extras (PROMPT 6) ────────────────────────
            is_auto_generated=True,
            source_live_session_id=sess.id,
            chapters=result.get("chapters") or [],
            student_specific_notes=result.get("student_specific_notes") or [],
            homework_suggestion=result.get("homework_suggestion") or None,
            recording_url=sess.recording_url,
        )
        db.add(cap)
        db.flush()
        sess.auto_capsule_id = cap.id

        # Pre-create interactions for students who attended → instant unlock
        attending_ids = [
            p.user_id for p in db.query(LiveSessionParticipant)
            .filter(
                LiveSessionParticipant.live_session_id == session_id,
                LiveSessionParticipant.participant_type == LiveParticipantType.student,
                LiveSessionParticipant.user_id.isnot(None),
                LiveSessionParticipant.is_attendance_counted.is_(True),
            ).all()
        ]
        now = datetime.utcnow()
        for sid in attending_ids:
            interaction = CapsuleInteraction(
                capsule_id=cap.id,
                student_id=sid,
                first_opened_at=None,
                total_pages=len(cap.chapters or []) or 1,
            )
            db.add(interaction)

        db.commit()
        db.refresh(cap)
        logger.info(
            "Auto-capsule %s generated for live session %s (%d students unlocked)",
            cap.id, session_id, len(attending_ids),
        )

        # F06 — refresh per-student topic mastery now that capsule (and its
        # topics_covered list) is in place.
        try:
            await update_student_topic_mastery(session_id, db)
        except Exception as exc:
            logger.warning("topic-mastery update after capsule failed: %s", exc)

        # Notify teacher
        try:
            send_push_notification(
                user_id=sess.teacher_id,
                title="Auto-Capsule Generated ✅",
                body=f"Your '{sess.title}' capsule is ready. {len(attending_ids)} students have access.",
                db=db,
                data={"type": "capsule_generated", "capsule_id": cap.id},
            )
        except Exception:
            logger.debug("Teacher push notification skipped (no token).")
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


def _notify_absent_students_async(session_id: int) -> None:
    """
    For students enrolled in the section but NOT counted as present in the
    just-ended live session, compute consecutive misses across recent live
    sessions for the same subject+section, then notify tutor (and parent if
    >= 3).  PROMPT 7.
    """
    from database import SessionLocal
    from utils.live_notifications import notify_parent_student_missed_live_session
    db = SessionLocal()
    try:
        sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
        if not sess or not sess.subject_id or not sess.section_id:
            return

        # Enrolled students in the section
        enrolled = (
            db.query(User.id)
            .filter(
                User.section_id == sess.section_id,
                User.role == UserRole.student,
                User.is_active.is_(True),
            )
            .all()
        )
        enrolled_ids = {r[0] for r in enrolled}

        # Present (attendance counted) in this session
        present_ids = {
            r[0]
            for r in db.query(LiveSessionParticipant.user_id)
            .filter(
                LiveSessionParticipant.live_session_id == session_id,
                LiveSessionParticipant.is_attendance_counted.is_(True),
                LiveSessionParticipant.user_id.isnot(None),
            )
            .all()
        }
        absent_ids = enrolled_ids - present_ids
        if not absent_ids:
            return

        subject_name = (
            db.query(Subject.name).filter(Subject.id == sess.subject_id).scalar()
            or "Subject"
        )

        # Last 5 live sessions for this subject+section (chronological desc)
        recent = (
            db.query(LiveSession.id)
            .filter(
                LiveSession.subject_id == sess.subject_id,
                LiveSession.section_id == sess.section_id,
                LiveSession.status == LiveSessionStatus.ended,
            )
            .order_by(LiveSession.ended_at.desc().nullslast())
            .limit(5)
            .all()
        )
        recent_ids = [r[0] for r in recent]

        for sid in absent_ids:
            # Walk recent sessions until we find one where they were present
            consecutive = 0
            for rid in recent_ids:
                was_present = (
                    db.query(LiveSessionParticipant.id)
                    .filter(
                        LiveSessionParticipant.live_session_id == rid,
                        LiveSessionParticipant.user_id == sid,
                        LiveSessionParticipant.is_attendance_counted.is_(True),
                    )
                    .first()
                )
                if was_present:
                    break
                consecutive += 1
            if consecutive >= 2:
                try:
                    notify_parent_student_missed_live_session(
                        student_id=sid,
                        session_title=sess.title,
                        subject_name=subject_name,
                        consecutive_misses=consecutive,
                        db=db,
                    )
                except Exception as e:
                    logger.warning("absent notify failed for %s: %s", sid, e)
    except Exception as exc:
        logger.error("_notify_absent_students_async failed: %s", exc)
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

@router.get("/teacher/options")
def get_teacher_session_options(
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """
    Returns the subjects this teacher owns plus all sections that belong to
    each subject's course (department-scoped). Powers the Create-Live-Session
    modal dropdowns for `standalone` sessions.
    """
    from database import Course  # local import (matches existing pattern)

    teacher_id = current_user["id"]
    subjects = db.query(Subject).filter(Subject.teacher_id == teacher_id).all()
    if not subjects:
        return {"subjects": []}

    course_ids = {s.course_id for s in subjects if s.course_id}
    courses = {c.id: c for c in db.query(Course).filter(Course.id.in_(course_ids)).all()} if course_ids else {}
    dept_ids = {c.department_id for c in courses.values() if c.department_id}
    sections_by_dept: dict[int, list[Section]] = {}
    if dept_ids:
        for sec in db.query(Section).filter(Section.department_id.in_(dept_ids)).all():
            sections_by_dept.setdefault(sec.department_id, []).append(sec)

    out = []
    for s in subjects:
        course = courses.get(s.course_id)
        dept_id = course.department_id if course else None
        sections = sections_by_dept.get(dept_id, []) if dept_id else []
        out.append({
            "id": s.id,
            "name": s.name,
            "code": s.code,
            "semester": s.semester,
            "course_id": s.course_id,
            "sections": [
                {"id": sec.id, "name": sec.name}
                for sec in sections
                # only sections whose course matches the subject's course (when course_id set on Section)
                if (getattr(sec, "course_id", None) in (None, s.course_id))
            ],
        })
    return {"subjects": out}


@router.get("/join/{join_link}/info")
def get_session_public_info(join_link: str, db: Session = Depends(get_db)):
    """
    PUBLIC (no-auth) endpoint that returns enough metadata for a guest /
    student to see what session they're about to join, before submitting
    a password / guest name. Used by the public /live/:joinCode page.
    """
    sess = db.query(LiveSession).filter(LiveSession.join_link == join_link.upper()).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    teacher = db.query(User).filter(User.id == sess.teacher_id).first()
    subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None

    return {
        "session_id": sess.id,
        "title": sess.title,
        "status": sess.status.value if hasattr(sess.status, "value") else str(sess.status),
        "session_type": sess.session_type.value if hasattr(sess.session_type, "value") else str(sess.session_type),
        "teacher_name": teacher.name if teacher else None,
        "subject_name": subj.name if subj else None,
        "allow_guests": bool(sess.allow_guests),
        "allow_guest_interaction": bool(sess.allow_guest_interaction),
        "requires_password": bool(sess.join_password),
        "started_at": sess.started_at.isoformat() if sess.started_at else None,
        "recording_enabled": bool(sess.recording_enabled),
    }


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

    # For public sessions, subject/section are completely optional and the
    # link is shareable with anyone — guests are allowed by default unless
    # the teacher explicitly turned them off.
    allow_guests_flag = body.allow_guests
    allow_guest_interaction_flag = body.allow_guest_interaction
    if body.session_type == "public":
        # If the caller didn't pass allow_guests at all, default to True.
        # (Pydantic gives False by default, so this is a UX safety net for
        # public links so they actually accept guests out of the box.)
        if not allow_guests_flag and not allow_guest_interaction_flag:
            allow_guests_flag = True

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
        allow_guests=allow_guests_flag,
        allow_guest_interaction=allow_guest_interaction_flag,
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
    background.add_task(_notify_absent_students_async, sess.id)

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
        webrtc_cfg = _build_webrtc_config(
            sess.join_link, guest_token,
            uid=-new_part.id,  # negative-id space for guests; agora helper masks to uint32
            role="subscriber",
        )
        # Persist the (masked) Agora UID so the participant-names endpoint
        # can resolve numeric Agora UIDs back to real names.
        new_part.agora_uid = int(webrtc_cfg.get("agora", {}).get("uid") or 0) or None
        db.commit()

        teacher = db.query(User).filter(User.id == sess.teacher_id).first()
        teacher_part = (
            db.query(LiveSessionParticipant)
            .filter(
                LiveSessionParticipant.live_session_id == sess.id,
                LiveSessionParticipant.participant_type == LiveParticipantType.teacher,
            )
            .first()
        )
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
            "webrtc_config": webrtc_cfg,
            "teacher_agora_uid": teacher_part.agora_uid if teacher_part else None,
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

    webrtc_cfg = _build_webrtc_config(
        sess.join_link, str(uuid4()),
        uid=user_id,
        role="publisher" if p_type == LiveParticipantType.teacher else "subscriber",
    )
    # Persist Agora UID so the participant-names endpoint can map
    # numeric Agora UIDs back to real users.
    part.agora_uid = int(webrtc_cfg.get("agora", {}).get("uid") or 0) or None
    db.commit()

    teacher = db.query(User).filter(User.id == sess.teacher_id).first()
    teacher_part = (
        db.query(LiveSessionParticipant)
        .filter(
            LiveSessionParticipant.live_session_id == sess.id,
            LiveSessionParticipant.participant_type == LiveParticipantType.teacher,
        )
        .first()
    )
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
        "webrtc_config": webrtc_cfg,
        "teacher_agora_uid": teacher_part.agora_uid if teacher_part else None,
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

    # F02 — per-student engagement counter
    try:
        eng = (
            db.query(LiveStudentEngagement)
            .filter(LiveStudentEngagement.session_id == session_id)
            .filter(
                or_(
                    LiveStudentEngagement.student_id == part.user_id if part.user_id else False,
                    LiveStudentEngagement.participant_id == part.id,
                )
            )
            .first()
        )
        if eng:
            eng.heartbeat_count = (eng.heartbeat_count or 0) + 1
            eng.last_active_at  = now
        else:
            eng = LiveStudentEngagement(
                session_id      = session_id,
                student_id      = part.user_id,
                participant_id  = part.id,
                heartbeat_count = 1,
                last_active_at  = now,
            )
            db.add(eng)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("engagement upsert failed: %s", exc)

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


# ─── Participant-name resolution (Agora UID → real name) ────────────
@router.get("/sessions/{session_id}/participant-names")
def get_participant_names(
    session_id: int,
    current_user: Optional[dict] = Depends(_get_optional_user),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
):
    """
    Returns a mapping `{ "<agora_uid>": {name, role, user_id} }` for every
    currently-active participant in the session.

    The frontend uses this to label Agora video tiles (which only carry
    integer UIDs) with real student / teacher / guest names. Called once
    after joining and then refreshed on a timer + on WS `student_joined`
    events.
    """
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    # Authorisation — accept any of:
    #   • teacher who owns the session
    #   • authenticated student/teacher who is an active participant
    #   • guest carrying a guest JWT issued for this session
    authorised = False
    if current_user:
        user_id = current_user.get("id")
        if sess.teacher_id == user_id:
            authorised = True
        elif (
            db.query(LiveSessionParticipant)
            .filter(
                LiveSessionParticipant.live_session_id == session_id,
                LiveSessionParticipant.user_id == user_id,
                LiveSessionParticipant.is_active.is_(True),
            )
            .first()
            is not None
        ):
            authorised = True

    if not authorised and credentials and credentials.credentials:
        # Try to validate as a guest token for this session
        try:
            from utils.auth_utils import jwt_verify_key
            payload = jwt.decode(
                credentials.credentials,
                jwt_verify_key(),
                algorithms=[settings.ALGORITHM],
            )
            if payload.get("purpose") == "live_guest" and int(payload.get("session_id") or 0) == session_id:
                authorised = True
        except Exception:
            pass

    if not authorised:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a participant in this session.")

    parts = (
        db.query(LiveSessionParticipant)
        .filter(
            LiveSessionParticipant.live_session_id == session_id,
            LiveSessionParticipant.is_active.is_(True),
        )
        .all()
    )

    # Pre-fetch user names in one query (PS7-B)
    user_ids = [p.user_id for p in parts if p.user_id]
    users_map: dict[int, User] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_map[u.id] = u

    result: dict[str, dict] = {}
    for p in parts:
        if not p.agora_uid:
            continue
        if p.participant_type == LiveParticipantType.guest:
            entry = {
                "name":    p.guest_name or "Guest",
                "role":    "guest",
                "user_id": None,
            }
        elif p.user_id:
            u = users_map.get(p.user_id)
            display = (u.name if u else "") or p.guest_name or f"User {p.agora_uid}"
            if p.participant_type == LiveParticipantType.teacher:
                display = f"👩‍🏫 {display}"
            entry = {
                "name":    display,
                "role":    p.participant_type.value,
                "user_id": p.user_id,
            }
        else:
            continue
        # JSON keys are always strings; normalising to str(uid) is sufficient.
        # Frontend always looks up via String(uid).
        result[str(int(p.agora_uid))] = entry

    # Make sure the teacher (who may not have an active participant row yet)
    # still resolves to a friendly name when the frontend sees that UID.
    teacher_part = next(
        (p for p in parts if p.participant_type == LiveParticipantType.teacher and p.agora_uid),
        None,
    )
    if not teacher_part:
        teacher_user = db.query(User).filter(User.id == sess.teacher_id).first()
        if teacher_user:
            tp = (
                db.query(LiveSessionParticipant)
                .filter(
                    LiveSessionParticipant.live_session_id == session_id,
                    LiveSessionParticipant.participant_type == LiveParticipantType.teacher,
                )
                .first()
            )
            if tp and tp.agora_uid:
                result[str(int(tp.agora_uid))] = {
                    "name":    f"👩‍🏫 {teacher_user.name}",
                    "role":    "teacher",
                    "user_id": teacher_user.id,
                }

    return result


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
        content=clean_text(body.question_text.strip()),
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
async def health_report(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    F08 — Full session health report. Computed live from
    pulses + observations + doubts + participants. Always returns the
    rich shape (overall_score, metrics{}, pulse_results, ai_narrative)
    plus backwards-compatible `health_score` / `attendance_percentage`
    keys for the existing PostSessionView card.
    """
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    if sess.teacher_id != current_user["id"] and current_user["role"] not in ("hod", "principal"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed.")

    subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None
    subject_name = subj.name if subj else "Unknown"

    # ─ 1. ATTENDANCE ────────────────────────────────────────────────
    total_participants = (
        db.query(LiveSessionParticipant)
        .filter(LiveSessionParticipant.live_session_id == session_id)
        .count()
    )

    duration_secs = 0
    if sess.started_at and sess.ended_at:
        duration_secs = max(1, int((sess.ended_at - sess.started_at).total_seconds()))

    min_attend = duration_secs * 0.7 if duration_secs > 0 else 0
    if duration_secs > 0:
        attended = (
            db.query(LiveSessionParticipant)
            .filter(
                LiveSessionParticipant.live_session_id == session_id,
                LiveSessionParticipant.total_duration_seconds >= min_attend,
            )
            .count()
        )
    else:
        attended = total_participants

    attendance_pct = round(attended / total_participants * 100, 1) if total_participants else 0.0

    # ─ 2. ENGAGEMENT (≥50% time present) ────────────────────────────
    if duration_secs > 0:
        engaged = (
            db.query(LiveSessionParticipant)
            .filter(
                LiveSessionParticipant.live_session_id == session_id,
                LiveSessionParticipant.total_duration_seconds >= duration_secs * 0.5,
            )
            .count()
        )
    else:
        engaged = total_participants
    engagement_pct = round(engaged / total_participants * 100, 1) if total_participants else 0.0

    # ─ 3. COMPREHENSION from live pulse-checks ──────────────────────
    pulses = (
        db.query(LivePulseCheck)
        .filter(
            LivePulseCheck.live_session_id == session_id,
            LivePulseCheck.is_active == False,                 # noqa: E712
            LivePulseCheck.correct_option.isnot(None),
            LivePulseCheck.total_responses > 0,
        )
        .all()
    )
    comprehension_pct: Optional[float] = None
    if pulses:
        comps = [
            round(p.correct_count / p.total_responses * 100, 1)
            for p in pulses if p.total_responses > 0
        ]
        comprehension_pct = round(sum(comps) / len(comps), 1) if comps else None

    # ─ 4. CONFUSION POINTS ──────────────────────────────────────────
    confusion_count = (
        db.query(LiveSessionObservation)
        .filter(
            LiveSessionObservation.live_session_id == session_id,
            LiveSessionObservation.obs_type == "confusion",
            LiveSessionObservation.severity.in_(["medium", "high"]),
        )
        .count()
    )

    # ─ 5. DOUBTS (within session window) ────────────────────────────
    if sess.started_at and sess.ended_at and sess.subject_id:
        doubts = (
            db.query(ClassWallPost)
            .filter(
                ClassWallPost.subject_id == sess.subject_id,
                ClassWallPost.created_at >= sess.started_at,
                ClassWallPost.created_at <= sess.ended_at,
            )
            .all()
        )
    else:
        doubts = []
    doubts_posted = len(doubts)
    doubts_resolved = sum(
        1 for d in doubts
        if (d.status.value if hasattr(d.status, "value") else str(d.status)) == "answered"
    )

    # ─ 6. PACE SCORE ────────────────────────────────────────────────
    duration_mins = max(1, duration_secs / 60) if duration_secs else 1
    pulses_per_hour = (len(pulses) / duration_mins) * 60 if pulses else 0
    if 2 <= pulses_per_hour <= 4:
        pace_label, pace_score = "Good", 90
    elif pulses_per_hour > 4:
        pace_label, pace_score = "Fast", 70
    elif pulses_per_hour >= 1:
        pace_label, pace_score = "Slow", 65
    else:
        pace_label, pace_score = "Unknown", 60

    # ─ 7. OVERALL HEALTH SCORE ──────────────────────────────────────
    weights = {"attendance": 0.30, "engagement": 0.25, "comprehension": 0.25,
               "doubts": 0.10, "pace": 0.10}
    comp_score = comprehension_pct if comprehension_pct is not None else 60.0
    doubts_score = (
        min(100, doubts_resolved / max(1, doubts_posted) * 100)
        if doubts_posted else 80.0
    )
    overall = round(
        attendance_pct * weights["attendance"]
        + engagement_pct * weights["engagement"]
        + comp_score * weights["comprehension"]
        + doubts_score * weights["doubts"]
        + pace_score * weights["pace"]
    )

    # ─ 8. AI NARRATIVE ──────────────────────────────────────────────
    try:
        ai_narrative = await generate_session_narrative(
            subject_name=subject_name,
            overall_score=overall,
            attendance_pct=attendance_pct,
            engagement_pct=engagement_pct,
            comprehension_pct=comprehension_pct,
            confusion_count=confusion_count,
            doubts_posted=doubts_posted,
            doubts_resolved=doubts_resolved,
            duration_mins=int(duration_mins),
        )
    except Exception as exc:
        logger.warning("health-report narrative failed: %s", exc)
        ai_narrative = f"Session completed with {attendance_pct}% attendance."

    # Cache to DB column for legacy consumers
    try:
        sess.session_health_score = overall
        db.commit()
    except Exception:
        db.rollback()

    return {
        "status":          "ready",
        "session_id":      session_id,
        "subject_name":    subject_name,
        "overall_score":   overall,
        "duration_mins":   int(duration_mins),
        # ── new rich shape ──
        "metrics": {
            "attendance":       {"value": attendance_pct,    "label": f"{attended}/{total_participants} students"},
            "engagement":       {"value": engagement_pct,    "label": "Active participation"},
            "comprehension":    {"value": comprehension_pct, "label": f"{len(pulses)} pulse checks"},
            "confusion_points": {"value": confusion_count,   "label": "Confusion events"},
            "doubts_posted":    {"value": doubts_posted,     "label": "Student doubts"},
            "doubts_resolved":  {"value": doubts_resolved,   "label": "Resolved"},
            "pace":             {"value": pace_label,        "label": pace_label},
        },
        "pulse_results": [
            {
                "question":          p.question,
                "comprehension_pct": (
                    round(p.correct_count / p.total_responses * 100, 1)
                    if p.total_responses else None
                ),
            }
            for p in pulses
        ],
        "ai_narrative": ai_narrative,
        # ── back-compat keys (PostSessionView, legacy /report card) ──
        "health_score":          overall,
        "attendance_percentage": attendance_pct,
        "engagement_score":      engagement_pct,
        "comprehension_score":   comp_score,
        "pace_score":            pace_score,
        "report":                None,   # old shape no longer used
    }


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
async def breakout_create(
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

    # Close any active rooms first (only one breakout cohort at a time)
    db.query(LiveSessionBreakoutRoom).filter(
        LiveSessionBreakoutRoom.live_session_id == session_id,
        LiveSessionBreakoutRoom.ended_at.is_(None),
    ).update({"ended_at": datetime.now(timezone.utc)})

    created = []
    for idx, r in enumerate(body.rooms, start=1):
        name = str(r.get("name", f"Room {idx}"))[:100]
        # Accept either participant_ids (LiveSessionParticipant.id) or student_ids (User.id)
        pids = r.get("participant_ids") or []
        if not pids and r.get("student_ids"):
            student_ids = [int(x) for x in r.get("student_ids") if str(x).isdigit()]
            if student_ids:
                rows = db.query(LiveSessionParticipant.id).filter(
                    LiveSessionParticipant.live_session_id == session_id,
                    LiveSessionParticipant.user_id.in_(student_ids),
                ).all()
                pids = [int(row[0]) for row in rows]
        if not isinstance(pids, list):
            continue
        room = LiveSessionBreakoutRoom(
            live_session_id=session_id,
            room_name=name,
            room_number=idx,
            participant_ids=[int(x) for x in pids if isinstance(x, (int, str)) and str(x).isdigit()],
        )
        # Persist topic in ai_monitoring_log so we don't need a schema change.
        topic = r.get("topic")
        if topic:
            room.ai_monitoring_log = {"topic": str(topic)[:300]}
        db.add(room)
        db.flush()
        created.append(room)
    db.commit()

    _log_event(db, session_id, LiveEventType.breakout_started, LiveEventTrigger.teacher,
               metadata_json={"rooms": [{"id": r.id, "name": r.room_name} for r in created]})

    rooms_payload = [
        {
            "id": r.id,
            "name": r.room_name,
            "room_number": r.room_number,
            "participant_ids": r.participant_ids,
            "topic": (r.ai_monitoring_log or {}).get("topic"),
            "room_join_token": str(uuid4()),
        }
        for r in created
    ]

    # F10 — broadcast assignments so students can see they were placed in a room.
    try:
        await live_ws_manager.broadcast_to_session(session_id, {
            "type": "breakout_started",
            "rooms": rooms_payload,
        })
    except Exception:
        pass

    return {"rooms": rooms_payload}


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
async def breakout_end_all(
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

    try:
        await live_ws_manager.broadcast_to_session(session_id, {"type": "breakout_ended"})
    except Exception:
        pass

    return {"rooms_closed": len(rooms), "peer_experts_identified": peer_experts}


# Friendlier alias used by the F10 frontend
@router.post("/sessions/{session_id}/breakout/end")
async def breakout_end_alias(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    return await breakout_end_all(session_id=session_id, current_user=current_user, db=db)


@router.get("/sessions/{session_id}/breakout/status")
def breakout_status_aggregate(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """F10 — aggregated AI status of every active breakout room."""
    _require_session_owner(session_id, current_user, db)
    rooms = (
        db.query(LiveSessionBreakoutRoom)
        .filter(
            LiveSessionBreakoutRoom.live_session_id == session_id,
            LiveSessionBreakoutRoom.ended_at.is_(None),
        )
        .all()
    )

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=4)
    out: list[dict] = []

    for r in rooms:
        pids: list[int] = [int(x) for x in (r.participant_ids or []) if str(x).isdigit()]
        if not pids:
            out.append({
                "room_id":        r.id,
                "room_name":      r.room_name,
                "topic":          (r.ai_monitoring_log or {}).get("topic"),
                "students":       [],
                "total":          0,
                "active":         0,
                "engagement_pct": 0,
                "ai_label":       "empty",
                "peer_badges":    1 if r.peer_expert_detected_user_id else 0,
            })
            continue

        # Resolve participant -> user names
        parts = (
            db.query(LiveSessionParticipant)
            .filter(LiveSessionParticipant.id.in_(pids))
            .all()
        )
        user_ids = [p.user_id for p in parts if p.user_id]
        users = db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []
        umap = {u.id: u.name for u in users}
        names: list[str] = []
        for p in parts:
            if p.user_id and p.user_id in umap:
                names.append(umap[p.user_id])
            elif getattr(p, "guest_name", None):
                names.append(p.guest_name)

        # Engagement — active in the last 4 minutes
        active_count = (
            db.query(LiveStudentEngagement)
            .filter(
                LiveStudentEngagement.session_id == session_id,
                or_(
                    LiveStudentEngagement.participant_id.in_(pids),
                    LiveStudentEngagement.student_id.in_(user_ids) if user_ids else False,
                ),
                LiveStudentEngagement.last_active_at.isnot(None),
                LiveStudentEngagement.last_active_at >= cutoff,
            )
            .count()
        )
        total = len(parts)
        eng_pct = round((active_count / total) * 100) if total else 0

        if eng_pct >= 80:
            label = "productive"
        elif eng_pct >= 50:
            label = "moderate"
        elif eng_pct < 30:
            label = "stuck"
        else:
            label = "moderate"

        # Persist last AI verdict on the room itself
        log = dict(r.ai_monitoring_log or {})
        log["ai_label"]            = label
        log["engagement_pct"]      = eng_pct
        log["productivity_score"]  = eng_pct
        log["is_stuck"]            = label == "stuck"
        r.ai_monitoring_log        = log
        r.is_stuck                 = label == "stuck"
        r.productivity_score       = eng_pct

        out.append({
            "room_id":        r.id,
            "room_name":      r.room_name,
            "topic":          log.get("topic"),
            "students":       names,
            "total":          total,
            "active":         int(active_count),
            "engagement_pct": eng_pct,
            "ai_label":       label,
            "peer_badges":    1 if r.peer_expert_detected_user_id else 0,
        })

    db.commit()
    return {"session_id": session_id, "rooms": out}


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


# ═══════════════════════════════════════════════════════════════════════
# F04 — Live Pulse Check (parallel to /pulse/create; supports guests,
# WS broadcast, AI insight, auto-close).
# ═══════════════════════════════════════════════════════════════════════

class LivePulseCheckReq(BaseModel):
    question:       str = Field(..., min_length=3, max_length=500)
    option_a:       str = Field(..., min_length=1, max_length=200)
    option_b:       str = Field(..., min_length=1, max_length=200)
    option_c:       str = Field("N/A", min_length=1, max_length=200)
    option_d:       str = Field("N/A", min_length=1, max_length=200)
    correct_option: Optional[str] = Field(None, pattern=r"^[ABCD]$")
    duration_secs:  int = Field(30, ge=10, le=120)


class LivePulseResponseReq(BaseModel):
    pulse_id:       int
    chosen_option:  str = Field(..., pattern=r"^[ABCDabcd]$")
    participant_id: Optional[int] = None


def _pulse_counts(pulse_id: int, db: Session) -> dict:
    rows = db.query(LivePulseResponse).filter(
        LivePulseResponse.pulse_id == pulse_id
    ).all()
    counts = {"A": 0, "B": 0, "C": 0, "D": 0, "total": 0, "correct": 0}
    for r in rows:
        opt = (r.chosen_option or "").upper()
        if opt in counts:
            counts[opt] += 1
        counts["total"] += 1
        if r.is_correct:
            counts["correct"] += 1
    return counts


def _update_live_pulse_counts(pulse_id: int, db: Session) -> dict:
    counts = _pulse_counts(pulse_id, db)
    db.query(LivePulseCheck).filter(LivePulseCheck.id == pulse_id).update({
        "total_responses": counts["total"],
        "correct_count":   counts["correct"],
        "option_a_count":  counts["A"],
        "option_b_count":  counts["B"],
        "option_c_count":  counts["C"],
        "option_d_count":  counts["D"],
    })
    db.commit()
    return counts


async def _generate_live_pulse_insight(pulse: LivePulseCheck, counts: dict) -> str:
    if counts.get("total", 0) == 0:
        return "No responses received."
    pct = None
    if pulse.correct_option and counts["total"]:
        pct = round(counts["correct"] / counts["total"] * 100, 1)
    wrong_option = None
    if pulse.correct_option:
        others = {k: v for k, v in counts.items()
                  if k in ("A", "B", "C", "D") and k != pulse.correct_option}
        if others and max(others.values()) > 0:
            wrong_option = max(others, key=others.get)

    prompt = f"""You are a classroom AI. A teacher sent this pulse check:
Question: {pulse.question}
Options: A={pulse.option_a} | B={pulse.option_b} | C={pulse.option_c} | D={pulse.option_d}
Correct answer: {pulse.correct_option or 'not set'}
Results: {counts['total']} responses, {counts['correct']} correct ({pct if pct is not None else 'N/A'}%)
Most common wrong answer: {wrong_option or 'N/A'}

In ONE sentence (max 25 words) give the teacher a specific, actionable insight
about student understanding. Return ONLY a JSON object: {{"insight": "..."}}"""
    try:
        result = await _ai_json(prompt, system="You are a concise teaching coach. Return only valid JSON.")
        if isinstance(result, dict) and result.get("insight"):
            return str(result["insight"])[:300]
    except Exception:
        pass
    if pct is not None:
        return f"{counts['correct']}/{counts['total']} students got it right ({pct}%)."
    return f"{counts['total']} responses received."


async def _auto_close_live_pulse(pulse_id: int, delay_secs: int) -> None:
    """Background: auto-close a live pulse after duration + buffer seconds."""
    import asyncio
    try:
        await asyncio.sleep(max(1, int(delay_secs)))
    except Exception:
        return
    db = SessionLocal()
    try:
        pulse = db.query(LivePulseCheck).filter(
            LivePulseCheck.id == pulse_id,
            LivePulseCheck.is_active.is_(True),
        ).first()
        if not pulse:
            return
        pulse.is_active = False
        pulse.closed_at = datetime.now(timezone.utc)
        db.commit()
        counts = _update_live_pulse_counts(pulse_id, db)
        try:
            insight = await _generate_live_pulse_insight(pulse, counts)
            pulse.ai_insight = insight
            db.commit()
        except Exception:
            insight = None
        try:
            await live_ws_manager.broadcast_to_session(pulse.live_session_id, {
                "type":           "pulse_check_closed",
                "pulse_id":       pulse_id,
                "question":       pulse.question,
                "counts":         counts,
                "ai_insight":     insight,
                "correct_option": pulse.correct_option,
                "auto_closed":    True,
            })
        except Exception:
            pass
    except Exception as exc:
        logger.error("auto_close_live_pulse failed for pulse %s: %s", pulse_id, exc)
    finally:
        db.close()


@router.post("/sessions/{session_id}/pulse-check")
async def send_live_pulse_check(
    session_id: int,
    body: LivePulseCheckReq,
    background: BackgroundTasks,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """Teacher sends a quick MCQ pulse check to all participants."""
    sess = _require_session_owner(session_id, current_user, db)
    if sess.status != LiveSessionStatus.live:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is not live.")

    # Close any existing active pulse for this session first
    existing = db.query(LivePulseCheck).filter(
        LivePulseCheck.live_session_id == session_id,
        LivePulseCheck.is_active.is_(True),
    ).first()
    if existing:
        existing.is_active = False
        existing.closed_at = datetime.now(timezone.utc)
        db.commit()

    pulse = LivePulseCheck(
        live_session_id = session_id,
        question        = body.question.strip(),
        option_a        = body.option_a.strip(),
        option_b        = body.option_b.strip(),
        option_c        = (body.option_c or "N/A").strip(),
        option_d        = (body.option_d or "N/A").strip(),
        correct_option  = body.correct_option.upper() if body.correct_option else None,
        duration_secs   = body.duration_secs,
    )
    db.add(pulse)
    db.commit()
    db.refresh(pulse)

    payload = {
        "type":          "pulse_check_started",
        "pulse_id":      pulse.id,
        "question":      pulse.question,
        "option_a":      pulse.option_a,
        "option_b":      pulse.option_b,
        "option_c":      pulse.option_c,
        "option_d":      pulse.option_d,
        "duration_secs": pulse.duration_secs,
        "sent_at":       pulse.sent_at.isoformat() if pulse.sent_at else None,
    }
    try:
        await live_ws_manager.broadcast_to_session(session_id, payload)
    except Exception as exc:
        logger.warning("pulse-check WS broadcast failed: %s", exc)

    background.add_task(_auto_close_live_pulse, pulse.id, body.duration_secs + 5)
    logger.info("⚡ Live pulse %d sent for session %d", pulse.id, session_id)
    return {"ok": True, "pulse_id": pulse.id, "duration_secs": body.duration_secs}


@router.post("/sessions/{session_id}/pulse-response")
async def submit_live_pulse_response(
    session_id: int,
    body: LivePulseResponseReq,
    current_user: Optional[dict] = Depends(_get_optional_user),
    db: Session = Depends(get_db),
):
    """Student / guest submits an answer to the active pulse check."""
    pulse = db.query(LivePulseCheck).filter(
        LivePulseCheck.id == body.pulse_id,
        LivePulseCheck.live_session_id == session_id,
        LivePulseCheck.is_active.is_(True),
    ).first()
    if not pulse:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No active pulse check found.")

    chosen = body.chosen_option.upper()
    student_id = current_user["id"] if current_user else None
    is_correct = None
    if pulse.correct_option:
        is_correct = chosen == pulse.correct_option.upper()

    # Dedup by participant_id (guests) or student_id
    dup_q = db.query(LivePulseResponse).filter(LivePulseResponse.pulse_id == body.pulse_id)
    if body.participant_id is not None:
        dup_q = dup_q.filter(LivePulseResponse.participant_id == body.participant_id)
    elif student_id is not None:
        dup_q = dup_q.filter(LivePulseResponse.student_id == student_id)
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "participant_id or login required.")
    if dup_q.first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Already responded to this pulse.")

    guest_name = None
    if not student_id and body.participant_id:
        part = db.query(LiveSessionParticipant).filter(
            LiveSessionParticipant.id == body.participant_id,
            LiveSessionParticipant.live_session_id == session_id,
        ).first()
        if part:
            guest_name = part.guest_name

    resp = LivePulseResponse(
        pulse_id        = body.pulse_id,
        live_session_id = session_id,
        participant_id  = body.participant_id,
        student_id      = student_id,
        guest_name      = guest_name,
        chosen_option   = chosen,
        is_correct      = is_correct,
    )
    db.add(resp)
    db.commit()

    counts = _update_live_pulse_counts(body.pulse_id, db)
    try:
        await live_ws_manager.send_to_teacher(session_id, {
            "type":     "pulse_response_update",
            "pulse_id": body.pulse_id,
            "counts":   counts,
        })
    except Exception:
        pass
    return {"ok": True, "is_correct": is_correct}


@router.post("/sessions/{session_id}/pulse-check/{pulse_id}/close")
async def close_live_pulse_check(
    session_id: int,
    pulse_id:   int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """Teacher manually closes the pulse early; returns final results."""
    _require_session_owner(session_id, current_user, db)
    pulse = db.query(LivePulseCheck).filter(
        LivePulseCheck.id == pulse_id,
        LivePulseCheck.live_session_id == session_id,
    ).first()
    if not pulse:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pulse not found.")

    if pulse.is_active:
        pulse.is_active = False
        pulse.closed_at = datetime.now(timezone.utc)
        db.commit()

    counts = _update_live_pulse_counts(pulse_id, db)
    try:
        insight = await _generate_live_pulse_insight(pulse, counts)
        pulse.ai_insight = insight
        db.commit()
    except Exception:
        insight = pulse.ai_insight

    final = {
        "type":           "pulse_check_closed",
        "pulse_id":       pulse_id,
        "question":       pulse.question,
        "counts":         counts,
        "ai_insight":     insight,
        "correct_option": pulse.correct_option,
    }
    try:
        await live_ws_manager.broadcast_to_session(session_id, final)
    except Exception:
        pass
    return final


@router.get("/sessions/{session_id}/pulse-results")
def get_live_pulse_results(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All pulse-checks + counts for a session (used by post-session report)."""
    pulses = db.query(LivePulseCheck).filter(
        LivePulseCheck.live_session_id == session_id,
    ).order_by(LivePulseCheck.sent_at.asc()).all()

    out = []
    for p in pulses:
        counts = _pulse_counts(p.id, db)
        comp_pct = None
        if p.correct_option and counts["total"]:
            comp_pct = round(counts["correct"] / counts["total"] * 100, 1)
        out.append({
            "id":              p.id,
            "question":        p.question,
            "correct_option":  p.correct_option,
            "duration_secs":   p.duration_secs,
            "sent_at":         p.sent_at.isoformat() if p.sent_at else None,
            "is_active":       p.is_active,
            "counts":          counts,
            "ai_insight":      p.ai_insight,
            "comprehension_pct": comp_pct,
        })
    return {"session_id": session_id, "pulse_checks": out, "total": len(out)}


# ═══════════════════════════════════════════════════════════════════════
# F05 — Capsule status (for PostSession polling)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/sessions/{session_id}/capsule-status")
def get_capsule_status(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    return {
        "session_id": session_id,
        "capsule_id": sess.auto_capsule_id,
        "is_ready":   sess.auto_capsule_id is not None,
    }


# ═══════════════════════════════════════════════════════════════════════
# F01 — AI Session Brain: observations + scheduler
# ═══════════════════════════════════════════════════════════════════════

async def _generate_observation_payload(session_id: int, db: Session) -> Optional[dict]:
    """Gather context + ask AI for one observation. Returns dict or None."""
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        return None
    subject = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None
    subject_name = subject.name if subject else "the class"

    elapsed_mins = 0
    if sess.started_at:
        elapsed_mins = max(0, int((datetime.now(timezone.utc) - sess.started_at).total_seconds() / 60))

    total_participants = db.query(func.count(LiveSessionParticipant.id)).filter(
        LiveSessionParticipant.live_session_id == session_id,
    ).scalar() or 0
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    active_participants = db.query(func.count(LiveSessionParticipant.id)).filter(
        LiveSessionParticipant.live_session_id == session_id,
        LiveSessionParticipant.last_heartbeat.isnot(None),
        LiveSessionParticipant.last_heartbeat >= cutoff,
    ).scalar() or 0

    doubt_count = 0
    hot_doubt_count = 0
    recent_doubts: list[str] = []
    if sess.subject_id and sess.started_at:
        doubt_rows = db.query(ClassWallPost).filter(
            ClassWallPost.live_session_id == session_id,
        ).order_by(ClassWallPost.created_at.desc()).limit(20).all()
        doubt_count = len(doubt_rows)
        hot_doubt_count = sum(1 for d in doubt_rows if d.is_hot)
        recent_doubts = [d.content[:120] for d in doubt_rows[:3]]

    pulses = db.query(LivePulseCheck).filter(
        LivePulseCheck.live_session_id == session_id,
        LivePulseCheck.is_active.is_(False),
        LivePulseCheck.correct_option.isnot(None),
        LivePulseCheck.total_responses > 0,
    ).all()
    pulse_avg: Optional[float] = None
    if pulses:
        comps = [round(p.correct_count / p.total_responses * 100, 1)
                 for p in pulses if p.total_responses]
        if comps:
            pulse_avg = round(sum(comps) / len(comps), 1)

    engagement_pct = round((active_participants / total_participants) * 100, 0) if total_participants else 0
    doubts_text = "Recent doubts: " + " | ".join(recent_doubts) if recent_doubts else ""

    schema = """{
  "type": "confusion|pace|engagement|positive|topic_complete|energy",
  "message": "string (1-2 sentences in natural language)",
  "suggestion": "string (1 actionable sentence)",
  "severity": "low|medium|high"
}"""
    prompt = f"""You are an AI teaching assistant watching a live class right now.

Subject: {subject_name}
Time elapsed: {elapsed_mins} minutes
Students: {total_participants} total, {active_participants} active right now ({engagement_pct}% engagement)
Doubts posted: {doubt_count} total, {hot_doubt_count} hot
Comprehension from pulse checks: {f'{pulse_avg}%' if pulse_avg is not None else 'no pulse yet'}
{doubts_text}

Generate ONE observation for the teacher about the most important thing right now.
Use natural language like a human TA. Be specific and actionable.

Return ONLY valid JSON (no markdown):
{schema}"""

    try:
        result = await _ai_json(prompt, system="You are an empathetic AI teaching assistant. Return only valid JSON.")
    except Exception as exc:
        logger.warning("observation _ai_json failed: %s", exc)
        result = None

    if not isinstance(result, dict):
        return {
            "type": "engagement",
            "message": f"{active_participants}/{total_participants} students active ({engagement_pct}% engagement).",
            "suggestion": "Check in with quiet students or run a quick pulse check.",
            "severity": "low" if engagement_pct > 70 else "medium",
        }

    obs_type = str(result.get("type", "engagement")).lower()
    if obs_type not in ("confusion", "pace", "engagement", "positive", "topic_complete", "energy"):
        obs_type = "engagement"
    severity = str(result.get("severity", "low")).lower()
    if severity not in ("low", "medium", "high"):
        severity = "low"
    return {
        "type":       obs_type,
        "message":    str(result.get("message", ""))[:600],
        "suggestion": str(result.get("suggestion", ""))[:400],
        "severity":   severity,
    }


async def _create_observation(session_id: int, db: Session) -> Optional[LiveSessionObservation]:
    payload = await _generate_observation_payload(session_id, db)
    if not payload:
        return None
    obs = LiveSessionObservation(
        live_session_id = session_id,
        obs_type        = payload["type"],
        message         = payload["message"],
        suggestion      = payload["suggestion"],
        severity        = payload["severity"],
    )
    db.add(obs)
    db.commit()
    db.refresh(obs)

    # F09 — auto-bookmark from notable observations
    try:
        bookmark_map = {
            "confusion":      ("confusion",   f"⚠️ Confusion — {(payload.get('message') or '')[:80]}"),
            "positive":       ("clarity",     "✅ Clarity moment"),
            "topic_complete": ("topic_start", "📍 Topic completed"),
        }
        if payload.get("type") in bookmark_map:
            btype, btitle = bookmark_map[payload["type"]]
            sess_row = db.query(LiveSession).filter(LiveSession.id == session_id).first()
            elapsed_secs = 0
            elapsed_mins = 0
            if sess_row and sess_row.started_at:
                elapsed_secs = int((datetime.now(timezone.utc) - sess_row.started_at).total_seconds())
                elapsed_mins = elapsed_secs // 60
            db.add(LiveSessionBookmark(
                session_id    = session_id,
                elapsed_secs  = elapsed_secs,
                elapsed_mins  = elapsed_mins,
                bookmark_type = btype,
                title         = btitle[:200],
                added_by      = "ai",
            ))
            db.commit()
    except Exception as exc:
        db.rollback()
        logger.debug("auto-bookmark failed: %s", exc)
    try:
        await live_ws_manager.send_to_teacher(session_id, {
            "type": "ai_observation",
            "observation": {
                "id":         obs.id,
                "obs_type":   obs.obs_type,
                "type":       obs.obs_type,
                "message":    obs.message,
                "suggestion": obs.suggestion,
                "severity":   obs.severity,
                "created_at": obs.created_at.isoformat() if obs.created_at else None,
            },
        })
    except Exception:
        pass
    return obs


@router.get("/sessions/{session_id}/ai/observations")
async def list_ai_observations(
    session_id: int,
    since_id: int = Query(0, ge=0),
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    # Lazily ensure the scheduler is running for live sessions
    if sess.status == LiveSessionStatus.live:
        try:
            _ensure_observation_scheduler(session_id)
        except Exception:
            pass
    q = db.query(LiveSessionObservation).filter(
        LiveSessionObservation.live_session_id == session_id,
    )
    if since_id > 0:
        q = q.filter(LiveSessionObservation.id > since_id)
    rows = q.order_by(LiveSessionObservation.created_at.desc()).limit(20).all()
    return {
        "observations": [
            {
                "id":         o.id,
                "type":       o.obs_type,
                "obs_type":   o.obs_type,
                "message":    o.message,
                "suggestion": o.suggestion,
                "severity":   o.severity,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
            for o in rows
        ]
    }


@router.post("/sessions/{session_id}/ai/trigger-observation")
async def trigger_ai_observation(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    _require_session_owner(session_id, current_user, db)
    obs = await _create_observation(session_id, db)
    if not obs:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not generate observation.")
    return {
        "id":         obs.id,
        "type":       obs.obs_type,
        "obs_type":   obs.obs_type,
        "message":    obs.message,
        "suggestion": obs.suggestion,
        "severity":   obs.severity,
        "created_at": obs.created_at.isoformat() if obs.created_at else None,
    }


# ─── Auto observation scheduler (5-min ticks) ──────────────────────────
_observation_tasks: dict[int, "asyncio.Task"] = {}


async def _observation_scheduler(session_id: int) -> None:
    """Generates an AI observation every 5 minutes while the session is live."""
    import asyncio
    try:
        while True:
            await asyncio.sleep(300)
            db = SessionLocal()
            try:
                sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
                if not sess or sess.status != LiveSessionStatus.live:
                    return
                await _create_observation(session_id, db)
                try:
                    await _record_engagement_snapshot(session_id, db)
                except Exception as exc:
                    logger.debug("engagement snapshot failed: %s", exc)
            except Exception as exc:
                logger.warning("observation scheduler tick failed for %s: %s", session_id, exc)
            finally:
                db.close()
    except asyncio.CancelledError:
        return
    finally:
        _observation_tasks.pop(session_id, None)


def _ensure_observation_scheduler(session_id: int) -> None:
    """Start the scheduler task if not already running. Safe to call repeatedly.

    Must be called from an async/event-loop context (WS handler or async route).
    """
    import asyncio
    task = _observation_tasks.get(session_id)
    if task and not task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _observation_tasks[session_id] = loop.create_task(_observation_scheduler(session_id))


# ════════════════════════════════════════════════════════════════════════
# F13 — Pre-class warmup generation (per-student)
# ════════════════════════════════════════════════════════════════════════

async def _generate_warmup_content(
    student_name: str,
    subject_name: str,
    weak_topics: List[str],
    warmup_type: str,
) -> str:
    weak_str = ", ".join(weak_topics) if weak_topics else "general concepts"
    if warmup_type == "refresher":
        prompt = (
            f"Write a 3-4 sentence personalized warmup for {student_name} "
            f"before their {subject_name} class. They struggle with: {weak_str}. "
            "Give a quick, friendly refresher — not a lecture, just a warm reminder. "
            "Max 80 words. Encouraging tone. Plain text, no markdown."
        )
    else:
        prompt = (
            f"Write a 2-3 sentence preview message for {student_name} "
            f"before their {subject_name} class. They are doing well. "
            "Give them a brief preview of what exciting concept they'll learn today. "
            "Max 60 words. Enthusiastic tone. Plain text, no markdown."
        )
    text = (await _call_ai_text(prompt) or "").strip()
    if not text:
        text = (
            f"Hey {student_name}! Quick heads-up before {subject_name}: stay focused, "
            "ask questions when stuck, and you'll get the most out of today's class."
        )
    return text


@router.post("/sessions/{session_id}/generate-warmups")
async def generate_warmups(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """
    Teacher triggers warmup generation for all enrolled students before
    a live session starts. Creates StudentPreclassWarmup rows.
    """
    sess = _require_session_owner(session_id, current_user, db)
    subj = db.query(Subject).filter(Subject.id == sess.subject_id).first()
    if not subj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subject not found.")

    # Enrolled students for this course+semester (matches typical schema)
    students_query = db.query(User).filter(
        User.role == UserRole.student,
        User.is_active == True,                                        # noqa: E712
        User.course_id == subj.course_id,
        User.semester == subj.semester,
    )
    students = students_query.limit(50).all()                           # cap to avoid timeout

    created = 0
    for student in students:
        existing = (
            db.query(StudentPreclassWarmup)
            .filter(
                StudentPreclassWarmup.student_id == student.id,
                StudentPreclassWarmup.session_id == session_id,
            )
            .first()
        )
        if existing:
            continue

        weak_rows = (
            db.query(StudentTopicMastery)
            .filter(
                StudentTopicMastery.student_id == student.id,
                StudentTopicMastery.subject_id == sess.subject_id,
                StudentTopicMastery.mastery_pct < 60,
            )
            .order_by(StudentTopicMastery.mastery_pct.asc())
            .limit(3)
            .all()
        )
        weak_topic_names = [w.topic for w in weak_rows]
        warmup_type = "refresher" if weak_rows else "preview"

        try:
            content = await _generate_warmup_content(
                student_name=student.name or "Student",
                subject_name=subj.name,
                weak_topics=weak_topic_names,
                warmup_type=warmup_type,
            )
        except Exception as exc:
            logger.warning("warmup gen failed for student %s: %s", student.id, exc)
            content = f"Welcome to {subj.name}! Stay engaged today."

        db.add(StudentPreclassWarmup(
            student_id=student.id,
            session_id=session_id,
            subject_id=sess.subject_id,
            warmup_type=warmup_type,
            content=content,
            focus_topics=weak_topic_names,
            is_sent=True,
        ))
        created += 1

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Could not save warmups: {exc}")

    return {"ok": True, "warmups_created": created, "total_students": len(students)}


@router.get("/sessions/{session_id}/my-warmup")
def get_my_warmup(
    session_id: int,
    current_user: Optional[dict] = Depends(_get_optional_user),
    db: Session = Depends(get_db),
):
    """Student fetches their personalised warmup for this session."""
    if not current_user or not current_user.get("id"):
        return {"warmup": None}

    warmup = (
        db.query(StudentPreclassWarmup)
        .filter(
            StudentPreclassWarmup.session_id == session_id,
            StudentPreclassWarmup.student_id == current_user["id"],
        )
        .first()
    )
    if not warmup:
        return {"warmup": None}
    return {
        "warmup": {
            "type":         warmup.warmup_type,
            "content":      warmup.content,
            "focus_topics": warmup.focus_topics or [],
        }
    }


# ════════════════════════════════════════════════════════════════════════
# F14 — AI Whiteboard: Code → Diagram
# ════════════════════════════════════════════════════════════════════════

class WhiteboardCodeReq(BaseModel):
    code:         str = Field(..., min_length=10, max_length=2000)
    language:     str = Field("python", max_length=20)
    diagram_type: str = Field("auto", max_length=20)


@router.post("/sessions/{session_id}/ai/diagram-from-code")
async def diagram_from_code(
    session_id: int,
    body: WhiteboardCodeReq,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """Teacher submits code → AI generates Mermaid diagram → broadcast to all."""
    _require_session_owner(session_id, current_user, db)

    diagram = await generate_diagram_from_code(
        code_snippet=body.code,
        language=body.language,
        diagram_type=body.diagram_type,
    )

    try:
        await live_ws_manager.broadcast_to_session(session_id, {
            "type":         "whiteboard_shared",
            "diagram":      diagram,
            "diagram_code": diagram,                    # back-compat key
            "source":       "code",
            "title":        f"Code → Diagram ({body.language})",
        })
    except Exception as exc:
        logger.warning("diagram broadcast failed: %s", exc)

    return {"ok": True, "diagram": diagram}


# ════════════════════════════════════════════════════════════════════════
# F11 — Low-bandwidth live text summary
# ════════════════════════════════════════════════════════════════════════

@router.get("/sessions/{session_id}/live-text-summary")
async def live_text_summary(
    session_id: int,
    current_user: Optional[dict] = Depends(_get_optional_user),
    db: Session = Depends(get_db),
):
    """Low-bandwidth students poll this to follow class via text only."""
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    recent_obs = (
        db.query(LiveSessionObservation)
        .filter(LiveSessionObservation.live_session_id == session_id)
        .order_by(LiveSessionObservation.created_at.desc())
        .limit(3)
        .all()
    )

    doubt_texts: List[str] = []
    if sess.started_at and sess.subject_id:
        recent_doubts = (
            db.query(ClassWallPost)
            .filter(
                ClassWallPost.subject_id == sess.subject_id,
                ClassWallPost.created_at >= sess.started_at,
            )
            .order_by(ClassWallPost.created_at.desc())
            .limit(3)
            .all()
        )
        doubt_texts = [(d.content or "")[:100] for d in recent_doubts]

    subj = db.query(Subject).filter(Subject.id == sess.subject_id).first() if sess.subject_id else None
    subject_name = subj.name if subj else "Class"

    obs_texts = [o.message for o in recent_obs if o.message]

    prompt = f"""A student is following {subject_name} class via text only (low bandwidth).

Recent AI observations from class: {' | '.join(obs_texts) or 'Session in progress'}
Recent student doubts: {' | '.join(doubt_texts) or 'None'}

Write a 2-3 sentence text update for this student so they can follow along.
Tell them what's being discussed RIGHT NOW. Be specific and educational.
Max 60 words. Plain text, no markdown."""

    try:
        summary = (await _call_ai_text(prompt) or "").strip()
    except Exception as exc:
        logger.warning("live-text-summary AI failed: %s", exc)
        summary = ""
    if not summary:
        summary = (
            f"{subject_name} class in progress. "
            f"{(obs_texts[0] if obs_texts else 'Teacher is currently presenting.')}"
        )

    elapsed_mins = 0
    if sess.started_at:
        elapsed_mins = max(0, int((datetime.now(tz=timezone.utc) - sess.started_at).total_seconds() / 60))

    return {
        "subject":      subject_name,
        "elapsed_mins": elapsed_mins,
        "summary":      summary,
        "updated_at":   datetime.now(tz=timezone.utc).isoformat(),
    }


# ════════════════════════════════════════════════════════════════════════
# F06 — Topic mastery refresh after a session (manual trigger / debug)
# ════════════════════════════════════════════════════════════════════════

@router.post("/sessions/{session_id}/refresh-topic-mastery")
async def refresh_topic_mastery(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    """Teacher can manually re-run mastery update (also runs auto post-session)."""
    _require_session_owner(session_id, current_user, db)
    touched = await update_student_topic_mastery(session_id, db)
    return {"ok": True, "rows_updated": touched}


# ════════════════════════════════════════════════════════════════════════
# PS7-C — Student/guest patches their Agora UID after joining channel
# ════════════════════════════════════════════════════════════════════════

class UpdateParticipantUidRequest(BaseModel):
    participant_id: Optional[int] = None
    agora_uid:      int


@router.patch("/sessions/{session_id}/participant-uid")
def update_participant_uid(
    session_id: int,
    body: UpdateParticipantUidRequest,
    current_user: Optional[dict] = Depends(_get_optional_user),
    db: Session = Depends(get_db),
):
    """Student/guest updates their agora_uid after joining the Agora channel.

    Defensive endpoint — the join endpoint already pre-stores the masked uid,
    but if the SDK assigns a different one (rare reconnect / numeric overflow)
    this lets the client correct the record so name resolution still works.
    """
    q = db.query(LiveSessionParticipant).filter(
        LiveSessionParticipant.live_session_id == session_id,
    )
    if body.participant_id:
        q = q.filter(LiveSessionParticipant.id == body.participant_id)
    elif current_user:
        q = q.filter(LiveSessionParticipant.user_id == current_user["id"])
    else:
        return {"ok": False, "reason": "cannot identify participant"}

    participant = q.order_by(LiveSessionParticipant.id.desc()).first()
    if not participant:
        return {"ok": False, "reason": "participant not found"}

    participant.agora_uid = int(body.agora_uid)
    db.commit()
    return {"ok": True, "agora_uid": int(body.agora_uid)}


# ════════════════════════════════════════════════════════════════════════
# F02 — Engagement snapshot helper (called by observation scheduler)
# ════════════════════════════════════════════════════════════════════════

async def _record_engagement_snapshot(session_id: int, db: Session) -> None:
    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess or not sess.started_at:
        return

    now = datetime.now(timezone.utc)
    elapsed_mins = int((now - sess.started_at).total_seconds() / 60)
    cutoff_active = now - timedelta(minutes=4)

    total = (
        db.query(LiveSessionParticipant)
        .filter(
            LiveSessionParticipant.live_session_id == session_id,
            LiveSessionParticipant.participant_type == LiveParticipantType.student,
        )
        .count()
    )
    active = (
        db.query(LiveStudentEngagement)
        .filter(
            LiveStudentEngagement.session_id == session_id,
            LiveStudentEngagement.last_active_at >= cutoff_active,
        )
        .count()
    )

    eng_pct = round((active / total) * 100.0, 1) if total else 0.0
    if eng_pct >= 80:
        label = "HIGH ENGAGEMENT"
    elif eng_pct >= 60:
        label = "MODERATE"
    elif eng_pct >= 40:
        label = "LOW ENGAGEMENT"
    else:
        label = "VERY LOW — check on students"

    db.add(LiveEngagementSnapshot(
        session_id      = session_id,
        elapsed_mins    = elapsed_mins,
        total_students  = total,
        active_students = active,
        engagement_pct  = eng_pct,
        event_label     = label,
    ))
    db.commit()


# ════════════════════════════════════════════════════════════════════════
# F02 — Engagement timeline + per-student attention
# ════════════════════════════════════════════════════════════════════════

@router.get("/sessions/{session_id}/engagement-timeline")
def get_engagement_timeline(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_session_owner(session_id, current_user, db)
    snapshots = (
        db.query(LiveEngagementSnapshot)
        .filter(LiveEngagementSnapshot.session_id == session_id)
        .order_by(LiveEngagementSnapshot.elapsed_mins)
        .all()
    )
    return {
        "session_id": session_id,
        "timeline": [
            {
                "elapsed_mins":   s.elapsed_mins,
                "engagement_pct": s.engagement_pct,
                "active":         s.active_students,
                "total":          s.total_students,
                "event_label":    s.event_label,
                "recorded_at":    s.recorded_at.isoformat() if s.recorded_at else None,
            }
            for s in snapshots
        ],
    }


@router.get("/sessions/{session_id}/student-attention")
def get_student_attention(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_session_owner(session_id, current_user, db)

    engagements = (
        db.query(LiveStudentEngagement)
        .filter(LiveStudentEngagement.session_id == session_id)
        .all()
    )

    student_ids = [e.student_id for e in engagements if e.student_id]
    students_map: dict[int, User] = {}
    if student_ids:
        for u in db.query(User).filter(User.id.in_(student_ids)).all():
            students_map[u.id] = u

    # Resolve guest names from participant records
    part_ids = [e.participant_id for e in engagements if e.participant_id]
    parts_map: dict[int, LiveSessionParticipant] = {}
    if part_ids:
        for p in db.query(LiveSessionParticipant).filter(LiveSessionParticipant.id.in_(part_ids)).all():
            parts_map[p.id] = p

    now = datetime.now(timezone.utc)
    out: list[dict] = []
    for eng in engagements:
        name = "Unknown"
        if eng.student_id and eng.student_id in students_map:
            name = students_map[eng.student_id].name or name
        elif eng.participant_id and eng.participant_id in parts_map:
            name = parts_map[eng.participant_id].guest_name or name

        if eng.last_active_at:
            mins_since_active = (now - eng.last_active_at).total_seconds() / 60.0
        else:
            mins_since_active = 999.0

        if mins_since_active < 3:
            label, color = "highly_engaged", "green"
        elif mins_since_active < 8:
            label, color = "moderate", "yellow"
        elif mins_since_active < 15:
            label, color = "silent", "orange"
        else:
            label, color = "dropped_off", "red"

        eng.engagement_label = label

        signal = None
        if label == "silent" and (eng.heartbeat_count or 0) > 3:
            signal = f"{name} went quiet — may have lost focus or connection"
        elif label == "dropped_off":
            signal = f"{name} appears to have dropped off ({int(mins_since_active)} min inactive)"
        elif label == "highly_engaged" and (eng.response_count or 0) > 0:
            signal = f"{name} actively responding — {eng.response_count} pulse answers"
        elif label == "highly_engaged" and (eng.doubt_count or 0) > 0:
            signal = f"{name} posted {eng.doubt_count} doubt(s) — engaged and asking questions"

        out.append({
            "student_id":        eng.student_id,
            "participant_id":    eng.participant_id,
            "name":              name,
            "label":             label,
            "color":             color,
            "signal":            signal,
            "heartbeats":        eng.heartbeat_count or 0,
            "responses":         eng.response_count or 0,
            "doubts":            eng.doubt_count or 0,
            "mins_since_active": round(mins_since_active, 1),
        })

    db.commit()

    priority = {"dropped_off": 0, "silent": 1, "moderate": 2, "highly_engaged": 3}
    out.sort(key=lambda x: priority.get(x["label"], 4))

    return {"session_id": session_id, "students": out}


# ════════════════════════════════════════════════════════════════════════
# F03 — AI raises hand: check / dismiss intervention
# ════════════════════════════════════════════════════════════════════════

class DismissInterventionRequest(BaseModel):
    intervention_id: Optional[int] = None
    action:          Optional[str] = None


@router.post("/sessions/{session_id}/ai/check-intervention")
async def check_ai_intervention(
    session_id: int,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    now = datetime.now(timezone.utc)

    elapsed_mins = 0
    if sess.started_at:
        elapsed_mins = int((now - sess.started_at).total_seconds() / 60)

    cutoff_active = now - timedelta(minutes=4)

    total_students = (
        db.query(LiveStudentEngagement)
        .filter(LiveStudentEngagement.session_id == session_id)
        .count()
    )
    silent_count = 0
    if total_students:
        silent_count = (
            db.query(LiveStudentEngagement)
            .filter(
                LiveStudentEngagement.session_id == session_id,
                or_(
                    LiveStudentEngagement.last_active_at < cutoff_active,
                    LiveStudentEngagement.last_active_at.is_(None),
                ),
            )
            .count()
        )

    last_pulse = (
        db.query(LivePulseCheck)
        .filter(LivePulseCheck.live_session_id == session_id)
        .order_by(LivePulseCheck.sent_at.desc())
        .first()
    )
    mins_since_pulse = 999
    if last_pulse and last_pulse.sent_at:
        mins_since_pulse = int((now - last_pulse.sent_at).total_seconds() / 60)

    pulses = (
        db.query(LivePulseCheck)
        .filter(
            LivePulseCheck.live_session_id == session_id,
            LivePulseCheck.is_active.is_(False),
            LivePulseCheck.correct_option.isnot(None),
            LivePulseCheck.total_responses > 0,
        )
        .all()
    )
    pulse_comp_avg = None
    if pulses:
        comps = [
            (p.correct_count or 0) / p.total_responses * 100.0
            for p in pulses if p.total_responses
        ]
        if comps:
            pulse_comp_avg = round(sum(comps) / len(comps), 1)

    hot_doubts = 0
    if sess.subject_id and sess.started_at:
        hot_doubts = (
            db.query(ClassWallPost)
            .filter(
                ClassWallPost.subject_id == sess.subject_id,
                ClassWallPost.is_hot.is_(True),
                ClassWallPost.created_at >= sess.started_at,
                ClassWallPost.status != WallPostStatus.answered,
            )
            .count()
        )

    last_int = (
        db.query(LiveAIIntervention)
        .filter(LiveAIIntervention.session_id == session_id)
        .order_by(LiveAIIntervention.created_at.desc())
        .first()
    )
    last_int_mins = 0
    if last_int and last_int.elapsed_mins is not None:
        last_int_mins = int(last_int.elapsed_mins)

    session_data = {
        "elapsed_mins":           elapsed_mins,
        "engagement_pct":         round(((total_students - silent_count) / total_students * 100.0), 1) if total_students else 100.0,
        "silent_count":           silent_count,
        "total_students":         total_students,
        "hot_doubts":             hot_doubts,
        "pulse_comp_avg":         pulse_comp_avg,
        "mins_since_pulse":       mins_since_pulse,
        "last_intervention_mins": last_int_mins,
    }

    intervention = await generate_ai_intervention(session_id, db, session_data)
    if not intervention:
        return {"intervention": None}

    row = LiveAIIntervention(
        session_id   = session_id,
        int_type     = intervention["type"],
        message      = intervention["message"],
        suggestion   = intervention["suggestion"],
        severity     = intervention.get("severity", "medium"),
        elapsed_mins = elapsed_mins,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    payload = dict(intervention)
    payload["id"] = row.id

    try:
        await live_ws_manager.send_to_teacher(session_id, {
            "type":         "ai_intervention",
            "intervention": payload,
        })
    except Exception:
        pass

    return {"intervention": payload}


@router.post("/sessions/{session_id}/ai/dismiss-intervention")
def dismiss_intervention(
    session_id: int,
    body: DismissInterventionRequest,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    _require_session_owner(session_id, current_user, db)
    if body.intervention_id:
        row = (
            db.query(LiveAIIntervention)
            .filter(
                LiveAIIntervention.id == body.intervention_id,
                LiveAIIntervention.session_id == session_id,
            )
            .first()
        )
        if row:
            row.action_taken = (body.action or "dismissed")[:80]
            db.commit()
    return {"ok": True}


# ════════════════════════════════════════════════════════════════════════
# F09 — Smart recording bookmarks + chapters
# ════════════════════════════════════════════════════════════════════════

class AddBookmarkRequest(BaseModel):
    bookmark_type: str = Field(..., pattern=r"^(topic_start|confusion|clarity|live_demo|qa_start|break|other)$")
    title:         str = Field(..., min_length=2, max_length=200)
    description:   Optional[str] = None


class SaveRecordingUrlRequest(BaseModel):
    url: str = Field(..., min_length=4, max_length=500)


_BOOKMARK_ICONS = {
    "topic_start": "📍",
    "confusion":   "⚠️",
    "clarity":     "✅",
    "live_demo":   "💻",
    "qa_start":    "❓",
    "break":       "☕",
    "other":       "📌",
}


@router.post("/sessions/{session_id}/bookmarks")
async def add_bookmark(
    session_id: int,
    body: AddBookmarkRequest,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)

    elapsed_secs = 0
    elapsed_mins = 0
    if sess.started_at:
        elapsed_secs = int((datetime.now(timezone.utc) - sess.started_at).total_seconds())
        elapsed_mins = elapsed_secs // 60

    bm = LiveSessionBookmark(
        session_id    = session_id,
        elapsed_secs  = elapsed_secs,
        elapsed_mins  = elapsed_mins,
        bookmark_type = body.bookmark_type,
        title         = body.title.strip()[:200],
        description   = (body.description or "").strip() or None,
        added_by      = "teacher",
    )
    db.add(bm)
    db.commit()
    db.refresh(bm)

    try:
        await live_ws_manager.broadcast_to_session(session_id, {
            "type": "bookmark_added",
            "bookmark": {
                "id":            bm.id,
                "elapsed_mins":  elapsed_mins,
                "bookmark_type": bm.bookmark_type,
                "title":         bm.title,
            },
        })
    except Exception:
        pass

    return {"ok": True, "bookmark_id": bm.id, "elapsed_mins": elapsed_mins}


@router.get("/sessions/{session_id}/bookmarks")
def get_bookmarks(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Both teacher (any role) and any authenticated viewer of the report can see
    bookmarks = (
        db.query(LiveSessionBookmark)
        .filter(LiveSessionBookmark.session_id == session_id)
        .order_by(LiveSessionBookmark.elapsed_secs)
        .all()
    )
    return {
        "session_id": session_id,
        "bookmarks": [
            {
                "id":            b.id,
                "elapsed_mins":  b.elapsed_mins,
                "elapsed_secs":  b.elapsed_secs,
                "type":          b.bookmark_type,
                "icon":          _BOOKMARK_ICONS.get(b.bookmark_type or "", "📌"),
                "title":         b.title,
                "description":   b.description,
                "added_by":      b.added_by,
                "recording_url": b.recording_url,
            }
            for b in bookmarks
        ],
    }


@router.post("/sessions/{session_id}/recording-url")
def save_recording_url(
    session_id: int,
    body: SaveRecordingUrlRequest,
    current_user: dict = Depends(teacher_or_above),
    db: Session = Depends(get_db),
):
    sess = _require_session_owner(session_id, current_user, db)
    url = body.url.strip()
    if not url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "URL required")

    sess.recording_url = url[:500]
    db.query(LiveSessionBookmark).filter(
        LiveSessionBookmark.session_id == session_id,
    ).update({"recording_url": url[:500]})
    db.commit()
    return {"ok": True, "recording_url": url}
