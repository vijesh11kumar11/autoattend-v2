"""
AutoAttend AI v2.0 — ClassPulse AI Utilities

Gemini 2.0 Flash (primary) + Groq Llama 3.3 70B (fallback).
Same pattern as routes/career.py and routes/suggestions.py.

Public functions:
  • generate_capsule_summary  — summary + key points + difficulty + topics
  • generate_capsule_quiz     — exactly 3 MCQs grounded in the source text
  • auto_answer_doubt         — first-pass AI answer for Class Wall doubts
  • extract_text_from_pdf_url — extract text from a PDF (URL or local path)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

AI_TIMEOUT_SEC = 30
PDF_TEXT_CHAR_LIMIT = 8000


# ═══════════════════════════════════════════════════════════════════════
# Low-level provider calls (sync — wrapped in asyncio.to_thread for async)
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
        logger.warning("🟡 ClassPulse Gemini call failed: %s", exc)
        return None


def _call_groq_sync(prompt: str, system: str = "You are an expert academic assistant. Return only valid JSON.") -> Optional[str]:
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
        logger.warning("🟡 ClassPulse Groq call failed: %s", exc)
        return None


def _parse_json(text: str) -> Optional[dict | list]:
    """Strip markdown fences and parse JSON; return None on failure."""
    if not text:
        return None
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to extract a JSON object/array from anywhere in the text
        for pattern in (r"\[.*\]", r"\{.*\}"):
            m = re.search(pattern, text, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group())
                except json.JSONDecodeError:
                    continue
        return None


async def _ai_json(prompt: str, system: Optional[str] = None) -> Optional[dict | list]:
    """Try Gemini → fallback Groq. Returns parsed JSON or None."""
    raw = await asyncio.to_thread(_call_gemini_sync, prompt, system)
    parsed = _parse_json(raw) if raw else None
    if parsed is not None:
        logger.info("✅ ClassPulse AI: Gemini returned valid JSON")
        return parsed

    logger.info("⚡ ClassPulse AI: Gemini failed, falling back to Groq")
    raw = await asyncio.to_thread(
        _call_groq_sync, prompt,
        system or "You are an expert academic assistant. Return only valid JSON.",
    )
    parsed = _parse_json(raw) if raw else None
    if parsed is not None:
        logger.info("✅ ClassPulse AI: Groq returned valid JSON")
    else:
        logger.warning("❌ ClassPulse AI: both providers failed")
    return parsed


# ═══════════════════════════════════════════════════════════════════════
# 1. Generate capsule summary
# ═══════════════════════════════════════════════════════════════════════

_DEFAULT_SUMMARY = {
    "summary": "",
    "key_points": [],
    "difficulty_level": "intermediate",
    "topics_covered": [],
    "estimated_read_time_min": 10,
}


async def generate_capsule_summary(file_text: str, subject_name: str, capsule_title: str) -> dict:
    """
    Returns:
      {summary: str, key_points: [str x5], difficulty_level: str,
       topics_covered: [str], estimated_read_time_min: int}
    On total failure returns _DEFAULT_SUMMARY (empty).
    """
    text = (file_text or "").strip()
    if not text:
        logger.info("📄 ClassPulse summary: no text — returning empty default")
        return dict(_DEFAULT_SUMMARY)

    snippet = text[:PDF_TEXT_CHAR_LIMIT]

    schema = """{
  "summary": "string (200-300 words, plain text, no markdown)",
  "key_points": ["string", "string", "string", "string", "string"],
  "difficulty_level": "beginner | intermediate | advanced",
  "topics_covered": ["string", ...],
  "estimated_read_time_min": integer (5-60)
}"""

    prompt = f"""You are a college subject matter expert. Read the following study material from
the subject "{subject_name}" titled "{capsule_title}" and produce a structured study aid.

Constraints:
- summary: 200-300 words, no markdown, no bullet points inside it.
- key_points: EXACTLY 5 distinct concise bullet strings (max 25 words each).
- difficulty_level: one of beginner | intermediate | advanced (judge from vocabulary & depth).
- topics_covered: 3-8 short topic labels.
- estimated_read_time_min: integer based on length & difficulty (5 to 60).

Return ONLY valid JSON matching this schema (no markdown fences):
{schema}

=== STUDY MATERIAL ===
{snippet}
=== END ==="""

    result = await _ai_json(prompt)
    if not isinstance(result, dict):
        return dict(_DEFAULT_SUMMARY)

    out = dict(_DEFAULT_SUMMARY)
    out["summary"] = str(result.get("summary", ""))[:4000]
    kp = result.get("key_points") or []
    if isinstance(kp, list):
        out["key_points"] = [str(x)[:300] for x in kp[:5]]
    diff = str(result.get("difficulty_level", "intermediate")).lower()
    if diff in ("beginner", "intermediate", "advanced"):
        out["difficulty_level"] = diff
    tc = result.get("topics_covered") or []
    if isinstance(tc, list):
        out["topics_covered"] = [str(x)[:100] for x in tc[:10]]
    try:
        rt = int(result.get("estimated_read_time_min", 10))
        out["estimated_read_time_min"] = max(1, min(120, rt))
    except (TypeError, ValueError):
        # AI returned a non-numeric read-time; keep the schema default of 10.
        logger.debug("Non-numeric estimated_read_time_min from AI; using default")
    return out


# ═══════════════════════════════════════════════════════════════════════
# 2. Generate quiz
# ═══════════════════════════════════════════════════════════════════════

def _normalise_quiz(raw) -> list[dict]:
    """Validate and clean a quiz response. Returns up to 3 valid MCQs or []."""
    if isinstance(raw, dict):
        # Some models wrap in {"questions": [...]} or {"quiz": [...]}
        for key in ("questions", "quiz", "items", "data"):
            if key in raw and isinstance(raw[key], list):
                raw = raw[key]
                break
    if not isinstance(raw, list):
        return []

    cleaned: list[dict] = []
    for item in raw[:3]:
        if not isinstance(item, dict):
            continue
        q = str(item.get("question", "")).strip()
        opts = item.get("options")
        ans = str(item.get("correct_answer", "")).strip().upper()
        expl = str(item.get("explanation", "")).strip()

        # Normalise options into {A,B,C,D}
        if isinstance(opts, list) and len(opts) >= 4:
            opts = {"A": str(opts[0]), "B": str(opts[1]), "C": str(opts[2]), "D": str(opts[3])}
        if not isinstance(opts, dict):
            continue
        opts = {k.upper(): str(v) for k, v in opts.items() if k.upper() in ("A", "B", "C", "D")}
        if set(opts.keys()) != {"A", "B", "C", "D"}:
            continue
        if ans not in ("A", "B", "C", "D"):
            continue
        if not q:
            continue
        cleaned.append({
            "question": q[:500],
            "options": {k: opts[k][:300] for k in ("A", "B", "C", "D")},
            "correct_answer": ans,
            "explanation": expl[:500],
        })
    return cleaned


async def generate_capsule_quiz(file_text: str, subject_name: str, difficulty: str = "intermediate") -> list[dict]:
    """
    Returns a list of EXACTLY 3 MCQs grounded in the actual content.
    Returns [] if AI fails entirely (caller should leave ai_quiz_json=None).
    """
    text = (file_text or "").strip()
    if not text:
        return []

    snippet = text[:PDF_TEXT_CHAR_LIMIT]
    diff = difficulty if difficulty in ("beginner", "intermediate", "advanced") else "intermediate"

    schema = """[
  {
    "question": "string",
    "options": {"A": "string", "B": "string", "C": "string", "D": "string"},
    "correct_answer": "A",
    "explanation": "string (1-2 sentences why correct)"
  },
  { ... },
  { ... }
]"""

    prompt = f"""You are a college instructor preparing a comprehension check on a study capsule
for the subject "{subject_name}" at {diff} difficulty.

Generate EXACTLY 3 multiple-choice questions strictly grounded in the material below.
Do NOT invent facts. Each question must test understanding of a concept actually present.
Each question must have 4 options labelled A, B, C, D — exactly one correct.
Vary the correct answer letter across the 3 questions when possible.
Provide a 1-2 sentence explanation for the correct answer.

Return ONLY a valid JSON array (no markdown fences) with this shape:
{schema}

=== STUDY MATERIAL ===
{snippet}
=== END ==="""

    result = await _ai_json(prompt, system="You are an expert instructor. Return only a valid JSON array of 3 MCQ items.")
    quiz = _normalise_quiz(result)
    if len(quiz) < 3:
        logger.warning("📝 ClassPulse quiz: only %d valid items generated", len(quiz))
    return quiz


# ═══════════════════════════════════════════════════════════════════════
# 3. Auto-answer a Class Wall doubt
# ═══════════════════════════════════════════════════════════════════════

async def auto_answer_doubt(question: str, subject_name: str, capsule_summary: str | None = None) -> dict:
    """
    Returns:
      {answer: str, confidence: float (0-1), needs_teacher: bool, related_topics: [str]}
    If AI fails, returns a low-confidence default that flags needs_teacher=True.
    """
    q = (question or "").strip()
    if not q:
        return {"answer": "", "confidence": 0.0, "needs_teacher": True, "related_topics": []}

    context = ""
    if capsule_summary:
        context = f"\n\nReference capsule summary:\n{capsule_summary[:2000]}\n"

    schema = """{
  "answer": "string (concise 60-180 word academic answer)",
  "confidence": float between 0.0 and 1.0,
  "needs_teacher": boolean,
  "related_topics": ["string", ...]
}"""

    prompt = f"""You are a college teaching assistant for the subject "{subject_name}".
A student posted the following doubt. Answer it accurately and concisely.

Important rules:
- If you are not confident the answer is correct or the question is ambiguous,
  set confidence < 0.6 and needs_teacher = true.
- If question is off-topic or unclear, confidence must be < 0.4.
- Otherwise, confidence reflects how strongly grounded the answer is.
- related_topics: 2-4 short labels.
{context}
=== STUDENT DOUBT ===
{q}
=== END ===

Return ONLY valid JSON (no markdown fences):
{schema}"""

    result = await _ai_json(prompt, system="You are a precise academic tutor. Return only valid JSON.")
    if not isinstance(result, dict):
        return {"answer": "", "confidence": 0.0, "needs_teacher": True, "related_topics": []}

    answer = str(result.get("answer", "")).strip()[:2000]
    try:
        conf = float(result.get("confidence", 0.0))
    except (TypeError, ValueError):
        conf = 0.0
    conf = max(0.0, min(1.0, conf))
    needs_teacher = bool(result.get("needs_teacher", True)) or conf < 0.6
    rt = result.get("related_topics") or []
    related = [str(x)[:80] for x in rt[:6]] if isinstance(rt, list) else []

    return {
        "answer": answer,
        "confidence": round(conf, 2),
        "needs_teacher": needs_teacher,
        "related_topics": related,
    }


# ═══════════════════════════════════════════════════════════════════════
# 4. PDF text extraction
# ═══════════════════════════════════════════════════════════════════════

async def extract_text_from_pdf_url(file_url: str) -> str:
    """
    Download the PDF (or read local file) and extract the first PDF_TEXT_CHAR_LIMIT
    characters of plain text using PyMuPDF (fitz). Returns "" on any failure.
    """
    if not file_url:
        return ""

    try:
        # Local file path support (preferred since we save uploads locally)
        if not file_url.lower().startswith(("http://", "https://")):
            local_path = file_url
            if not os.path.isabs(local_path):
                local_path = os.path.abspath(local_path)
            if not os.path.isfile(local_path):
                logger.warning("📄 PDF extract: file not found %s", local_path)
                return ""
            with open(local_path, "rb") as fh:
                data = fh.read()
        else:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(file_url)
                resp.raise_for_status()
                data = resp.content

        try:
            import fitz  # PyMuPDF
        except ImportError:
            logger.error("📄 PyMuPDF (fitz) not installed — install PyMuPDF")
            return ""

        text_parts: list[str] = []
        with fitz.open(stream=data, filetype="pdf") as doc:
            for page in doc:
                text_parts.append(page.get_text("text"))
                if sum(len(p) for p in text_parts) >= PDF_TEXT_CHAR_LIMIT:
                    break
        full = "\n".join(text_parts)
        return full[:PDF_TEXT_CHAR_LIMIT]
    except Exception as exc:
        logger.warning("📄 PDF text extraction failed for %s: %s", file_url, exc)
        return ""
