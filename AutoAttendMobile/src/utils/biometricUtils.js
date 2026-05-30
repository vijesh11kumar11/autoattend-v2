/**
 * biometricUtils — device biometric verification for AutoAttend AI mobile.
 *
 * Wraps `expo-local-authentication` (already installed) to provide a small,
 * reusable surface used by attendance marking. Students MUST pass a device
 * biometric (Face ID / fingerprint / iris) every time they mark attendance —
 * there is intentionally NO PIN/password fallback (see issues #15, #87).
 *
 * Usage:
 *   const support = await checkBiometricSupport();
 *   if (!support.available) { ...block & inform admin... }
 *   const res = await verifyBiometric('Verify your identity to mark attendance');
 *   if (!res.success) { ...block, show teacher message... }
 *
 * Notes:
 *  - This is device-level biometric (OS keystore), complementary to the
 *    server-side face match / liveness already performed during attendance.
 *  - All functions are defensive: any native/runtime error resolves to a
 *    safe "not available / not verified" result rather than throwing.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import * as Device from 'expo-device';

/**
 * Map the strongest available authentication type to a human-readable label.
 * @param {number[]} types - values from supportedAuthenticationTypesAsync()
 * @returns {string} 'face' | 'fingerprint' | 'iris' | 'biometric' | 'none'
 */
function _describeType(types) {
  const T = LocalAuthentication.AuthenticationType;
  if (Array.isArray(types)) {
    if (types.includes(T.FACIAL_RECOGNITION)) return 'face';
    if (types.includes(T.FINGERPRINT)) return 'fingerprint';
    if (types.includes(T.IRIS)) return 'iris';
    if (types.length > 0) return 'biometric';
  }
  return 'none';
}

/**
 * Check whether the device has biometric hardware AND at least one biometric
 * enrolled (so authentication can actually succeed).
 *
 * @returns {Promise<{ available: boolean, type: string, hasHardware: boolean, isEnrolled: boolean, reason: string|null }>}
 */
export async function checkBiometricSupport() {
  try {
    // A physical device is required — emulators rarely expose real biometrics.
    const isPhysical = Device.isDevice !== false;

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return {
        available: false,
        type: 'none',
        hasHardware: false,
        isEnrolled: false,
        reason: 'no_hardware',
      };
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const type = _describeType(types);

    if (!isEnrolled) {
      return {
        available: false,
        type,
        hasHardware: true,
        isEnrolled: false,
        reason: 'not_enrolled',
      };
    }

    return {
      available: isPhysical,
      type,
      hasHardware: true,
      isEnrolled: true,
      reason: isPhysical ? null : 'emulator',
    };
  } catch (err) {
    return {
      available: false,
      type: 'none',
      hasHardware: false,
      isEnrolled: false,
      reason: `error:${err?.message ?? 'unknown'}`,
    };
  }
}

/**
 * Prompt the user for a device biometric. There is deliberately NO fallback
 * to device passcode (`disableDeviceFallback: true`) — attendance integrity
 * requires a real biometric.
 *
 * @param {string} reason - prompt message shown in the OS biometric dialog
 * @returns {Promise<{ success: boolean, error: string|null }>}
 */
export async function verifyBiometric(reason = 'Verify your identity') {
  try {
    const support = await checkBiometricSupport();
    if (!support.available) {
      return { success: false, error: support.reason ?? 'unavailable' };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: true, // no PIN / password bypass
      requireConfirmation: false,
    });

    if (result?.success) {
      return { success: true, error: null };
    }
    return { success: false, error: result?.error ?? 'authentication_failed' };
  } catch (err) {
    return { success: false, error: err?.message ?? 'authentication_error' };
  }
}

export default { checkBiometricSupport, verifyBiometric };
