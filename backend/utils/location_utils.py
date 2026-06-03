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
from datetime import UTC, datetime
from math import atan2, cos, radians, sin, sqrt

from config import settings

logger = logging.getLogger(__name__)

# Accuracy values that are suspiciously too perfect for real GPS
_SUSPICIOUS_ACCURACY_THRESHOLD = 3.0  # meters
# Hard ceiling on plausible human ground-speed between two GPS readings.
# 30 m/s ≈ 108 km/h — covers running, cycling, city driving without false-positives.
_MAX_PLAUSIBLE_SPEED_MPS = 30.0


# ═══════════════════════════════════════════════════════════════════════
# 1. Haversine distance
# ═══════════════════════════════════════════════════════════════════════


def calculate_distance(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
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

    phi1 = radians(lat1)
    phi2 = radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)

    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


# ═══════════════════════════════════════════════════════════════════════
# 2. GPS proximity verification
# ═══════════════════════════════════════════════════════════════════════


def verify_gps_proximity(
    student_lat: float,
    student_lon: float,
    student_accuracy: float,
    teacher_lat: float,
    teacher_lon: float,
    max_distance: float | None = None,
    mock_location_detected: bool = False,
    previous_lat: float | None = None,
    previous_lon: float | None = None,
    previous_recorded_at: datetime | None = None,
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

    logger.info(
        "🌐 GPS VERIFY │ student=(%.6f, %.6f) accuracy=%.1f m │ teacher=(%.6f, %.6f) │ max_distance=%.0f m",
        student_lat,
        student_lon,
        student_accuracy,
        teacher_lat,
        teacher_lon,
        max_distance,
    )

    # ── 0) Hard-reject if client reported a mock-location provider ──────
    if mock_location_detected:
        logger.warning(
            "GPS rejected — mock_location_detected=True │ student=(%.6f, %.6f)",
            student_lat,
            student_lon,
        )
        return {
            "verified": False,
            "distance_meters": None,
            "accuracy_meters": student_accuracy,
            "flagged_suspicious": True,
            "reason": (
                "Mock location detected on this device. "
                "Disable any fake-GPS or developer location overrides and try again."
            ),
        }

    # ── a) Accuracy gate ──────────────────────────────────────────────
    if student_accuracy > settings.GPS_ACCURACY_THRESHOLD_METERS:
        logger.info(
            "GPS rejected — accuracy=%.1f m exceeds threshold=%.1f m",
            student_accuracy,
            settings.GPS_ACCURACY_THRESHOLD_METERS,
        )
        return {
            "verified": False,
            "distance_meters": None,
            "accuracy_meters": student_accuracy,
            "reason": (
                f"GPS accuracy too low ({student_accuracy:.0f} m). "
                "Move to an open area or enable high-accuracy GPS."
            ),
        }

    # ── Anti-spoofing: suspiciously perfect accuracy → hard reject ──────
    if student_accuracy < _SUSPICIOUS_ACCURACY_THRESHOLD:
        logger.warning(
            "GPS rejected — reported accuracy=%.2f m (< %.1f m) — "
            "likely mock location — student_lat=%.6f lon=%.6f",
            student_accuracy,
            _SUSPICIOUS_ACCURACY_THRESHOLD,
            student_lat,
            student_lon,
        )
        return {
            "verified": False,
            "distance_meters": None,
            "accuracy_meters": student_accuracy,
            "flagged_suspicious": True,
            "reason": (
                "Suspicious GPS reading (accuracy too perfect). "
                "Disable any mock-location app and try again."
            ),
        }

    # ── a2) Velocity / teleport check vs previous snapshot ─────────────
    if previous_lat is not None and previous_lon is not None and previous_recorded_at is not None:
        prev_dist = calculate_distance(
            previous_lat,
            previous_lon,
            student_lat,
            student_lon,
        )
        now = datetime.now(tz=UTC)
        prev_ts = previous_recorded_at
        if prev_ts.tzinfo is None:
            prev_ts = prev_ts.replace(tzinfo=UTC)
        dt = max(1.0, (now - prev_ts).total_seconds())
        speed = prev_dist / dt
        if speed > _MAX_PLAUSIBLE_SPEED_MPS:
            logger.warning(
                "GPS rejected — impossible movement │ distance=%.1f m in %.1f s → %.1f m/s (>%.0f)",
                prev_dist,
                dt,
                speed,
                _MAX_PLAUSIBLE_SPEED_MPS,
            )
            return {
                "verified": False,
                "distance_meters": None,
                "accuracy_meters": student_accuracy,
                "flagged_suspicious": True,
                "reason": (
                    f"Impossible movement detected ({speed:.0f} m/s). "
                    "Your location moved too far too quickly — possible GPS spoofing."
                ),
            }

    flagged = False

    # ── b) Distance check ─────────────────────────────────────────────
    distance = calculate_distance(
        student_lat,
        student_lon,
        teacher_lat,
        teacher_lon,
    )

    if distance > max_distance:
        logger.info(
            "GPS rejected — distance=%.1f m exceeds max=%.1f m",
            distance,
            max_distance,
        )
        return {
            "verified": False,
            "distance_meters": round(distance, 1),
            "accuracy_meters": student_accuracy,
            "flagged_suspicious": flagged,
            "reason": (
                f"You are {distance:.0f} m away from the classroom. "
                f"Must be within {max_distance:.0f} m."
            ),
        }

    logger.info(
        "GPS verified — distance=%.1f m accuracy=%.1f m flagged=%s",
        distance,
        student_accuracy,
        flagged,
    )
    return {
        "verified": True,
        "distance_meters": round(distance, 1),
        "accuracy_meters": student_accuracy,
        "flagged_suspicious": flagged,
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. Bluetooth proximity verification (HMAC, rotating per 30-second window)
# ═══════════════════════════════════════════════════════════════════════


def verify_bluetooth_proximity(
    bluetooth_token: str,
    student_detected_token: str,
) -> dict:
    """
    HMAC-rotating BLE check.

    `bluetooth_token` here is the per-session *secret seed* stored in
    `attendance_sessions.bluetooth_token` (NEVER broadcast on the air).
    `student_detected_token` is what the student's phone captured over BLE
    from the teacher's beacon, which is the SHA-256 HMAC of the current
    30-second time window computed against that seed.

    We accept the current, previous, and next windows (±30 s) to absorb
    clock skew and the BLE scan/advertise latency window.

    Returns:
      {verified: True}                                  — match found
      {verified: False, reason: str}                    — no window matched
    """
    # Local import avoids circular dependency at module-load time
    from utils.bluetooth_utils import verify_bluetooth_token  # type: ignore

    if not bluetooth_token or not student_detected_token:
        logger.warning(
            "📶 BLE check failed — seed=%s │ student_detected=%s",
            "present" if bluetooth_token else "EMPTY",
            "present" if student_detected_token else "EMPTY",
        )
        return {
            "verified": False,
            "reason": (
                "Bluetooth beacon not detected. "
                "Ensure you are in the classroom and Bluetooth is enabled."
            ),
        }

    if verify_bluetooth_token(bluetooth_token, student_detected_token):
        logger.info("📶 BLE verified — HMAC window matched ✓")
        return {"verified": True}

    logger.warning(
        "📶 BLE MISMATCH — seed=%s… │ student_detected=%s…",
        bluetooth_token[:8],
        student_detected_token[:8],
    )
    return {
        "verified": False,
        "reason": (
            "Bluetooth beacon not detected. "
            "Ensure you are in the classroom and Bluetooth is enabled."
        ),
    }
