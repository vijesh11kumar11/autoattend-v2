"""
AutoAttend AI v2.0 — Career Roadmap Routes

POST /api/career/generate   — AI-powered roadmap generation (all roles)
GET  /api/career/saved       — list saved roadmaps for current user
POST /api/career/save        — save a roadmap to database
"""

import json
import logging
import re
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from config import settings
from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    CareerRoadmap,
    College,
    Department,
    SessionLocal,
    SessionStatus,
    Subject,
    TutorAssignment,
    User,
    UserRole,
    get_db,
)
from utils.auth_utils import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/career", tags=["Career"])


# ═══════════════════════════════════════════════════════════════════════
# Request / Response schemas
# ═══════════════════════════════════════════════════════════════════════

class GenerateRequest(BaseModel):
    career_goal: str = Field(..., min_length=2, max_length=100)
    current_skills: list[str] = Field(default_factory=list)
    hours_per_week: int = Field(default=10, ge=5, le=30)
    experience_level: str = Field(default="beginner")


class SaveRequest(BaseModel):
    career_goal: str
    roadmap_data: dict


# ═══════════════════════════════════════════════════════════════════════
# Context builders — fetch role-specific data from DB
# ═══════════════════════════════════════════════════════════════════════

def _student_context(user_id: int, db: Session) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return {}

    # Enrolled subjects for student's semester
    subjects = (
        db.query(Subject)
        .filter(Subject.course_id == user.course_id, Subject.semester == user.semester)
        .all()
    )

    subject_data = []
    total_present = 0
    total_sessions = 0
    for s in subjects:
        sess_ids = [
            sid for (sid,) in db.query(AttendanceSession.id)
            .filter(
                AttendanceSession.subject_id == s.id,
                AttendanceSession.status == SessionStatus.ended,
            ).all()
        ]
        present = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id.in_(sess_ids),
            AttendanceRecord.student_id == user_id,
            AttendanceRecord.status == AttendanceStatus.present,
        ).count() if sess_ids else 0
        total = len(sess_ids)
        pct = round((present / total) * 100, 1) if total else 0
        subject_data.append({"name": s.name, "code": s.code, "attendance_pct": pct, "sessions": total})
        total_present += present
        total_sessions += total

    overall_pct = round((total_present / total_sessions) * 100, 1) if total_sessions else 0

    # Tutor name
    tutor_assign = db.query(TutorAssignment).filter(TutorAssignment.student_id == user_id).first()
    tutor_name = None
    if tutor_assign:
        tutor = db.query(User).filter(User.id == tutor_assign.tutor_id).first()
        tutor_name = tutor.name if tutor else None

    return {
        "name": user.name,
        "semester": user.semester,
        "subjects": subject_data,
        "overall_attendance_pct": overall_pct,
        "tutor_name": tutor_name,
    }


def _teacher_context(user_id: int, db: Session) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return {}

    subjects = db.query(Subject).filter(Subject.teacher_id == user_id).all()
    subject_names = [s.name for s in subjects]

    total_sessions = db.query(AttendanceSession).filter(
        AttendanceSession.teacher_id == user_id,
        AttendanceSession.status == SessionStatus.ended,
    ).count()

    # Average attendance across their classes
    sess_ids = [
        sid for (sid,) in db.query(AttendanceSession.id)
        .filter(
            AttendanceSession.teacher_id == user_id,
            AttendanceSession.status == SessionStatus.ended,
        ).all()
    ]
    total_records = db.query(AttendanceRecord).filter(AttendanceRecord.session_id.in_(sess_ids)).count() if sess_ids else 0
    present_records = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id.in_(sess_ids),
        AttendanceRecord.status == AttendanceStatus.present,
    ).count() if sess_ids else 0
    avg_attendance = round((present_records / total_records) * 100, 1) if total_records else 0

    dept = db.query(Department).filter(Department.id == user.department_id).first()

    return {
        "name": user.name,
        "subjects_teaching": subject_names,
        "sessions_conducted": total_sessions,
        "avg_class_attendance": avg_attendance,
        "department": dept.name if dept else "N/A",
    }


def _hod_context(user_id: int, db: Session) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return {}

    dept = db.query(Department).filter(Department.id == user.department_id).first()
    teachers_count = db.query(User).filter(
        User.department_id == user.department_id,
        User.role == UserRole.teacher,
        User.is_active == True,
    ).count()
    students_count = db.query(User).filter(
        User.department_id == user.department_id,
        User.role == UserRole.student,
        User.is_active == True,
    ).count()

    return {
        "name": user.name,
        "department": dept.name if dept else "N/A",
        "teachers_count": teachers_count,
        "students_count": students_count,
    }


def _principal_context(user_id: int, db: Session) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return {}

    college = db.query(College).filter(College.id == user.college_id).first()
    total_depts = db.query(Department).filter(Department.college_id == user.college_id).count()
    total_teachers = db.query(User).filter(
        User.college_id == user.college_id,
        User.role == UserRole.teacher,
        User.is_active == True,
    ).count()
    total_students = db.query(User).filter(
        User.college_id == user.college_id,
        User.role == UserRole.student,
        User.is_active == True,
    ).count()

    return {
        "name": user.name,
        "college": college.name if college else "N/A",
        "total_departments": total_depts,
        "total_teachers": total_teachers,
        "total_students": total_students,
    }


# ═══════════════════════════════════════════════════════════════════════
# Prompt builder
# ═══════════════════════════════════════════════════════════════════════

_JSON_SCHEMA = """{
  "career_title": "string",
  "role_context": "string — one line describing who this is for, using their name and context",
  "overview": "string — 2-3 sentences about this career path relevant to their role",
  "market_demand": {
    "demand_level": "High|Medium|Low",
    "avg_salary_india": "string e.g. ₹12-25 LPA",
    "top_organizations": ["5 relevant orgs"],
    "avg_package_or_increment": "string relevant to role"
  },
  "phases": [
    {
      "phase_number": 1,
      "title": "string",
      "duration": "string e.g. 3 months",
      "description": "string",
      "skills": ["skill1", "skill2"],
      "projects": ["for students: project ideas"] OR "initiatives": ["for teachers/HOD/principal: things to implement"],
      "resources": [{"name": "string", "url": "real working free URL", "type": "YouTube|Website|Course|Book|Conference"}]
    }
  ],
  "certifications": [
    {"name": "string", "provider": "string", "cost": "Free|Paid", "url": "string", "priority": "Must-Have|Good-to-Have"}
  ],
  "current_gap": ["strings based on their actual data"],
  "personalized_tips": ["4 tips genuinely specific to their situation"],
  "estimated_timeline": "string",
  "difficulty": "Beginner-Friendly|Intermediate|Advanced",
  "role_specific_advantages": ["2-3 advantages based on their current role and data"]
}"""


def _build_prompt(role: str, ctx: dict, req: GenerateRequest) -> str:
    role_labels = {"student": "Student", "teacher": "Teacher", "hod": "Head of Department", "principal": "Principal"}
    role_label = role_labels.get(role, role.title())

    context_lines = "\n".join(f"  - {k}: {v}" for k, v in ctx.items())

    prompt = f"""You are an expert career counsellor for Indian education professionals and students.
Generate a detailed, personalized career roadmap for this person.

ROLE: {role_label}
CAREER GOAL: {req.career_goal}
CURRENT SKILLS: {', '.join(req.current_skills) if req.current_skills else 'Not specified'}
HOURS PER WEEK: {req.hours_per_week}
EXPERIENCE LEVEL: {req.experience_level}

THEIR REAL PROFILE DATA:
{context_lines}

IMPORTANT INSTRUCTIONS:
1. {"For this STUDENT — if attendance is below 75%, include tips about discipline and regularity. Reference their actual subjects and attendance numbers." if role == "student" else ""}
2. {"For this TEACHER — reference their actual subjects and class performance. If average attendance is low, suggest student engagement strategies." if role == "teacher" else ""}
3. {"For this HOD — reference their department size and metrics. Suggest leadership and institutional improvement initiatives." if role == "hod" else ""}
4. {"For this PRINCIPAL — reference institutional data. Suggest strategic, policy-level, and national-level career moves." if role == "principal" else ""}
5. Use the field "projects" for students and "initiatives" for teacher/HOD/principal in each phase.
6. All resource URLs must be REAL working free URLs (YouTube, Coursera, edX, Khan Academy, freeCodeCamp, etc.)
7. For {"students show tech companies" if role == "student" else "teachers show universities and edtech companies" if role == "teacher" else "HOD show education boards and universities" if role == "hod" else "principals show policy boards and international universities"} in top_organizations.
8. Make certifications relevant: {"technical certs like AWS, Google, etc." if role == "student" else "teaching + research certs" if role == "teacher" else "leadership + accreditation certs" if role == "hod" else "executive education + policy certs"}
9. Make personalized_tips genuinely reference their actual data (name, subjects, attendance, etc.)
10. Return EXACTLY 3 phases, 3-4 certifications, 4 personalized tips.

Return ONLY valid JSON matching this schema (no markdown, no code fences):
{_JSON_SCHEMA}"""

    return prompt


# ═══════════════════════════════════════════════════════════════════════
# AI Providers
# ═══════════════════════════════════════════════════════════════════════

def _call_gemini(prompt: str) -> dict | None:
    api_key = settings.GEMINI_API_KEY
    if not api_key:
        return None
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                temperature=0.7,
                max_output_tokens=4096,
            ),
        )
        text = response.text.strip()
        return _parse_json(text)
    except Exception as exc:
        logger.warning("Gemini failed: %s", exc)
        return None


def _call_groq(prompt: str) -> dict | None:
    api_key = settings.GROQ_API_KEY
    if not api_key:
        return None
    try:
        from groq import Groq
        client = Groq(api_key=api_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a career counsellor. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=4096,
            timeout=30,
        )
        text = response.choices[0].message.content.strip()
        return _parse_json(text)
    except Exception as exc:
        logger.warning("Groq failed: %s", exc)
        return None


def _parse_json(text: str) -> dict | None:
    """Extract JSON from AI response, stripping markdown fences if present."""
    # Strip ```json ... ``` fences
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object in text
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                # Salvage attempt failed — the AI returned non-JSON content.
                # Caller handles None by falling back to a default payload.
                logger.warning("Failed to parse JSON from AI response after salvage attempt")
    return None


# ═══════════════════════════════════════════════════════════════════════
# POST /api/career/generate
# ═══════════════════════════════════════════════════════════════════════

@router.post("/generate")
def generate_roadmap(
    body: GenerateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user["role"]
    user_id = current_user["id"]

    # Validate experience level
    if body.experience_level not in ("beginner", "intermediate", "advanced"):
        body.experience_level = "beginner"

    # Get role-specific context
    ctx_builders = {
        "student": _student_context,
        "teacher": _teacher_context,
        "hod": _hod_context,
        "principal": _principal_context,
    }
    ctx = ctx_builders.get(role, _student_context)(user_id, db)

    prompt = _build_prompt(role, ctx, body)

    # Try Gemini first, fallback to Groq
    start = time.time()
    result = _call_gemini(prompt)
    provider = "Gemini"

    if result is None:
        logger.info("⚡ Gemini failed, falling back to Groq")
        result = _call_groq(prompt)
        provider = "Groq"

    if result is None:
        # Retry Gemini with stricter prompt
        strict_prompt = prompt + "\n\nCRITICAL: Return ONLY raw JSON. No explanations, no markdown fences, no text before or after the JSON object."
        result = _call_gemini(strict_prompt)
        provider = "Gemini (retry)"

    elapsed = round(time.time() - start, 2)

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI service unavailable. Please try again.",
        )

    logger.info("🎯 CAREER ROADMAP │ role=%s │ goal=%s │ provider=%s │ time=%ss",
                role, body.career_goal, provider, elapsed)

    return {
        "roadmap": result,
        "provider": provider,
        "generation_time": elapsed,
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/career/saved
# ═══════════════════════════════════════════════════════════════════════

@router.get("/saved")
def get_saved_roadmaps(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(CareerRoadmap)
        .filter(CareerRoadmap.user_id == current_user["id"])
        .order_by(desc(CareerRoadmap.generated_at))
        .limit(20)
        .all()
    )
    return [
        {
            "id": r.id,
            "career_goal": r.career_goal,
            "user_role": r.user_role,
            "roadmap_data": r.roadmap_data,
            "generated_at": r.generated_at.isoformat() if r.generated_at else None,
        }
        for r in rows
    ]


# ═══════════════════════════════════════════════════════════════════════
# POST /api/career/save
# ═══════════════════════════════════════════════════════════════════════

@router.post("/save")
def save_roadmap(
    body: SaveRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    roadmap = CareerRoadmap(
        user_id=current_user["id"],
        user_role=current_user["role"],
        career_goal=body.career_goal,
        roadmap_data=body.roadmap_data,
        is_saved=True,
    )
    db.add(roadmap)
    db.commit()
    db.refresh(roadmap)
    return {"id": roadmap.id, "message": "Roadmap saved successfully"}
