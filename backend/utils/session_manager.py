"""
Live-session WebSocket connection manager (Prompt 3).

Tracks one WebSocket per (session_id, user_id) and offers helpers to
broadcast real-time events to a single user, the teacher, or every
participant in a session.

Message-type catalogue is documented in ``docs/live_websocket_events.md``
(see the end of this file for the canonical list).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Iterable, Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class SessionConnectionManager:
    def __init__(self) -> None:
        # {session_id: {user_id: WebSocket}}
        self.active_connections: dict[int, dict[int, WebSocket]] = {}
        # {session_id: teacher_id}
        self._teachers: dict[int, int] = {}
        self._lock = asyncio.Lock()

    # ── connection lifecycle ────────────────────────────────────────────
    async def connect(
        self,
        websocket: WebSocket,
        session_id: int,
        user_id: int,
        is_teacher: bool = False,
        subprotocol: str | None = None,
    ) -> None:
        await websocket.accept(subprotocol=subprotocol) if subprotocol else await websocket.accept()
        async with self._lock:
            self.active_connections.setdefault(session_id, {})[user_id] = websocket
            if is_teacher:
                self._teachers[session_id] = user_id
        logger.info(
            "WS connect │ session=%s │ user=%s │ teacher=%s │ total=%s",
            session_id,
            user_id,
            is_teacher,
            len(self.active_connections.get(session_id, {})),
        )

    def disconnect(self, session_id: int, user_id: int) -> None:
        users = self.active_connections.get(session_id)
        if not users:
            return
        users.pop(user_id, None)
        if not users:
            self.active_connections.pop(session_id, None)
            self._teachers.pop(session_id, None)
        logger.info("WS disconnect │ session=%s │ user=%s", session_id, user_id)

    # ── outbound helpers ────────────────────────────────────────────────
    async def _safe_send(self, ws: WebSocket, message: dict) -> bool:
        try:
            await ws.send_json(message)
            return True
        except Exception as exc:  # pragma: no cover
            logger.debug("WS send failed: %s", exc)
            return False

    async def send_to_user(self, session_id: int, user_id: int, message: dict) -> bool:
        ws = self.active_connections.get(session_id, {}).get(user_id)
        if not ws:
            return False
        return await self._safe_send(ws, message)

    async def send_to_teacher(self, session_id: int, message: dict) -> bool:
        teacher_id = self._teachers.get(session_id)
        if not teacher_id:
            return False
        return await self.send_to_user(session_id, teacher_id, message)

    async def broadcast_to_session(
        self,
        session_id: int,
        message: dict,
        exclude_user_ids: Optional[Iterable[int]] = None,
    ) -> int:
        excluded = set(exclude_user_ids or [])
        users = self.active_connections.get(session_id, {})
        if not users:
            return 0
        sent = 0
        for uid, ws in list(users.items()):
            if uid in excluded:
                continue
            if await self._safe_send(ws, message):
                sent += 1
        return sent

    async def broadcast_to_students(self, session_id: int, message: dict) -> int:
        teacher_id = self._teachers.get(session_id)
        return await self.broadcast_to_session(
            session_id, message, exclude_user_ids=[teacher_id] if teacher_id else None
        )

    # ── introspection ───────────────────────────────────────────────────
    def participants(self, session_id: int) -> list[int]:
        return list(self.active_connections.get(session_id, {}).keys())

    def teacher_id(self, session_id: int) -> Optional[int]:
        return self._teachers.get(session_id)


# Module-level singleton — import this from main.py / route handlers.
manager = SessionConnectionManager()


# ─────────────────────────────────────────────────────────────────────────
# Canonical WebSocket message catalogue (kept in code for grep-ability)
# ─────────────────────────────────────────────────────────────────────────
# Server → Teacher:
#   {"type": "ai_observation",   "observation": str, "category": str, "affected_students": list}
#   {"type": "ai_intervention",  "suggestion": str, "action_type": str, "urgency": str}
#   {"type": "hot_doubt",        "doubt_id": int, "question": str, "resonance_count": int}
#   {"type": "pulse_update",     "pulse_id": int, "total_responses": int, "distribution": dict}
#   {"type": "student_joined",   "student_name": str, "total_count": int}
#   {"type": "student_left",     "student_name": str, "total_count": int}
#   {"type": "bandwidth_alert",  "student_name": str, "quality": str}
#   {"type": "liveness_failed",  "student_id": int, "student_name": str}
#
# Server → Student:
#   {"type": "pulse_check",       "pulse_id": int, "question": str, "options": dict, "duration": int}
#   {"type": "pulse_closed",      "pulse_id": int, "correct_answer": str, "your_answer": str, "explanation": str}
#   {"type": "new_doubt",         "doubt_id": int, "question": str, "resonance_count": int}
#   {"type": "doubt_answered",    "doubt_id": int, "answer": str, "answered_by": str}
#   {"type": "micro_summary",     "text": str, "key_term": str}
#   {"type": "liveness_challenge","challenge_token": str, "button_position": dict}
#   {"type": "session_ending",    "minutes_remaining": int}
#   {"type": "breakout_assigned", "room_id": int, "room_name": str, "participants": list}
#
# Server → All:
#   {"type": "session_started",   "teacher_name": str}
#   {"type": "session_ended",     "duration_minutes": int}
#   {"type": "breakout_ended",    "message": str}
