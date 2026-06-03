"""
AutoAttend AI v2.0 — Bluetooth BLE Beacon Utilities

════════════════════════════════════════════════════════════════════════
ARCHITECTURE OVERVIEW
════════════════════════════════════════════════════════════════════════

                    ┌─────────────────────┐
                    │  Teacher's Phone     │
                    │  (QRGenerateScreen)  │
                    │                      │
                    │  BLE Advertise:      │
                    │  SERVICE_UUID +      │
                    │  bluetooth_token     │──────BLE broadcast (≤10 m)──┐
                    └─────────────────────┘                              │
                                                                         ▼
                    ┌─────────────────────┐               ┌─────────────────────┐
                    │  Backend DB          │               │  Student's Phone     │
                    │                      │               │  (AttendanceScreen)  │
                    │  attendance_sessions │               │                      │
                    │   .bluetooth_token   │◄──validate────│  BLE Scan:           │
                    │  = secrets.hex(16)   │               │  find SERVICE_UUID   │
                    └─────────────────────┘               │  → extract token     │
                                                           │  → POST to backend   │
                                                           └─────────────────────┘

════════════════════════════════════════════════════════════════════════
MOBILE IMPLEMENTATION GUIDE (React Native)
The actual BLE advertising/scanning code belongs in the mobile app.
See: AutoAttendMobile/src/screens/teacher/QRGenerateScreen.js
     AutoAttendMobile/src/screens/student/AttendanceScreen.js
════════════════════════════════════════════════════════════════════════

TEACHER SIDE — BLE ADVERTISING (react-native-ble-plx):

    import BleManager from 'react-native-ble-plx';

    const SERVICE_UUID = '0000AABB-0000-1000-8000-00805F9B34FB';
    // ^ Replace with your own stable UUID registered for AutoAttend AI

    async function startBeacon(bluetoothToken) {
      // Android: Use react-native-ble-advertiser
      //   BleAdvertiser.broadcast(SERVICE_UUID, [bluetoothToken], options);
      //
      // iOS: CBPeripheralManager.startAdvertising({
      //   CBAdvertisementDataServiceUUIDsKey: [SERVICE_UUID],
      //   CBAdvertisementDataLocalNameKey: bluetoothToken
      // });
      //
      // IMPORTANT iOS BACKGROUND LIMITATION:
      //   iOS does NOT allow arbitrary BLE advertising while backgrounded.
      //   When going to background, iOS switches the advertisement to
      //   'overflow area' — only OTHER Apple devices running the same
      //   app in the background can detect it.
      //   WORKAROUND: Ask the teacher to keep the screen ON during class
      //               (use a wake lock / keepAwake from expo-keep-awake).
      //
      // ANDROID:
      //   Full BLE advertising works in both foreground and background.
      //   Use a Foreground Service to keep advertising alive.
      //   AndroidManifest.xml needs:
      //     <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE"/>
      //     <uses-permission android:name="android.permission.BLUETOOTH_SCAN"/>
      //     <uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
    }

STUDENT SIDE — BLE SCANNING:

    async function scanForToken() {
      BleManager.startDeviceScan([SERVICE_UUID], null, (error, device) => {
        if (error) return;
        // Extract token from device name or manufacturer data
        const detectedToken = device.localName || extractFromManufacturerData(device);
        if (detectedToken) {
          // Send to backend for validation
          api.post('/api/attendance/mark', { bluetooth_token: detectedToken, ... });
        }
      });
    }

FALLBACK (BLE not available):
  If the student's device does not support BLE scanning (rare on modern phones)
  OR the teacher's device cannot advertise (e.g., iPad without BLE advertisment),
  fall back to GPS-only mode:
    - Set BLUETOOTH_REQUIRED=False in .env
    - Attendance can be marked with GPS-only verification
    - This is surfaced to the HOD in reports (bluetooth_verified=False)

════════════════════════════════════════════════════════════════════════
BACKEND ROLE
════════════════════════════════════════════════════════════════════════

The backend only:
  1. Generates a secure random token when the teacher starts a session
     (attendance_sessions.bluetooth_token = generate_bluetooth_token())
  2. Returns it to the teacher's app via the start-session endpoint
     (NOT included in any student-facing API responses)
  3. Validates the token the student's app reports detecting
     (via location_utils.verify_bluetooth_proximity)

See: utils/location_utils.py → verify_bluetooth_proximity()
"""

import hashlib
import hmac
import logging
import secrets
import time

logger = logging.getLogger(__name__)

# Length of generated Bluetooth token (hex chars = 16 bytes = 128-bit entropy)
_BT_TOKEN_LENGTH = 16

# BLE token rotation period (seconds)
BLE_WINDOW_SECONDS = 30


def generate_bluetooth_token() -> str:
    """
    Generate a cryptographically random 32-hex-character token.
    Called when a teacher starts an attendance session.

    This token is:
      • Stored in attendance_sessions.bluetooth_token (never returned to students)
      • Broadcast by the teacher's phone as a BLE beacon payload
      • Submitted by the student's phone after BLE detection
      • Validated server-side with a simple equality check

    Returns: e.g. "a3f2b19c4d7e8f01a3f2b19c4d7e8f01"
    """
    token = secrets.token_hex(_BT_TOKEN_LENGTH)
    logger.info("📶 BLE token generated │ length=%d chars │ hint=%s...", len(token), token[:8])
    return token


# ═══════════════════════════════════════════════════════════════════════
# HMAC-rotating BLE token (30-second window)
# ═══════════════════════════════════════════════════════════════════════
#
# The per-session value stored in attendance_sessions.bluetooth_token is now
# a *secret seed*. What the teacher broadcasts on BLE is the HMAC-SHA-256
# of the current 30-second time window keyed by that seed, truncated to
# 32 hex chars for compact BLE advertisement payloads.
#
# A captured token therefore expires within ≤30 s, neutralising replay
# attacks that record the BLE advertisement and re-use it later.


def _current_window(now_ts: float | None = None) -> int:
    return int((now_ts if now_ts is not None else time.time()) // BLE_WINDOW_SECONDS)


def compute_ble_window_token(secret: str, window: int | None = None) -> str:
    """
    Compute the BLE advertisement payload for a given 30-second window.
    Defaults to the current window if `window` is omitted.
    """
    if window is None:
        window = _current_window()
    msg = f"BLE:{window}".encode()
    digest = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return digest[:32]  # 16 bytes of HMAC = plenty for proximity proof


def seconds_until_next_window(now_ts: float | None = None) -> int:
    now = now_ts if now_ts is not None else time.time()
    return BLE_WINDOW_SECONDS - int(now) % BLE_WINDOW_SECONDS


def verify_bluetooth_token(
    secret: str,
    presented_token: str,
    tolerance_windows: int = 1,
) -> bool:
    """
    Constant-time check: does `presented_token` match the HMAC of the
    current, previous, or next 30-s window?  ±tolerance_windows defaults to 1.
    """
    if not secret or not presented_token:
        return False
    win = _current_window()
    for delta in range(-tolerance_windows, tolerance_windows + 1):
        expected = compute_ble_window_token(secret, win + delta)
        if hmac.compare_digest(expected, presented_token):
            return True
    return False
