"""
AutoAttend AI v2.0 — SMS Utility (MSG91 Flow API)

Sends transactional SMS via MSG91 Flow API.
Requires a pre-approved DLT template registered as a Flow on MSG91.
"""

import logging

import requests as http_requests

from config import settings

logger = logging.getLogger(__name__)


def send_sms(phone: str, variables: dict, flow_id: str | None = None) -> dict:
    """
    Send an SMS via MSG91 Flow API.

    Args:
        phone:     Recipient phone (E.164 or 10-digit Indian).
        variables: Dict of template variables e.g. {"student_name": "Vijesh", "attendance_pct": "50"}.
        flow_id:   Optional override for MSG91 flow ID.

    Returns:
        {"ok": True}  on success
        {"ok": False, "error": "<reason>"}  on failure
    """
    fid = flow_id or settings.MSG91_SMS_FLOW_ID
    if not fid or fid == "will_add_later":
        return {"ok": False, "error": "MSG91_SMS_FLOW_ID not configured"}

    # Normalize phone to MSG91 format: 91XXXXXXXXXX
    cleaned = phone.strip().replace(" ", "").replace("-", "").lstrip("+")
    if len(cleaned) == 10:
        cleaned = "91" + cleaned
    elif cleaned.startswith("91") and len(cleaned) == 12:
        pass  # already correct
    elif cleaned.startswith("+91"):
        cleaned = cleaned[1:]

    recipient = {"mobiles": cleaned}
    recipient.update(variables)

    payload = {
        "flow_id": fid,
        "recipients": [recipient],
    }

    try:
        resp = http_requests.post(
            "https://control.msg91.com/api/v5/flow/",
            json=payload,
            headers={
                "authkey": settings.MSG91_AUTH_KEY,
                "Content-Type": "application/json",
            },
            timeout=10,
        )

        if resp.status_code in (200, 201):
            data = resp.json()
            if data.get("type") == "success":
                return {"ok": True}
            return {"ok": False, "error": data.get("message", "Unknown MSG91 error")}
        return {"ok": False, "error": resp.text[:200]}
    except Exception as exc:
        logger.error("MSG91 SMS send failed: %s", exc)
        return {"ok": False, "error": str(exc)}
