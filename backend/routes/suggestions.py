"""
AutoAttend AI v2.0 — Smart Suggestion Box Routes

POST  /api/suggestions/submit              — submit anonymous feedback (all roles)
GET   /api/suggestions/my-submissions       — own submissions (all roles)
GET   /api/suggestions/department-analysis  — dept AI report + list (HOD, Principal)
GET   /api/suggestions/institution-analysis — institution AI report + list (Principal)
GET   /api/suggestions/teacher-feedback     — anonymous student feedback (Teacher)
PATCH /api/suggestions/{id}/respond         — admin response (HOD, Principal)
POST  /api/suggestions/generate-ai-report   — trigger AI analysis (HOD, Principal)
"""

import json
import logging
import re
import time
from datetime import UTC, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from config import settings
from database import (
    Subject,
    Suggestion,
    SuggestionAIReport,
    User,
    get_db,
)
from utils.auth_utils import get_current_user
from utils.claude_ai import call_claude_sync
from utils.sanitization import clean_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/suggestions", tags=["Suggestions"])

# ── Constants ──────────────────────────────────────────────────────────
VALID_CATEGORIES = {
    "teaching_quality",
    "infrastructure",
    "syllabus",
    "administration",
    "canteen",
    "hostel",
    "sports",
    "library",
    "other",
    "class_environment",
    "student_engagement",
}
VALID_SCOPES = {"department", "institution", "subject", "general"}
VALID_PRIORITIES = {"low", "medium", "high", "critical"}
VALID_STATUSES = {"pending", "reviewed", "actioned", "dismissed"}

AI_TIMEOUT = 30  # seconds


# ═══════════════════════════════════════════════════════════════════════
# Request / Response schemas
# ═══════════════════════════════════════════════════════════════════════


class SubmitRequest(BaseModel):
    category: str = Field(..., min_length=2, max_length=50)
    target_scope: str = Field(default="general", max_length=30)
    target_subject_id: Optional[int] = None
    message: str = Field(..., min_length=20, max_length=1000)
    is_anonymous: bool = True
    priority: str = Field(default="low", max_length=20)


class RespondRequest(BaseModel):
    admin_response: str = Field(..., min_length=1, max_length=2000)
    status: str = Field(default="reviewed", max_length=20)


class GenerateReportRequest(BaseModel):
    scope: str = Field(default="department", max_length=30)


# ═══════════════════════════════════════════════════════════════════════
# Route 1 — POST /submit
# ═══════════════════════════════════════════════════════════════════════


@router.post("/submit")
def submit_suggestion(
    body: SubmitRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.category not in VALID_CATEGORIES:
        raise HTTPException(
            400, f"Invalid category. Must be one of: {', '.join(sorted(VALID_CATEGORIES))}"
        )
    if body.target_scope not in VALID_SCOPES:
        raise HTTPException(
            400, f"Invalid scope. Must be one of: {', '.join(sorted(VALID_SCOPES))}"
        )
    if body.priority not in VALID_PRIORITIES:
        raise HTTPException(
            400, f"Invalid priority. Must be one of: {', '.join(sorted(VALID_PRIORITIES))}"
        )

    user = db.query(User).filter(User.id == current_user["id"]).first()
    if not user:
        raise HTTPException(404, "User not found")

    suggestion = Suggestion(
        submitted_by_user_id=user.id,
        submitted_by_role=current_user["role"],
        category=body.category,
        target_scope=body.target_scope,
        target_subject_id=body.target_subject_id,
        target_department_id=user.department_id,
        message=clean_text(body.message),
        is_anonymous=body.is_anonymous,
        priority=body.priority,
    )
    db.add(suggestion)
    db.commit()
    db.refresh(suggestion)

    return {
        "id": suggestion.id,
        "message": "Feedback submitted successfully",
        "submitted_at": suggestion.submitted_at.isoformat() if suggestion.submitted_at else None,
    }


# ═══════════════════════════════════════════════════════════════════════
# Route 2 — GET /my-submissions
# ═══════════════════════════════════════════════════════════════════════


@router.get("/my-submissions")
def my_submissions(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(
            Suggestion.id,
            Suggestion.category,
            Suggestion.message,
            Suggestion.status,
            Suggestion.priority,
            Suggestion.sentiment,
            Suggestion.submitted_at,
            Suggestion.admin_response,
            Suggestion.target_scope,
        )
        .filter(Suggestion.submitted_by_user_id == current_user["id"])
        .order_by(desc(Suggestion.submitted_at))
        .all()
    )
    return [
        {
            "id": r.id,
            "category": r.category,
            "message": r.message,
            "status": r.status,
            "priority": r.priority,
            "sentiment": r.sentiment,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            "admin_response": r.admin_response,
            "target_scope": r.target_scope,
        }
        for r in rows
    ]


# ═══════════════════════════════════════════════════════════════════════
# Route 3 — GET /department-analysis   (HOD + Principal)
# ═══════════════════════════════════════════════════════════════════════


def _strip_identity(rows):
    """Return suggestion dicts with identity completely stripped."""
    return [
        {
            "id": r.id,
            "category": r.category,
            "message": r.message,
            "sentiment": r.sentiment,
            "priority": r.priority,
            "status": r.status,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            "target_scope": r.target_scope,
            "admin_response": r.admin_response,
            "submitted_by_role": r.submitted_by_role,
        }
        for r in rows
    ]


@router.get("/department-analysis")
def department_analysis(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] not in ("hod", "principal"):
        raise HTTPException(403, "Only HOD and Principal can access department analysis")

    dept_id = current_user.get("department_id")
    if not dept_id:
        raise HTTPException(400, "No department associated with your account")

    # Latest AI report for this department
    report = (
        db.query(SuggestionAIReport)
        .filter(SuggestionAIReport.scope == "department", SuggestionAIReport.scope_id == dept_id)
        .order_by(desc(SuggestionAIReport.generated_at))
        .first()
    )

    # All suggestions for this department — identity stripped at query level
    suggestions = (
        db.query(
            Suggestion.id,
            Suggestion.category,
            Suggestion.message,
            Suggestion.sentiment,
            Suggestion.priority,
            Suggestion.status,
            Suggestion.submitted_at,
            Suggestion.target_scope,
            Suggestion.admin_response,
            Suggestion.submitted_by_role,
        )
        .filter(Suggestion.target_department_id == dept_id)
        .order_by(desc(Suggestion.submitted_at))
        .all()
    )

    return {
        "report": (
            {
                "id": report.id,
                "report_data": report.report_data,
                "generated_at": report.generated_at.isoformat() if report.generated_at else None,
                "total_analysed": report.total_suggestions_analysed,
                "ai_provider": report.ai_provider,
            }
            if report
            else None
        ),
        "suggestions": _strip_identity(suggestions),
    }


# ═══════════════════════════════════════════════════════════════════════
# Route 4 — GET /institution-analysis   (Principal only)
# ═══════════════════════════════════════════════════════════════════════


@router.get("/institution-analysis")
def institution_analysis(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] != "principal":
        raise HTTPException(403, "Only Principal can access institution analysis")

    report = (
        db.query(SuggestionAIReport)
        .filter(SuggestionAIReport.scope == "institution", SuggestionAIReport.scope_id.is_(None))
        .order_by(desc(SuggestionAIReport.generated_at))
        .first()
    )

    suggestions = (
        db.query(
            Suggestion.id,
            Suggestion.category,
            Suggestion.message,
            Suggestion.sentiment,
            Suggestion.priority,
            Suggestion.status,
            Suggestion.submitted_at,
            Suggestion.target_scope,
            Suggestion.admin_response,
            Suggestion.submitted_by_role,
        )
        .order_by(desc(Suggestion.submitted_at))
        .all()
    )

    return {
        "report": (
            {
                "id": report.id,
                "report_data": report.report_data,
                "generated_at": report.generated_at.isoformat() if report.generated_at else None,
                "total_analysed": report.total_suggestions_analysed,
                "ai_provider": report.ai_provider,
            }
            if report
            else None
        ),
        "suggestions": _strip_identity(suggestions),
    }


# ═══════════════════════════════════════════════════════════════════════
# Route 5 — GET /teacher-feedback   (Teacher only)
# ═══════════════════════════════════════════════════════════════════════


@router.get("/teacher-feedback")
def teacher_feedback(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] != "teacher":
        raise HTTPException(403, "Only teachers can access this endpoint")

    # Find all subjects this teacher teaches
    teacher_subjects = db.query(Subject).filter(Subject.teacher_id == current_user["id"]).all()
    subject_ids = [s.id for s in teacher_subjects]

    if not subject_ids:
        return {"subjects": [], "feedback": []}

    suggestions = (
        db.query(
            Suggestion.id,
            Suggestion.category,
            Suggestion.message,
            Suggestion.sentiment,
            Suggestion.priority,
            Suggestion.status,
            Suggestion.submitted_at,
            Suggestion.target_scope,
            Suggestion.admin_response,
            Suggestion.target_subject_id,
            Suggestion.submitted_by_role,
        )
        .filter(Suggestion.target_subject_id.in_(subject_ids))
        .order_by(desc(Suggestion.submitted_at))
        .all()
    )

    # Group by subject
    subject_map = {s.id: {"id": s.id, "name": s.name, "code": s.code} for s in teacher_subjects}
    grouped = {}
    for r in suggestions:
        sid = r.target_subject_id
        if sid not in grouped:
            grouped[sid] = {
                "subject": subject_map.get(sid, {"id": sid, "name": "Unknown"}),
                "feedback": [],
            }
        grouped[sid]["feedback"].append(
            {
                "id": r.id,
                "category": r.category,
                "message": r.message,
                "sentiment": r.sentiment,
                "priority": r.priority,
                "status": r.status,
                "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
                "admin_response": r.admin_response,
            }
        )

    return {
        "subjects": list(subject_map.values()),
        "grouped_feedback": list(grouped.values()),
        "total_feedback": len(suggestions),
    }


# ═══════════════════════════════════════════════════════════════════════
# Route 6 — PATCH /{suggestion_id}/respond   (HOD + Principal)
# ═══════════════════════════════════════════════════════════════════════


@router.patch("/{suggestion_id}/respond")
def respond_to_suggestion(
    suggestion_id: int,
    body: RespondRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] not in ("hod", "principal"):
        raise HTTPException(403, "Only HOD and Principal can respond to suggestions")

    if body.status not in {"reviewed", "actioned", "dismissed"}:
        raise HTTPException(400, "Status must be reviewed, actioned, or dismissed")

    suggestion = db.query(Suggestion).filter(Suggestion.id == suggestion_id).first()
    if not suggestion:
        raise HTTPException(404, "Suggestion not found")

    suggestion.admin_response = body.admin_response
    suggestion.status = body.status
    suggestion.reviewed_at = datetime.now(UTC)
    suggestion.reviewed_by_role = current_user["role"]
    db.commit()

    return {"message": "Response saved", "id": suggestion_id, "status": body.status}


# ═══════════════════════════════════════════════════════════════════════
# Route 7 — POST /generate-ai-report   (HOD + Principal)
# ═══════════════════════════════════════════════════════════════════════


def _parse_json(raw: str) -> dict:
    """Strip markdown fences and parse JSON."""
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`")
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            return json.loads(m.group())
        raise


def _build_ai_prompt(suggestions_text: str, scope_label: str, total: int) -> str:
    return f"""You are an expert education analyst AI. Analyse the following {total} anonymous feedback submissions from a {scope_label}.

FEEDBACK SUBMISSIONS:
{suggestions_text}

Return a JSON object with EXACTLY these fields:
{{
  "executive_summary": "2-3 sentence overall summary of all feedback",
  "overall_sentiment": "positive/neutral/negative/mixed with percentage breakdown like 60% negative, 30% neutral, 10% positive",
  "sentiment_breakdown": {{"positive_count": 0, "neutral_count": 0, "negative_count": 0, "mixed_count": 0}},
  "total_analysed": {total},
  "top_issues": [
    {{
      "rank": 1,
      "issue_title": "...",
      "issue_description": "...",
      "affected_count": 0,
      "category": "...",
      "severity": "low/medium/high/critical",
      "suggested_action": "..."
    }}
  ],
  "category_breakdown": {{"teaching_quality": 0, "infrastructure": 0, "syllabus": 0, "administration": 0, "canteen": 0, "hostel": 0, "sports": 0, "library": 0, "other": 0}},
  "recurring_themes": ["theme1", "theme2", "theme3", "theme4"],
  "positive_highlights": ["highlight1", "highlight2"],
  "urgent_attention": [
    {{
      "issue": "...",
      "severity": "critical/high",
      "recommended_action": "..."
    }}
  ],
  "mood_score": 50,
  "trend_insight": "Describing whether situation is improving or needs attention based on the feedback patterns",
  "actionable_recommendations": [
    "Specific recommendation 1",
    "Specific recommendation 2",
    "Specific recommendation 3",
    "Specific recommendation 4",
    "Specific recommendation 5"
  ],
  "individual_sentiments": [
    {{"suggestion_id": 1, "sentiment": "positive/neutral/negative/mixed", "priority_suggestion": "low/medium/high/critical"}}
  ]
}}

IMPORTANT RULES:
- top_issues must have exactly 5 items (or fewer if less unique issues exist)
- actionable_recommendations must have exactly 5 items
- mood_score is 0–100 where 0 is extremely negative, 100 is extremely positive
- individual_sentiments must include an entry for EVERY submission using the ID provided
- severity levels: low, medium, high, critical
- Be specific and actionable in recommendations
- Return ONLY the JSON object, no other text
"""


def _call_claude(prompt: str) -> str:
    """Call Claude Haiku (primary). Raises on failure so the chain falls through."""
    raw = call_claude_sync(
        prompt,
        system="You are an expert institutional analyst. Return only valid JSON.",
        max_tokens=4096,
        temperature=0.3,
    )
    if not raw:
        raise RuntimeError("Claude returned no content")
    return raw


def _call_gemini(prompt: str) -> str:
    """Call Gemini 2.0 Flash with timeout."""
    import google.genai as genai

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config={"http_options": {"timeout": AI_TIMEOUT * 1000}},
    )
    return response.text


def _call_groq(prompt: str) -> str:
    """Call Groq Llama 3.3 70b with timeout."""
    import groq

    client = groq.Groq(api_key=settings.GROQ_API_KEY, timeout=AI_TIMEOUT)
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=4096,
    )
    return response.choices[0].message.content


@router.post("/generate-ai-report")
def generate_ai_report(
    body: GenerateReportRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user["role"] not in ("hod", "principal"):
        raise HTTPException(403, "Only HOD and Principal can generate AI reports")

    if body.scope == "institution" and current_user["role"] != "principal":
        raise HTTPException(403, "Only Principal can generate institution-wide reports")

    # Determine scope
    if body.scope == "department":
        dept_id = current_user.get("department_id")
        if not dept_id:
            raise HTTPException(400, "No department associated with your account")
        scope_label = "college department"
        scope_id = dept_id
        suggestions = db.query(Suggestion).filter(Suggestion.target_department_id == dept_id).all()
    else:
        scope_label = "entire educational institution"
        scope_id = None
        suggestions = db.query(Suggestion).all()

    if not suggestions:
        raise HTTPException(404, "No suggestions found to analyse")

    # Build text for AI
    suggestions_text = ""
    for s in suggestions:
        suggestions_text += f"[ID:{s.id}] Category: {s.category} | Priority: {s.priority} | Message: {s.message}\n\n"

    prompt = _build_ai_prompt(suggestions_text, scope_label, len(suggestions))

    # Try Gemini → Groq → Gemini retry
    provider = None
    raw = None
    t0 = time.time()

    for attempt_provider, caller in [
        ("claude", _call_claude),
        ("gemini", _call_gemini),
        ("groq", _call_groq),
        ("gemini", _call_gemini),
    ]:
        try:
            raw = caller(prompt)
            provider = attempt_provider
            break
        except Exception as exc:
            logger.warning("AI call failed (%s): %s", attempt_provider, exc)
            continue

    if not raw:
        raise HTTPException(
            502, "AI analysis unavailable. Both Gemini and Groq failed. Please try again later."
        )

    generation_time = round(time.time() - t0, 2)

    try:
        report_data = _parse_json(raw)
    except Exception:
        logger.error("Failed to parse AI response: %s", raw[:500])
        raise HTTPException(502, "AI returned an invalid response. Please try again.")

    # Update individual suggestion sentiments from AI
    individual = report_data.pop("individual_sentiments", [])
    suggestion_map = {s.id: s for s in suggestions}
    for item in individual:
        sid = item.get("suggestion_id")
        if sid and sid in suggestion_map:
            s = suggestion_map[sid]
            s.sentiment = item.get("sentiment", s.sentiment)
            ai_priority = item.get("priority_suggestion")
            if ai_priority and ai_priority in VALID_PRIORITIES:
                # AI can only upgrade priority, never downgrade
                priority_rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
                if priority_rank.get(ai_priority, 0) > priority_rank.get(s.priority, 0):
                    s.priority = ai_priority

    # Save report
    report = SuggestionAIReport(
        scope=body.scope,
        scope_id=scope_id,
        report_data=report_data,
        total_suggestions_analysed=len(suggestions),
        ai_provider=provider,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    logger.info(
        "AI report generated — scope=%s, provider=%s, analysed=%d, time=%.1fs",
        body.scope,
        provider,
        len(suggestions),
        generation_time,
    )

    return {
        "report": {
            "id": report.id,
            "report_data": report_data,
            "generated_at": report.generated_at.isoformat() if report.generated_at else None,
            "total_analysed": report.total_suggestions_analysed,
            "ai_provider": provider,
        },
        "generation_time": generation_time,
    }
