"""
AutoAttend AI v2.0 — SMS Utility (Fast2SMS Quick Route)

Sends transactional SMS via Fast2SMS Quick SMS API.
No DLT registration needed for quick route.
"""

import logging

import requests as http_requests

from config import settings

logger = logging.getLogger(__name__)


def send_sms(phone: str, message: str) -> dict:
    """
    Send an SMS via Fast2SMS Quick Route.

    Args:
        phone:   Recipient phone (E.164, +91XXXXXXXXXX, or 10-digit).
        message: Plain text message body.

    Returns:
        {"ok": True}  on success
        {"ok": False, "error": "<reason>"}  on failure
    """
    api_key = settings.FAST2SMS_API_KEY
    if not api_key or api_key == "will_add_later":
        # In production we MUST log loudly — silent SMS failures were
        # leaving parent-alert / OTP flows broken with no visibility.
        if not settings.DEBUG:
            logger.error(
                "SMS NOT SENT — FAST2SMS_API_KEY missing/placeholder in production │ to=%s***",
                phone[:3] if phone else "?",
            )
        else:
            logger.warning("SMS skipped (FAST2SMS_API_KEY not configured) — DEBUG mode")
        return {"ok": False, "error": "FAST2SMS_API_KEY not configured"}

    # Normalize to 10-digit Indian number.
    # Reject inputs that are absurdly long up-front (defence vs payload abuse).
    if not isinstance(phone, str) or len(phone) > 32:
        return {"ok": False, "error": "Invalid phone: too long or not a string"}
    cleaned = phone.strip().replace(" ", "").replace("-", "").lstrip("+")
    if cleaned.startswith("91") and len(cleaned) == 12:
        cleaned = cleaned[2:]
    if len(cleaned) != 10 or not cleaned.isdigit():
        return {"ok": False, "error": f"Invalid phone: {phone}"}

    try:
        resp = http_requests.post(
            "https://www.fast2sms.com/dev/bulkV2",
            headers={"authorization": api_key},
            data={
                "route": "q",
                "message": message,
                "numbers": cleaned,
                "flash": "0",
            },
            timeout=10,
        )

        data = resp.json()
        if data.get("return") is True:
            logger.info("SMS sent to %s***", cleaned[:4])
            return {"ok": True}
        return {"ok": False, "error": data.get("message", "Fast2SMS error")}
    except Exception as exc:
        logger.error("Fast2SMS send failed: %s", exc)
        return {"ok": False, "error": str(exc)}
