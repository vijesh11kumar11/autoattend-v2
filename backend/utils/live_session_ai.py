"""
AutoAttend AI v2.0 — ClassPulse Live AI Utilities

Gemini 2.0 Flash (primary) → Groq Llama 3.3 70B (fallback)
                          → DeepSeek V3                (second fallback)

Public functions:
  1. generate_ai_observation
  2. generate_intervention_suggestion
  3. generate_pulse_check_question
  4. generate_session_health_report
  5. generate_pre_class_brief
  6. generate_auto_capsule_from_session
  7. generate_low_bandwidth_summary
  8. update_student_knowledge_graph
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from config import settings

logger = logging.getLogger(__name__)

AI_TIMEOUT_SEC = 30
TRANSCRIPT_CHAR_LIMIT = 6000


# ═══════════════════════════════════════════════════════════════════════
# Provider calls (Gemini → Groq → DeepSeek)
# ═══════════════════════════════════════════════════════════════════════

def _call_gemini_sync(prompt: str, system: Optional[str] = None) -> Optional[str]:
    api_key = settings.GEMINI_API_KEY
    if not api_key:
        return None
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        contents = prompt if not system else f"{system}\n\n{prompt}"
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=contents,
            config=genai.types.GenerateContentConfig(
                temperature=0.5,
                max_output_tokens=2048,
            ),
        )
        return (response.text or "").strip()
    except Exception as exc:
        logger.warning("🟡 LiveAI Gemini call failed: %s", exc)
        return None


def _call_groq_sync(prompt: str, system: str = "You are an expert teaching assistant. Return only valid JSON.") -> Optional[str]:
    api_key = settings.GROQ_API_KEY
    if not api_key:
        return None
    try:
        from groq import Groq
        client = Groq(api_key=api_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.5,
            max_tokens=2048,
            timeout=AI_TIMEOUT_SEC,
        )
        return (response.choices[0].message.content or "").strip()
    except Exception as exc:
        logger.warning("🟡 LiveAI Groq call failed: %s", exc)
        return None


def _call_deepseek_sync(prompt: str, system: str = "You are an expert teaching assistant. Return only valid JSON.") -> Optional[str]:
    api_key = settings.DEEPSEEK_API_KEY
    if not api_key:
        return None
    try:
        import httpx
        url = f"{settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": prompt},
            ],
            "temperature": 0.5,
            "max_tokens": 2048,
            "stream": False,
        }
        with httpx.Client(timeout=AI_TIMEOUT_SEC) as client:
            r = client.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
        return (data["choices"][0]["message"]["content"] or "").strip()
    except Exception as exc:
        logger.warning("🟡 LiveAI DeepSeek call failed: %s", exc)
        return None


def _parse_json(text: str) -> Optional[dict | list]:
    if not text:
        return None
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        for pattern in (r"\[.*\]", r"\{.*\}"):
            m = re.search(pattern, text, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group())
                except json.JSONDecodeError:
                    continue
        return None


async def _ai_json(prompt: str, system: Optional[str] = None) -> Optional[dict | list]:
    """Try Gemini → Groq → DeepSeek. Returns parsed JSON or None."""
    raw = await asyncio.to_thread(_call_gemini_sync, prompt, system)
    parsed = _parse_json(raw) if raw else None
    if parsed is not None:
        logger.info("✅ LiveAI: Gemini OK")
        return parsed

    logger.info("⚡ LiveAI: Gemini failed → Groq")
    raw = await asyncio.to_thread(
        _call_groq_sync, prompt,
        system or "You are an expert teaching assistant. Return only valid JSON.",
    )
    parsed = _parse_json(raw) if raw else None
    if parsed is not None:
        logger.info("✅ LiveAI: Groq OK")
        return parsed

    logger.info("⚡ LiveAI: Groq failed → DeepSeek")
    raw = await asyncio.to_thread(
        _call_deepseek_sync, prompt,
        system or "You are an expert teaching assistant. Return only valid JSON.",
    )
    parsed = _parse_json(raw) if raw else None
    if parsed is not None:
        logger.info("✅ LiveAI: DeepSeek OK")
    else:
        logger.warning("❌ LiveAI: all 3 providers failed")
    return parsed


async def _call_ai_text(prompt: str, system: Optional[str] = None) -> str:
    """
    Plain-text variant of _ai_json. Returns the raw text from the first
    provider that responds (Gemini → Groq → DeepSeek). Falls back to an
    empty string when all providers fail. Used for narrative blurbs,
    Mermaid diagrams, warmups, etc.
    """
    sys_txt = system or "You are an expert, concise teaching assistant. Plain text only — no markdown."
    raw = await asyncio.to_thread(_call_gemini_sync, prompt, sys_txt)
    if raw:
        return raw
    raw = await asyncio.to_thread(_call_groq_sync, prompt, sys_txt)
    if raw:
        return raw
    raw = await asyncio.to_thread(_call_deepseek_sync, prompt, sys_txt)
    return raw or ""


# ═══════════════════════════════════════════════════════════════════════
# 1. AI Observation (every ~2 min during a live session)
# ═══════════════════════════════════════════════════════════════════════

async def generate_ai_observation(transcript_chunk: str, context: dict) -> dict:
    """
    Returns:
      {observation: str|None, type: 'confusion'|'engagement'|'positive'|'pace',
       affected_students: [int], confidence: float}
    """
    text = (transcript_chunk or "").strip()[:TRANSCRIPT_CHAR_LIMIT]
    subject = str(context.get("subject", "")).strip() or "the subject"
    topic   = str(context.get("topic_being_taught", "")).strip() or "the current topic"
    responses = context.get("student_responses") or []
    time_in_session = context.get("time_in_session", "")
    prev_obs = context.get("previous_observations") or []

    schema = """{
  "observation": "string (max 2 sentences) or null if nothing notable",
  "type": "confusion | engagement | positive | pace",
  "affected_students": [integer student ids],
  "confidence": 0.0
}"""

    prompt = f"""You are an AI teaching assistant silently monitoring a live class.
Subject: {subject}
Current topic: {topic}
Time in session: {time_in_session}
Recent student responses: {json.dumps(responses)[:1500]}
Previous observations (avoid repeating): {json.dumps(prev_obs)[:1500]}

Based on the transcript chunk and context, generate ONE natural-language
observation (max 2 sentences) about student comprehension or engagement.
Do NOT use scores or percentages. Write as if you are a TA whispering to
the teacher.

If nothing notable, return observation: null.

Examples of good output:
- "Ravi went quiet after the recursion explanation — he may not have followed."
- "The class seems engaged — multiple students are responding correctly."
- "Three students haven't responded in the last 8 minutes."

Return ONLY valid JSON (no markdown fences):
{schema}

=== TRANSCRIPT CHUNK ===
{text}
=== END ==="""

    result = await _ai_json(prompt, system="You are an empathetic AI TA. Return only valid JSON.")
    if not isinstance(result, dict):
        return {"observation": None, "type": "engagement", "affected_students": [], "confidence": 0.0}

    obs = result.get("observation")
    obs_text = str(obs).strip() if obs else None
    if obs_text in ("", "null", "None"):
        obs_text = None

    obs_type = str(result.get("type", "engagement")).lower()
    if obs_type not in ("confusion", "engagement", "positive", "pace"):
        obs_type = "engagement"

    affected = result.get("affected_students") or []
    affected_ids = []
    if isinstance(affected, list):
        for x in affected:
            try:
                affected_ids.append(int(x))
            except (TypeError, ValueError):
                continue

    try:
        conf = float(result.get("confidence", 0.5))
    except (TypeError, ValueError):
        conf = 0.5
    conf = max(0.0, min(1.0, conf))

    return {
        "observation": obs_text,
        "type": obs_type,
        "affected_students": affected_ids,
        "confidence": round(conf, 2),
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. Intervention suggestion
# ═══════════════════════════════════════════════════════════════════════

async def generate_intervention_suggestion(observation: str, session_context: dict) -> dict:
    """
    Returns:
      {suggestion: str, action_type: 'send_recap'|'pulse_check'|'slow_down'|'break'|'peer_help',
       urgency: 'low'|'medium'|'high'}
    """
    obs = (observation or "").strip()
    if not obs:
        return {"suggestion": "", "action_type": "pulse_check", "urgency": "low"}

    schema = """{
  "suggestion": "string (1 sentence, framed as yes/no question)",
  "action_type": "send_recap | pulse_check | slow_down | break | peer_help",
  "urgency": "low | medium | high"
}"""

    prompt = f"""You are an AI teaching coach. Given this observation about a live class,
generate a brief, actionable suggestion for the teacher. Maximum 1 sentence,
framed as a yes/no question the teacher can quickly answer.

Examples:
- "Should I send a quick recap to the 3 students who went quiet?"
- "Want to run a quick pulse check before moving on?"
- "Should we take a 2-minute break?"

Session context: {json.dumps(session_context)[:1500]}

=== OBSERVATION ===
{obs}
=== END ===

Return ONLY valid JSON (no markdown fences):
{schema}"""

    result = await _ai_json(prompt, system="You are a concise teaching coach. Return only valid JSON.")
    if not isinstance(result, dict):
        return {"suggestion": "", "action_type": "pulse_check", "urgency": "low"}

    suggestion = str(result.get("suggestion", "")).strip()[:300]
    action = str(result.get("action_type", "pulse_check")).lower()
    if action not in ("send_recap", "pulse_check", "slow_down", "break", "peer_help"):
        action = "pulse_check"
    urgency = str(result.get("urgency", "low")).lower()
    if urgency not in ("low", "medium", "high"):
        urgency = "low"

    return {"suggestion": suggestion, "action_type": action, "urgency": urgency}


# ═══════════════════════════════════════════════════════════════════════
# 3. Pulse-check MCQ generator
# ═══════════════════════════════════════════════════════════════════════

async def generate_pulse_check_question(topic: str, difficulty: str, recent_transcript: str) -> dict:
    """
    Returns:
      {question, option_a, option_b, option_c, option_d, correct_answer (A-D), explanation}
    Empty fields on failure.
    """
    diff = difficulty if difficulty in ("beginner", "intermediate", "advanced") else "intermediate"
    snippet = (recent_transcript or "").strip()[:TRANSCRIPT_CHAR_LIMIT]
    topic_str = (topic or "the current topic").strip()

    empty = {
        "question": "", "option_a": "", "option_b": "", "option_c": "",
        "option_d": "", "correct_answer": "A", "explanation": "",
    }

    schema = """{
  "question": "string",
  "option_a": "string",
  "option_b": "string",
  "option_c": "string",
  "option_d": "string",
  "correct_answer": "A | B | C | D",
  "explanation": "string (1-2 sentences)"
}"""

    prompt = f"""You are an instructor designing a quick comprehension check (pulse check)
for a live class. Topic: "{topic_str}". Difficulty: {diff}.

Generate EXACTLY ONE multiple-choice question grounded in what was just
explained (last 5 minutes of transcript below). Four options labelled A-D
with exactly one correct answer.

Return ONLY valid JSON (no markdown fences):
{schema}

=== RECENT TRANSCRIPT (last 5 minutes) ===
{snippet}
=== END ==="""

    result = await _ai_json(prompt, system="You are an expert MCQ author. Return only valid JSON.")
    if not isinstance(result, dict):
        return empty

    out = dict(empty)
    out["question"]    = str(result.get("question", "")).strip()[:500]
    out["option_a"]    = str(result.get("option_a", "")).strip()[:300]
    out["option_b"]    = str(result.get("option_b", "")).strip()[:300]
    out["option_c"]    = str(result.get("option_c", "")).strip()[:300]
    out["option_d"]    = str(result.get("option_d", "")).strip()[:300]
    ans = str(result.get("correct_answer", "A")).strip().upper()
    if ans not in ("A", "B", "C", "D"):
        ans = "A"
    out["correct_answer"] = ans
    out["explanation"] = str(result.get("explanation", "")).strip()[:500]

    if not all([out["question"], out["option_a"], out["option_b"], out["option_c"], out["option_d"]]):
        return empty
    return out


# ═══════════════════════════════════════════════════════════════════════
# 4. Session health report (post-session)
# ═══════════════════════════════════════════════════════════════════════

_DEFAULT_HEALTH = {
    "health_score": 0,
    "attendance_score": 0,
    "engagement_score": 0,
    "comprehension_score": 0,
    "pace_score": 0,
    "summary": "",
    "key_observations": [],
    "confusion_moments": [],
    "positive_moments": [],
    "next_class_suggestions": [],
    "students_needing_attention": [],
}


def _clamp_score(value, default=0) -> int:
    try:
        v = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, min(100, v))


async def generate_session_health_report(session_data: dict) -> dict:
    """
    Returns full health report dict (see _DEFAULT_HEALTH for schema).
    """
    schema = """{
  "health_score": integer 0-100,
  "attendance_score": integer 0-100,
  "engagement_score": integer 0-100,
  "comprehension_score": integer 0-100,
  "pace_score": integer 0-100,
  "summary": "string (2-3 sentences)",
  "key_observations": ["string", ...],
  "confusion_moments": [{"timestamp": "string", "topic": "string", "students_affected": integer}],
  "positive_moments": [{"timestamp": "string", "description": "string"}],
  "next_class_suggestions": ["string", ...],
  "students_needing_attention": ["student name", ...]
}"""

    payload = json.dumps(session_data, default=str)[:8000]

    prompt = f"""You are an academic analyst reviewing a completed live class session.
Produce a comprehensive session health report based on the data below.

Scoring rubric (0-100):
- attendance_score:    based on % of expected students who attended ≥ minimum minutes
- engagement_score:    based on responses, pulse-check participation, doubts asked
- comprehension_score: based on pulse-check accuracy and confusion events
- pace_score:          based on AI pace alerts and topic transitions
- health_score:        overall weighted average

Provide 3-5 key_observations, list confusion_moments and positive_moments
with timestamps if available, 3 actionable next_class_suggestions, and
the names of students_needing_attention.

Return ONLY valid JSON (no markdown fences):
{schema}

=== SESSION DATA ===
{payload}
=== END ==="""

    result = await _ai_json(prompt, system="You are an academic analytics expert. Return only valid JSON.")
    if not isinstance(result, dict):
        return dict(_DEFAULT_HEALTH)

    out = dict(_DEFAULT_HEALTH)
    for k in ("health_score", "attendance_score", "engagement_score", "comprehension_score", "pace_score"):
        out[k] = _clamp_score(result.get(k, 0))
    out["summary"] = str(result.get("summary", ""))[:1500]
    for list_key in ("key_observations", "next_class_suggestions", "students_needing_attention"):
        v = result.get(list_key) or []
        out[list_key] = [str(x)[:300] for x in v[:10]] if isinstance(v, list) else []
    cm = result.get("confusion_moments") or []
    out["confusion_moments"] = [m for m in cm if isinstance(m, dict)][:20] if isinstance(cm, list) else []
    pm = result.get("positive_moments") or []
    out["positive_moments"] = [m for m in pm if isinstance(m, dict)][:20] if isinstance(pm, list) else []
    return out


# ═══════════════════════════════════════════════════════════════════════
# 5. Pre-class brief
# ═══════════════════════════════════════════════════════════════════════

async def generate_pre_class_brief(
    teacher_id: int,
    subject_id: int,
    upcoming_session_context: dict,
    db: Session,
) -> dict:
    """
    Returns:
      {readiness_score, students_needing_attention[], topic_to_revisit,
       warmup_suggestion, predicted_difficult_concepts[], brief_summary}
    """
    # Local imports (avoid circular)
    from database import (
        StudentKnowledgeGraph, KnowledgeLevel,
        LiveSession, CapsuleInteraction, Capsule, User,
    )

    weak_topics_q = (
        db.query(StudentKnowledgeGraph)
        .filter(
            StudentKnowledgeGraph.subject_id == subject_id,
            StudentKnowledgeGraph.understanding_level.in_([KnowledgeLevel.weak, KnowledgeLevel.moderate]),
        )
        .order_by(StudentKnowledgeGraph.confidence_score.asc())
        .limit(50)
        .all()
    )
    weak_topics_summary: list[dict] = []
    for r in weak_topics_q:
        student_name = r.student.name if r.student else f"Student {r.student_id}"
        weak_topics_summary.append({
            "student": student_name,
            "topic": r.topic_name,
            "level": r.understanding_level.value if hasattr(r.understanding_level, "value") else str(r.understanding_level),
            "confidence": round(r.confidence_score, 2),
        })

    last_session = (
        db.query(LiveSession)
        .filter(
            LiveSession.teacher_id == teacher_id,
            LiveSession.subject_id == subject_id,
            LiveSession.health_report_json.isnot(None),
        )
        .order_by(LiveSession.ended_at.desc().nullslast())
        .first()
    )
    last_health = last_session.health_report_json if last_session else None

    failed_quizzes_q = (
        db.query(CapsuleInteraction, Capsule, User)
        .join(Capsule, Capsule.id == CapsuleInteraction.capsule_id)
        .join(User,    User.id    == CapsuleInteraction.student_id)
        .filter(
            Capsule.subject_id == subject_id,
            CapsuleInteraction.quiz_attempted == True,  # noqa: E712
            CapsuleInteraction.quiz_passed == False,    # noqa: E712
        )
        .order_by(CapsuleInteraction.last_quiz_at.desc().nullslast())
        .limit(20)
        .all()
    )
    failed_summary = [
        {"student": u.name, "capsule": c.title, "score": ci.quiz_score}
        for ci, c, u in failed_quizzes_q
    ]

    schema = """{
  "readiness_score": integer 0-100,
  "students_needing_attention": [{"name": "string", "issue": "string", "suggestion": "string"}],
  "topic_to_revisit": "string or null",
  "warmup_suggestion": "string",
  "predicted_difficult_concepts": ["string", ...],
  "brief_summary": "string (2 sentences)"
}"""

    prompt = f"""You are an AI teaching coach preparing a pre-class brief for a teacher.

Today's session context: {json.dumps(upcoming_session_context, default=str)[:1500]}

Knowledge graph — students with weak/moderate understanding in this subject:
{json.dumps(weak_topics_summary)[:2500]}

Last session health report:
{json.dumps(last_health, default=str)[:1500]}

Recent failed capsule quizzes:
{json.dumps(failed_summary)[:1500]}

Compose a brief that tells the teacher in 2 sentences what they need to know.
Identify up to 6 students_needing_attention, suggest topic_to_revisit if any,
a warmup_suggestion, and predicted_difficult_concepts.

Return ONLY valid JSON (no markdown fences):
{schema}"""

    result = await _ai_json(prompt, system="You are a concise teaching coach. Return only valid JSON.")
    default_brief = {
        "readiness_score": 0,
        "students_needing_attention": [],
        "topic_to_revisit": None,
        "warmup_suggestion": "",
        "predicted_difficult_concepts": [],
        "brief_summary": "",
    }
    if not isinstance(result, dict):
        return default_brief

    out = dict(default_brief)
    out["readiness_score"] = _clamp_score(result.get("readiness_score", 0))
    sna = result.get("students_needing_attention") or []
    if isinstance(sna, list):
        out["students_needing_attention"] = [s for s in sna if isinstance(s, dict)][:10]
    ttr = result.get("topic_to_revisit")
    out["topic_to_revisit"] = str(ttr)[:200] if ttr else None
    out["warmup_suggestion"] = str(result.get("warmup_suggestion", ""))[:500]
    pdc = result.get("predicted_difficult_concepts") or []
    if isinstance(pdc, list):
        out["predicted_difficult_concepts"] = [str(x)[:200] for x in pdc[:10]]
    out["brief_summary"] = str(result.get("brief_summary", ""))[:600]
    return out


# ═══════════════════════════════════════════════════════════════════════
# 6. Auto-capsule generation from session
# ═══════════════════════════════════════════════════════════════════════

_DEFAULT_AUTO_CAPSULE = {
    "title": "",
    "summary": "",
    "key_points": [],
    "chapters": [],
    "confusion_moments": [],
    "student_specific_notes": [],
    "homework_suggestion": "",
    "difficulty_level": "intermediate",
    "topic_labels": [],
    "quiz_questions": [],
}


async def generate_auto_capsule_from_session(
    session_data: dict,
    transcript: str,
    ai_events: list[dict],
) -> dict:
    """
    Returns full auto-capsule content dict (see _DEFAULT_AUTO_CAPSULE).
    """
    snippet = (transcript or "").strip()[:TRANSCRIPT_CHAR_LIMIT]
    events_payload = json.dumps(ai_events or [], default=str)[:3000]
    sd_payload = json.dumps(session_data, default=str)[:1500]

    schema = """{
  "title": "string (max 120 chars)",
  "summary": "string (200-300 words)",
  "key_points": ["string", "string", "string", "string", "string"],
  "chapters": [{"timestamp_seconds": integer, "title": "string", "description": "string"}],
  "confusion_moments": [{"timestamp": "string", "topic": "string", "resolution": "string"}],
  "student_specific_notes": [{"student_id": integer, "note": "string"}],
  "homework_suggestion": "string",
  "difficulty_level": "beginner | intermediate | advanced",
  "topic_labels": ["string", ...],
  "quiz_questions": [
    {
      "question": "string",
      "options": {"A": "string", "B": "string", "C": "string", "D": "string"},
      "correct_answer": "A",
      "explanation": "string"
    }
  ]
}"""

    prompt = f"""You are an academic editor generating a self-contained study capsule
from a completed live class session. Produce content students who missed
the class can use to catch up.

Constraints:
- title: concise, descriptive
- summary: 200-300 words, no markdown
- EXACTLY 5 key_points
- EXACTLY 3 quiz_questions in MCQ format (A/B/C/D)
- chapters: 3-7 entries with timestamp_seconds (best estimate)
- confusion_moments: list any AI-detected confusion events
- student_specific_notes: short personal notes for students who struggled
- homework_suggestion: 1-2 sentences

Return ONLY valid JSON (no markdown fences):
{schema}

=== SESSION META ===
{sd_payload}
=== AI EVENTS ===
{events_payload}
=== TRANSCRIPT ===
{snippet}
=== END ==="""

    result = await _ai_json(prompt, system="You are an academic editor. Return only valid JSON.")
    if not isinstance(result, dict):
        return dict(_DEFAULT_AUTO_CAPSULE)

    out = dict(_DEFAULT_AUTO_CAPSULE)
    out["title"]   = str(result.get("title", ""))[:120]
    out["summary"] = str(result.get("summary", ""))[:4000]
    kp = result.get("key_points") or []
    if isinstance(kp, list):
        out["key_points"] = [str(x)[:300] for x in kp[:5]]
    chapters = result.get("chapters") or []
    if isinstance(chapters, list):
        out["chapters"] = [c for c in chapters if isinstance(c, dict)][:15]
    cm = result.get("confusion_moments") or []
    if isinstance(cm, list):
        out["confusion_moments"] = [c for c in cm if isinstance(c, dict)][:20]
    ssn = result.get("student_specific_notes") or []
    if isinstance(ssn, list):
        out["student_specific_notes"] = [s for s in ssn if isinstance(s, dict)][:30]
    out["homework_suggestion"] = str(result.get("homework_suggestion", ""))[:500]
    diff = str(result.get("difficulty_level", "intermediate")).lower()
    if diff in ("beginner", "intermediate", "advanced"):
        out["difficulty_level"] = diff
    tl = result.get("topic_labels") or []
    if isinstance(tl, list):
        out["topic_labels"] = [str(x)[:80] for x in tl[:10]]
    qq = result.get("quiz_questions") or []
    if isinstance(qq, list):
        out["quiz_questions"] = [q for q in qq if isinstance(q, dict)][:3]
    return out


# ═══════════════════════════════════════════════════════════════════════
# 7. Low-bandwidth text summary
# ═══════════════════════════════════════════════════════════════════════

async def generate_low_bandwidth_summary(transcript_chunk: str) -> dict:
    """
    Returns: {summary_text: str, key_term: str}
    """
    snippet = (transcript_chunk or "").strip()[:TRANSCRIPT_CHAR_LIMIT]
    if not snippet:
        return {"summary_text": "", "key_term": ""}

    schema = """{
  "summary_text": "string (3-4 sentences, plain text)",
  "key_term": "single most important term/concept from this segment"
}"""

    prompt = f"""You are summarising a 2-minute chunk of a live class for a student
on a poor connection. They cannot see/hear the video, so the text must
be self-contained.

Write a 3-4 sentence plain-text summary capturing what was just taught.
Identify the single most important key_term from this chunk.

Return ONLY valid JSON (no markdown fences):
{schema}

=== TRANSCRIPT CHUNK ===
{snippet}
=== END ==="""

    result = await _ai_json(prompt, system="You are a concise summariser. Return only valid JSON.")
    if not isinstance(result, dict):
        return {"summary_text": "", "key_term": ""}
    return {
        "summary_text": str(result.get("summary_text", ""))[:1000],
        "key_term":     str(result.get("key_term", ""))[:120],
    }


# ═══════════════════════════════════════════════════════════════════════
# 8. Update student knowledge graph (post-session)
# ═══════════════════════════════════════════════════════════════════════

def _level_from_signals(correct_pct: float, confused: int, understood: int) -> tuple[str, float]:
    """Heuristic mapping: returns (level_str, confidence_score 0..1)."""
    confidence = max(0.0, min(1.0, correct_pct / 100.0))
    # Penalise repeated confusion, reward understanding events
    confidence += 0.05 * understood - 0.10 * confused
    confidence = max(0.0, min(1.0, confidence))

    if confidence >= 0.75:
        level = "strong"
    elif confidence >= 0.5:
        level = "moderate"
    elif confidence > 0.0 or confused > 0 or understood > 0:
        level = "weak"
    else:
        level = "not_covered"
    return level, round(confidence, 2)


def update_student_knowledge_graph(
    student_id: int,
    subject_id: int,
    session_events: list[dict],
    pulse_results: list[dict],
    db: Session,
    live_session_id: Optional[int] = None,
) -> int:
    """
    Synchronous helper. Updates StudentKnowledgeGraph rows for this
    student/subject based on the session's pulse-check answers and AI
    confusion/positive events.

    Returns: number of knowledge-graph rows touched.
    """
    from database import StudentKnowledgeGraph, KnowledgeLevel

    # Aggregate per-topic signals
    per_topic: dict[str, dict] = {}

    def _bucket(topic: str) -> dict:
        t = (topic or "").strip()[:200]
        if not t:
            return None  # type: ignore[return-value]
        return per_topic.setdefault(
            t, {"correct": 0, "total": 0, "confused": 0, "understood": 0}
        )

    # Pulse-check signals
    for pr in pulse_results or []:
        topic = pr.get("topic") or pr.get("question_topic") or ""
        b = _bucket(topic)
        if b is None:
            continue
        b["total"] += 1
        if pr.get("is_correct"):
            b["correct"] += 1

    # AI event signals
    for ev in session_events or []:
        ev_type = str(ev.get("event_type", "")).lower()
        topic = ev.get("topic") or (ev.get("metadata_json") or {}).get("topic", "")
        affected = ev.get("affected_student_ids") or []
        if affected and student_id not in affected:
            continue
        b = _bucket(topic)
        if b is None:
            continue
        if ev_type in ("confusion_detected", "ai_observation") and ev.get("type") == "confusion":
            b["confused"] += 1
        elif ev_type == "ai_observation" and ev.get("type") == "positive":
            b["understood"] += 1

    if not per_topic:
        return 0

    touched = 0
    now = datetime.now(timezone.utc)
    for topic, sig in per_topic.items():
        correct_pct = (sig["correct"] / sig["total"] * 100.0) if sig["total"] else 0.0
        level_str, confidence = _level_from_signals(
            correct_pct, sig["confused"], sig["understood"]
        )
        try:
            level_enum = KnowledgeLevel(level_str)
        except ValueError:
            level_enum = KnowledgeLevel.not_covered

        row = (
            db.query(StudentKnowledgeGraph)
            .filter(
                StudentKnowledgeGraph.student_id == student_id,
                StudentKnowledgeGraph.subject_id == subject_id,
                StudentKnowledgeGraph.topic_name == topic,
            )
            .first()
        )
        if row is None:
            row = StudentKnowledgeGraph(
                student_id=student_id,
                subject_id=subject_id,
                topic_name=topic,
                understanding_level=level_enum,
                confidence_score=confidence,
                times_confused=sig["confused"],
                times_understood=sig["understood"],
                last_assessed_session_id=live_session_id,
                last_updated=now,
            )
            db.add(row)
        else:
            row.understanding_level = level_enum
            row.confidence_score = confidence
            row.times_confused = (row.times_confused or 0) + sig["confused"]
            row.times_understood = (row.times_understood or 0) + sig["understood"]
            row.last_assessed_session_id = live_session_id or row.last_assessed_session_id
            row.last_updated = now
        touched += 1

    try:
        db.commit()
    except Exception as exc:
        logger.error("update_student_knowledge_graph commit failed: %s", exc)
        db.rollback()
        return 0
    return touched


# ═══════════════════════════════════════════════════════════════════════
# 9. Session Health Narrative (F08) — short paragraph for the report card
# ═══════════════════════════════════════════════════════════════════════

async def generate_session_narrative(
    subject_name: str,
    overall_score: int,
    attendance_pct: float,
    engagement_pct: float,
    comprehension_pct: Optional[float],
    confusion_count: int,
    doubts_posted: int,
    doubts_resolved: int,
    duration_mins: int,
) -> str:
    """Generate the AI observation paragraph for Session Health Report."""
    comp_str = f"{comprehension_pct}%" if comprehension_pct is not None else "not measured"
    prompt = f"""You are a teaching analytics AI. Write a 2-3 sentence narrative
for a teacher after their class. Be specific, warm, and actionable.

Session data:
- Subject: {subject_name}
- Overall health: {overall_score}/100
- Duration: {duration_mins} mins
- Attendance: {attendance_pct}%
- Engagement: {engagement_pct}%
- Comprehension: {comp_str}
- Confusion events: {confusion_count}
- Doubts: {doubts_posted} posted, {doubts_resolved} resolved

Mention the most important insight and one specific recommendation for next class.
Max 60 words. Plain text, no markdown."""
    text = await _call_ai_text(prompt)
    text = (text or "").strip()
    if not text:
        text = (
            f"Session completed with {attendance_pct}% attendance and {engagement_pct}% "
            f"engagement. Consider reviewing topics where students raised doubts in the next class."
        )
    return text


# ═══════════════════════════════════════════════════════════════════════
# 10. Code → Mermaid Diagram (F14)
# ═══════════════════════════════════════════════════════════════════════

async def generate_diagram_from_code(
    code_snippet: str,
    language: str = "python",
    diagram_type: str = "auto",
) -> str:
    """Given a code snippet, return a Mermaid diagram that visualises it."""
    diagram_hint = (
        diagram_type if diagram_type and diagram_type != "auto" else "appropriate"
    )
    prompt = f"""You are an expert at creating Mermaid diagrams from code.

Analyze this {language} code and generate a {diagram_hint} Mermaid diagram.

CODE:
```{language}
{code_snippet[:1500]}
```

Rules:
- For recursive functions → use flowchart showing recursive calls
- For tree/linked-list operations → use graph diagram showing structure
- For sorting algorithms → use sequence diagram showing steps
- For class/OOP code → use classDiagram
- Keep it simple and readable — max 15 nodes
- Return ONLY the Mermaid diagram code, nothing else
- Start with the diagram type keyword (flowchart TD / graph TD / sequenceDiagram / classDiagram)

Mermaid diagram:"""
    raw = await _call_ai_text(prompt)
    text = (raw or "").strip()
    if not text:
        return "flowchart TD\n  A[Start] --> B[Could not generate diagram]"
    # Strip markdown fences if any
    if text.startswith("```"):
        lines = text.split("\n")
        # drop first fence
        lines = lines[1:]
        # drop trailing fence if present
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


# ═══════════════════════════════════════════════════════════════════════
# 11. Update per-student topic mastery after a session (F06)
# ═══════════════════════════════════════════════════════════════════════

async def update_student_topic_mastery(session_id: int, db: Session) -> int:
    """
    After a session ends: walk pulse responses + capsule topic list and
    update StudentTopicMastery rows. Returns number of (student, topic)
    pairs touched. Safe to call repeatedly (idempotent within a session).
    """
    from database import (
        LiveSession, LiveSessionParticipant, LiveParticipantType,
        LivePulseResponse, StudentTopicMastery, Capsule,
    )

    sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
    if not sess or not sess.subject_id:
        return 0

    # Discover topics covered (from auto-capsule's ai_summary JSON)
    topics_covered: list[str] = []
    if sess.auto_capsule_id:
        cap = db.query(Capsule).filter(Capsule.id == sess.auto_capsule_id).first()
        if cap and cap.ai_summary:
            try:
                summary = json.loads(cap.ai_summary)
                tc = summary.get("topics_covered") or []
                topics_covered = [str(t)[:200] for t in tc if t]
            except Exception:
                topics_covered = []
    if not topics_covered:
        logger.info("topic-mastery: no topics covered for session %s — skip", session_id)
        return 0

    participants = (
        db.query(LiveSessionParticipant)
        .filter(
            LiveSessionParticipant.live_session_id == session_id,
            LiveSessionParticipant.participant_type == LiveParticipantType.student,
            LiveSessionParticipant.user_id.isnot(None),
        )
        .all()
    )

    pulse_rows = (
        db.query(LivePulseResponse)
        .filter(
            LivePulseResponse.live_session_id == session_id,
            LivePulseResponse.student_id.isnot(None),
        )
        .all()
    )
    student_pulse: dict[int, dict] = {}
    for r in pulse_rows:
        sid = r.student_id
        bucket = student_pulse.setdefault(sid, {"correct": 0, "total": 0})
        bucket["total"] += 1
        if r.is_correct:
            bucket["correct"] += 1

    touched = 0
    for p in participants:
        sid = p.user_id
        if not sid:
            continue
        ps = student_pulse.get(sid, {})
        if ps.get("total", 0) > 0:
            student_comp = round(ps["correct"] / ps["total"] * 100, 1)
        else:
            student_comp = 55.0  # neutral default

        for topic in topics_covered:
            row = (
                db.query(StudentTopicMastery)
                .filter(
                    StudentTopicMastery.student_id == sid,
                    StudentTopicMastery.subject_id == sess.subject_id,
                    StudentTopicMastery.topic == topic,
                )
                .first()
            )
            if row:
                row.mastery_pct = round(row.mastery_pct * 0.6 + student_comp * 0.4, 1)
                row.sessions_seen = (row.sessions_seen or 0) + 1
            else:
                db.add(StudentTopicMastery(
                    student_id=sid,
                    subject_id=sess.subject_id,
                    topic=topic,
                    mastery_pct=student_comp,
                    sessions_seen=1,
                ))
            touched += 1
    try:
        db.commit()
    except Exception as exc:
        logger.error("update_student_topic_mastery commit failed: %s", exc)
        db.rollback()
        return 0
    logger.info(
        "📊 Topic mastery updated for session %d — %d students, %d topics, %d rows",
        session_id, len(participants), len(topics_covered), touched,
    )
    return touched


# ════════════════════════════════════════════════════════════════════════
# F03 — AI raises hand: decides whether to interrupt the teacher
# ════════════════════════════════════════════════════════════════════════

async def generate_ai_intervention(
    session_id: int,
    db,
    session_data: dict,
) -> Optional[dict]:
    """Decide whether the AI should interrupt the teacher right now.

    Returns ``None`` if no intervention is needed, or a dict containing
    ``type``, ``title``, ``message``, ``suggestion``, ``actions``,
    ``action_type`` and ``severity``.

    Pure rule-based — no LLM call required so it is cheap and stable.
    """
    elapsed_mins      = int(session_data.get("elapsed_mins", 0) or 0)
    silent_count      = int(session_data.get("silent_count", 0) or 0)
    total_students    = int(session_data.get("total_students", 1) or 1) or 1
    hot_doubts        = int(session_data.get("hot_doubts", 0) or 0)
    pulse_comp_avg    = session_data.get("pulse_comp_avg")
    mins_since_pulse  = int(session_data.get("mins_since_pulse", 999) or 999)
    last_intervention = int(session_data.get("last_intervention_mins", 0) or 0)

    # 7-minute cooldown between interventions
    if elapsed_mins - last_intervention < 7 and last_intervention > 0:
        return None

    # TYPE 1 — Confusion alert (reactive)
    if silent_count >= 4 and (silent_count / total_students) > 0.25:
        return {
            "type":        "confusion_alert",
            "title":       "⚠️ Confusion Detected",
            "message":     f"{silent_count} students have gone quiet after the last explanation.",
            "suggestion":  "Consider a quick recap or ask if anyone needs help.",
            "actions":     ["Send recap", "Take pulse check", "Dismiss"],
            "action_type": "confusion",
            "severity":    "high",
        }

    # TYPE 5 — Low comprehension (act early when present)
    if pulse_comp_avg is not None and float(pulse_comp_avg) < 55:
        return {
            "type":        "low_comprehension",
            "title":       "📉 Low Comprehension",
            "message":     f"Average pulse score is {pulse_comp_avg}% — less than half the class understands.",
            "suggestion":  "Slow down and revisit the last concept with a different explanation.",
            "actions":     ["Revisit concept", "Try analogy", "Dismiss"],
            "action_type": "revisit",
            "severity":    "high",
        }

    # TYPE 3 — Hot doubt
    if hot_doubts > 0:
        return {
            "type":        "hot_doubt",
            "title":       "🔥 Hot Doubt Detected",
            "message":     f"{hot_doubts} doubt(s) have multiple students resonating — many share this confusion.",
            "suggestion":  "Address the most resonated doubt on the wall now.",
            "actions":     ["View doubt", "Address now", "Dismiss"],
            "action_type": "doubt",
            "severity":    "high",
        }

    # TYPE 2 — Pace alert
    if mins_since_pulse > 20 and elapsed_mins > 25:
        return {
            "type":        "pace_alert",
            "title":       "⚡ Pace Check",
            "message":     f"You're {elapsed_mins} minutes in with no comprehension check.",
            "suggestion":  "A quick pulse check helps ensure students are following.",
            "actions":     ["Send pulse check", "Continue", "Dismiss"],
            "action_type": "pulse",
            "severity":    "medium",
        }

    # TYPE 4 — Energy check (every ~45 min, narrow window)
    if elapsed_mins > 45 and (elapsed_mins % 45) < 6:
        return {
            "type":        "energy_check",
            "title":       "🔋 Energy Check",
            "message":     f"{elapsed_mins} minutes into the session. Student focus naturally dips after 45 mins.",
            "suggestion":  "A 3-minute stretch break can improve retention for the second half.",
            "actions":     ["Take a break", "Continue", "Dismiss"],
            "action_type": "break",
            "severity":    "low",
        }

    return None


