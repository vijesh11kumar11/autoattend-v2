"""
Agora RTC token utility (Prompt 3).

We use the official `agora-token-builder` package when available. If the
package is not installed or credentials are missing the helpers degrade
gracefully — the join endpoint still works, the frontend simply gets an
empty `token` and `app_id` and falls back to its placeholder UI.
"""

from __future__ import annotations

import logging
import time
from typing import Literal

from config import settings

logger = logging.getLogger(__name__)

# Optional import — keep startup safe even if the package is missing.
try:
    from agora_token_builder import RtcTokenBuilder  # type: ignore

    _HAS_AGORA = True
except Exception as exc:  # pragma: no cover
    RtcTokenBuilder = None  # type: ignore
    _HAS_AGORA = False
    logger.warning(
        "agora_token_builder not available (%s) — live sessions will use "
        "placeholder Agora tokens.",
        exc,
    )


# Agora SDK role constants (publisher = 1, subscriber = 2).
_ROLE_PUBLISHER = 1
_ROLE_SUBSCRIBER = 2


def _agora_uid(uid: int) -> int:
    """Agora UIDs must fit in 32-bit unsigned. 0 is reserved (auto-assign)."""
    if uid is None or uid <= 0:
        # Random non-zero uid for guests
        return int(time.time() * 1000) % 0x7FFFFFFE + 1
    return int(uid) & 0x7FFFFFFF


def generate_agora_token(
    channel_name: str,
    uid: int,
    role: Literal["publisher", "subscriber"] = "subscriber",
    expiry_seconds: int = 3600,
) -> dict:
    """
    Build a single-use RTC token for the given channel + uid.

    Returns a dict with everything the frontend needs to bootstrap Agora:
        {
          "provider": "agora",
          "app_id":   "<APP_ID or empty string>",
          "channel":  channel_name,
          "uid":      <int>,
          "role":     "publisher" | "subscriber",
          "token":    "<jwt-like token or empty>",
          "expires_in": seconds,
        }
    """
    app_id = getattr(settings, "AGORA_APP_ID", "") or ""
    app_cert = getattr(settings, "AGORA_APP_CERTIFICATE", "") or ""

    safe_uid = _agora_uid(uid)
    role_value = _ROLE_PUBLISHER if role == "publisher" else _ROLE_SUBSCRIBER
    expire_ts = int(time.time()) + max(60, int(expiry_seconds))

    token = ""
    if _HAS_AGORA and app_id and app_cert and channel_name:
        try:
            token = RtcTokenBuilder.buildTokenWithUid(  # type: ignore[attr-defined]
                app_id, app_cert, channel_name, safe_uid, role_value, expire_ts
            )
        except Exception as exc:  # pragma: no cover
            logger.warning("Agora token generation failed: %s", exc)
            token = ""

    return {
        "provider": "agora",
        "app_id": app_id,
        "channel": channel_name,
        "uid": safe_uid,
        "role": role,
        "token": token,
        "expires_in": expiry_seconds,
    }


def is_agora_configured() -> bool:
    return bool(getattr(settings, "AGORA_APP_ID", "")) and bool(
        getattr(settings, "AGORA_APP_CERTIFICATE", "")
    )
