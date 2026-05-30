"""
AutoAttend AI v2.0 — WhatsApp Utility (Twilio)

Reusable helper for sending WhatsApp messages via the Twilio API.
Used by routes/alerts.py (and anywhere else that needs WhatsApp).
"""

import base64
import logging

import requests as http_requests

from config import settings

logger = logging.getLogger(__name__)


def send_whatsapp_message(phone: str, message: str) -> dict:
    """
    Send a WhatsApp message via Twilio.

    Args:
        phone:   Recipient phone number (E.164 format, e.g. "+919876543210").
        message: Message body (max 1600 chars).

    Returns:
        {"ok": True,  "sid": "<twilio_message_sid>"}  on success
        {"ok": False, "error": "<reason>"}             on failure
    """
    try:
        phone = phone.strip()
        if not phone.startswith("+"):
            phone = "+" + phone

        credentials = base64.b64encode(
            f"{settings.TWILIO_ACCOUNT_SID}:{settings.TWILIO_AUTH_TOKEN}".encode()
        ).decode()

        resp = http_requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/"
            f"{settings.TWILIO_ACCOUNT_SID}/Messages.json",
            headers={"Authorization": f"Basic {credentials}"},
            data={
                "From": settings.TWILIO_WHATSAPP_FROM,
                "To": f"whatsapp:{phone}",
                "Body": message,
            },
            timeout=10,
        )

        if resp.status_code in (200, 201):
            return {"ok": True, "sid": resp.json().get("sid")}
        return {"ok": False, "error": resp.json().get("message", "Twilio error")}
    except Exception as exc:
        logger.error("Twilio WhatsApp send failed: %s", exc)
        return {"ok": False, "error": str(exc)}


def send_bulk_whatsapp(recipients: list[dict], message: str) -> list[dict]:
    """
    Send the same WhatsApp message to multiple recipients.

    Args:
        recipients: List of dicts with at least {"phone": "...", "student_id": ...}
        message:    Message body.

    Returns:
        List of result dicts per recipient.
    """
    results = []
    for r in recipients:
        phone = r.get("phone")
        if not phone:
            results.append(
                {
                    "student_id": r.get("student_id"),
                    "status": "skipped",
                    "reason": "No phone number",
                }
            )
            continue

        wa = send_whatsapp_message(phone, message)
        results.append(
            {
                "student_id": r.get("student_id"),
                "status": "sent" if wa["ok"] else "failed",
                "sid": wa.get("sid"),
                "reason": wa.get("error"),
            }
        )
    return results
