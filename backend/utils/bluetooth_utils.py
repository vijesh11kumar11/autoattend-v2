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

import logging
import secrets

logger = logging.getLogger(__name__)

# Length of generated Bluetooth token (hex chars = 16 bytes = 128-bit entropy)
_BT_TOKEN_LENGTH = 16


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

