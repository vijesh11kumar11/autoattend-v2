"""
AutoAttend AI v2.0 — Claude (Anthropic) provider helper.

Single shared, dependency-free (httpx-only) entry point used by every AI
feature as the PRIMARY provider. Gemini / Groq / DeepSeek remain automatic
fallbacks in each caller — this module only adds Claude in front of them.

Design:
  • Haiku-only models (cost-optimised — never Opus/Sonnet). Two logical
    tiers, both configurable via env:
       SMART → JSON / reasoning tasks (reports, roadmaps, analysis)
       FAST  → short text tasks (observations, pulse questions)
  • Sync function (callers wrap it in asyncio.to_thread where needed).
  • Never raises: any error / missing key returns None so the caller falls
    through to the next provider exactly as before.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
CLAUDE_TIMEOUT_SEC = 30

# Tier selectors — passed as the `tier` arg to call_claude_sync.
SMART = "smart"
FAST = "fast"


def _model_for_tier(tier: str) -> str:
    if tier == FAST:
        return settings.CLAUDE_MODEL_FAST or settings.CLAUDE_MODEL_SMART
    return settings.CLAUDE_MODEL_SMART


def call_claude_sync(
    prompt: str,
    system: Optional[str] = None,
    tier: str = SMART,
    max_tokens: int = 2048,
    temperature: float = 0.5,
) -> Optional[str]:
    """
    Call Claude (Anthropic Messages API) and return the text response.

    Returns None on missing key, non-2xx, or any exception so the caller can
    fall back to the next provider. Never raises.
    """
    api_key = settings.CLAUDE_API_KEY
    if not api_key:
        return None

    model = _model_for_tier(tier)
    headers = {
        "x-api-key": api_key,
        "anthropic-version": _ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    payload: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        payload["system"] = system

    try:
        with httpx.Client(timeout=CLAUDE_TIMEOUT_SEC) as client:
            r = client.post(_ANTHROPIC_URL, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
        parts = [
            block.get("text", "")
            for block in data.get("content", [])
            if block.get("type") == "text"
        ]
        text = "".join(parts).strip()
        return text or None
    except Exception as exc:
        logger.warning("🟣 Claude call failed (model=%s): %s", model, exc)
        return None
