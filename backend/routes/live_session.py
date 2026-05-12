"""
ClassPulse Live — REST API routes (stub).

The full route surface (create session, join, heartbeat, pulse-check,
breakouts, etc.) will land in the next prompt. This stub is registered
in main.py so the router import does not break and so the foundation
prompt can be merged independently.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/live", tags=["live-session"])


@router.get("/health")
def live_session_health():
    """Quick probe to confirm the live-session router is mounted."""
    return {"status": "ok", "module": "live-session", "stage": "foundation"}
