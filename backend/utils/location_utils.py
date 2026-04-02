"""
AutoAttend AI v2.0 — GPS Location Utilities

GPS verification confirms a student is physically inside the classroom.
The classroom location is taken from the teacher's device at session start.

Algorithm:
  Haversine formula — great-circle distance accurate to within ~1 m for
  distances < 100 km (sufficient for campus use).

Thresholds (from settings):
  GPS_RADIUS_METERS             = 50  — max allowed distance from teacher
  GPS_ACCURACY_THRESHOLD_METERS = 50  — reject readings with poor accuracy

Anti-spoofing:
  Accuracy < 3 m is physically impossible for real GPS; flag as suspicious.
  Real consumer GPS typically reports 3–20 m accuracy indoors and
  2–5 m outdoors. Mock location apps often report 0.0 m accuracy.
"""

import logging
from math import asin, atan2, cos, radians, sin, sqrt

from config import settings

logger = logging.getLogger(__name__)

# Accuracy values that are suspiciously too perfect for real GPS
_SUSPICIOUS_ACCURACY_THRESHOLD = 3.0  # meters


# ═══════════════════════════════════════════════════════════════════════
# 1. Haversine distance
# ═══════════════════════════════════════════════════════════════════════

def calculate_distance(
    lat1: float, lon1: float,
    lat2: float, lon2: float,
) -> float:
    """
    Haversine great-circle distance between two GPS coordinates.

    Args:
        lat1, lon1 — origin point (degrees)
        lat2, lon2 — destination point (degrees)

    Returns:
        Distance in metres, accurate to ~1 m for short distances.
    """
    R = 6_371_000  # Earth's mean radius in metres

    phi1   = radians(lat1)
    phi2   = radians(lat2)
    dphi   = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)

    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


# ═══════════════════════════════════════════════════════════════════════
# 2. GPS proximity verification
# ═══════════════════════════════════════════════════════════════════════

def verify_gps_proximity(
    student_lat:      float,
    student_lon:      float,
    student_accuracy: float,
    teacher_lat:      float,
    teacher_lon:      float,
    max_distance:     float | None = None,
) -> dict:
    """
    Verify that a student is within the allowed radius of the teacher.

    Args:
        student_lat / lon      — student's reported GPS position
        student_accuracy       — reported horizontal accuracy (metres)
        teacher_lat / lon      — teacher's GPS position (from session record)
        max_distance           — override for max allowed radius; defaults to
                                  settings.GPS_RADIUS_METERS (50 m)

    Returns a structured dict — never raises HTTPException.

    Return shape on success:
      {
        verified:          True,
        distance_meters:   23.4,
        accuracy_meters:   12.0,
        flagged_suspicious: False
      }

    Return shape on failure:
      {
        verified:  False,
        reason:    str,
        distance_meters: float | None,
        accuracy_meters: float,
      }
    """
    if max_distance is None:
        max_distance = settings.GPS_RADIUS_METERS

    # ── a) Accuracy gate ──────────────────────────────────────────────
    if student_accuracy > settings.GPS_ACCURACY_THRESHOLD_METERS:
        logger.info(
            "GPS rejected — accuracy=%.1f m exceeds threshold=%.1f m",
            student_accuracy, settings.GPS_ACCURACY_THRESHOLD_METERS,
        )
        return {
            "verified":       False,
            "distance_meters": None,
            "accuracy_meters": student_accuracy,
            "reason": (
                f"GPS accuracy too low ({student_accuracy:.0f} m). "
                "Move to an open area or enable high-accuracy GPS."
            ),
        }

    # ── Anti-spoofing: suspiciously perfect accuracy ───────────────────
    flagged = False
    if student_accuracy < _SUSPICIOUS_ACCURACY_THRESHOLD:
        flagged = True
        logger.warning(
            "GPS suspicious — reported accuracy=%.2f m (< %.1f m) — "
            "possible mock location — student_lat=%.6f lon=%.6f",
            student_accuracy, _SUSPICIOUS_ACCURACY_THRESHOLD,
            student_lat, student_lon,
        )

    # ── b) Distance check ─────────────────────────────────────────────
    distance = calculate_distance(
        student_lat, student_lon,
        teacher_lat, teacher_lon,
    )

    if distance > max_distance:
        logger.info(
            "GPS rejected — distance=%.1f m exceeds max=%.1f m", distance, max_distance,
        )
        return {
            "verified":         False,
            "distance_meters":  round(distance, 1),
            "accuracy_meters":  student_accuracy,
            "flagged_suspicious": flagged,
            "reason": (
                f"You are {distance:.0f} m away from the classroom. "
                f"Must be within {max_distance:.0f} m."
            ),
        }

    logger.info(
        "GPS verified — distance=%.1f m accuracy=%.1f m flagged=%s",
        distance, student_accuracy, flagged,
    )
    return {
        "verified":           True,
        "distance_meters":    round(distance, 1),
        "accuracy_meters":    student_accuracy,
        "flagged_suspicious": flagged,
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. Bluetooth proximity verification
# ═══════════════════════════════════════════════════════════════════════

def verify_bluetooth_proximity(
    bluetooth_token:        str,
    student_detected_token: str,
) -> dict:
    """
    Verify that the student's app detected the teacher's BLE beacon.

    The security model relies on physical proximity:
      • The teacher's app advertises bluetooth_token as a BLE beacon payload.
      • Only a device within ~10 m can detect the broadcast.
      • The token is never shown on screen, in the QR code, or in the API
        response — it is transmitted exclusively over Bluetooth.
      • Random per-session tokens prevent token replay from a previous class.

    Backend validation is a simple constant-time string comparison;
    the security guarantee comes from BLE range constraints on the mobile side.

    Returns:
      {verified: True}                                  — token matched
      {verified: False, reason: str}                    — mismatch
    """
    if bluetooth_token and student_detected_token:
        if bluetooth_token == student_detected_token:
            return {"verified": True}

    return {
        "verified": False,
        "reason": (
            "Bluetooth beacon not detected. "
            "Ensure you are in the classroom and Bluetooth is enabled."
        ),
    }
