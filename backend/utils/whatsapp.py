"""
AutoAttend AI v2.0 — WhatsApp Utility (MSG91 primary, Twilio fallback)

Reusable helper for sending WhatsApp messages. Used by routes/alerts.py,
routes/faculty.py, routes/classpulse.py, routes/tutor.py and
utils/live_notifications.py.

Provider order:
  1. MSG91 WhatsApp (template API) — used when MSG91_AUTH_KEY +
     MSG91_WHATSAPP_INTEGRATED_NUMBER + MSG91_WHATSAPP_TEMPLATE_NAME are set.
  2. Twilio WhatsApp — used as a fallback when Twilio credentials are set.
  3. Neither configured → logged no-op (never raises) so callers keep
     working unchanged.

The public `send_whatsapp_message(phone, message)` signature is unchanged.
"""

import base64
import logging

import requests as http_requests

from config import settings

logger = logging.getLogger(__name__)

# Placeholder values that mean "not really configured".
_PLACEHOLDERS = {"", "will_add_later", "changeme", "your_sid", "your_token"}


# ─────────────────────────────────────────────────────────────────────
# Provider availability + phone helpers
# ─────────────────────────────────────────────────────────────────────


def _is_msg91_whatsapp_configured() -> bool:
    return (
        (settings.MSG91_AUTH_KEY or "").strip() not in _PLACEHOLDERS
        and (settings.MSG91_WHATSAPP_INTEGRATED_NUMBER or "").strip() not in _PLACEHOLDERS
        and (settings.MSG91_WHATSAPP_TEMPLATE_NAME or "").strip() not in _PLACEHOLDERS
    )


def _is_twilio_configured() -> bool:
    sid = (settings.TWILIO_ACCOUNT_SID or "").strip()
    tok = (settings.TWILIO_AUTH_TOKEN or "").strip()
    return (
        sid.lower() not in _PLACEHOLDERS
        and tok.lower() not in _PLACEHOLDERS
        and sid.startswith("AC")
    )


def _to_msg91_number(phone: str) -> str:
    """Normalise to MSG91 format ``91XXXXXXXXXX`` (digits only, no +)."""
    cleaned = (phone or "").strip().replace(" ", "").replace("-", "").lstrip("+")
    if cleaned.startswith("91") and len(cleaned) == 12:
        return cleaned
    if cleaned.startswith("0") and len(cleaned) == 11:
        return "91" + cleaned[1:]
    if len(cleaned) == 10:
        return "91" + cleaned
    return cleaned


def _to_e164(phone: str) -> str:
    """Normalise to E.164 ``+...`` for Twilio."""
    phone = (phone or "").strip()
    return phone if phone.startswith("+") else "+" + phone


# ─────────────────────────────────────────────────────────────────────
# Providers
# ─────────────────────────────────────────────────────────────────────


def _send_via_msg91(phone: str, message: str, recipient_name: str = "") -> dict:
    """Send a WhatsApp message via the MSG91 WhatsApp template API."""
    try:
        recipient = _to_msg91_number(phone)
        name = (recipient_name or "Friend").strip()
        template = {
            "name": settings.MSG91_WHATSAPP_TEMPLATE_NAME,
            "language": {
                "code": settings.MSG91_WHATSAPP_LANG_CODE or "en_US",
                "policy": "deterministic",
            },
            "to_and_components": [
                {
                    "to": [recipient],
                    "components": {
                        "body_1": {"type": "text", "value": name},
                        "body_2": {"type": "text", "value": message},
                    },
                }
            ],
        }
        namespace = (settings.MSG91_WHATSAPP_NAMESPACE or "").strip()
        if namespace:
            template["namespace"] = namespace

        resp = http_requests.post(
            "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
            headers={
                "authkey": settings.MSG91_AUTH_KEY,
                "Content-Type": "application/json",
            },
            json={
                "integrated_number": settings.MSG91_WHATSAPP_INTEGRATED_NUMBER,
                "content_type": "template",
                "payload": {
                    "messaging_product": "whatsapp",
                    "type": "template",
                    "template": template,
                },
            },
            timeout=10,
        )
        if resp.status_code in (200, 202):
            try:
                body = resp.json()
            except ValueError:
                body = {}
            return {"ok": True, "sid": body.get("request_id") or body.get("requestId")}
        return {"ok": False, "error": f"MSG91 WhatsApp error ({resp.status_code}): {resp.text}"}
    except Exception as exc:
        logger.error("MSG91 WhatsApp send failed: %s", exc)
        return {"ok": False, "error": str(exc)}


def _send_via_twilio(phone: str, message: str) -> dict:
    """Send a WhatsApp message via Twilio (fallback provider)."""
    try:
        credentials = base64.b64encode(
            f"{settings.TWILIO_ACCOUNT_SID}:{settings.TWILIO_AUTH_TOKEN}".encode()
        ).decode()

        resp = http_requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/"
            f"{settings.TWILIO_ACCOUNT_SID}/Messages.json",
            headers={"Authorization": f"Basic {credentials}"},
            data={
                "From": settings.TWILIO_WHATSAPP_FROM,
                "To": f"whatsapp:{_to_e164(phone)}",
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


# ─────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────


def send_whatsapp_message(phone: str, message: str, recipient_name: str = "") -> dict:
    """
    Send a WhatsApp message using MSG91 (primary) with Twilio fallback.

    Args:
        phone:          Recipient phone number (E.164 or 10/12-digit Indian number).
        message:        Message body (maps to {{2}} in the MSG91 template).
        recipient_name: Recipient's display name (maps to {{1}} in the MSG91 template).
                        Falls back to "Friend" if not provided.

    Returns:
        {"ok": True,  "sid": "<provider_message_id>"}  on success
        {"ok": False, "error": "<reason>"}             on failure / no provider
    """
    if not phone or not str(phone).strip():
        return {"ok": False, "error": "No phone number"}

    msg91_ready = _is_msg91_whatsapp_configured()
    twilio_ready = _is_twilio_configured()

    if msg91_ready:
        result = _send_via_msg91(phone, message, recipient_name)
        if result.get("ok"):
            return result
        if twilio_ready:
            logger.warning(
                "MSG91 WhatsApp failed (%s) — falling back to Twilio", result.get("error")
            )
            return _send_via_twilio(phone, message)
        return result

    if twilio_ready:
        return _send_via_twilio(phone, message)

    logger.warning(
        "WhatsApp not sent — no provider configured "
        "(set MSG91 WhatsApp template/number or Twilio creds)."
    )
    return {"ok": False, "error": "WhatsApp provider not configured"}


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
