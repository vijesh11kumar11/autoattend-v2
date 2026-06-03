/**
 * securityUtils — root / jailbreak gate for AutoAttend AI mobile (issue #86).
 *
 * Thin, dependency-light wrapper around the existing heuristic detector in
 * `deviceSecurity.js` (which uses `expo-device` + `expo-file-system` path
 * probes). We deliberately reuse that rather than pulling in the heavy native
 * `react-native-device-info` module — per the task's preferred order, the
 * already-installed `expo-device` is used first.
 *
 * Contract:
 *   isDeviceCompromised() -> { compromised: boolean, reason: string }
 *
 * Behaviour:
 *  - In development (Expo Go / __DEV__) the check is SKIPPED — native root
 *    probes are unreliable there and we must not block developers.
 *  - Any thrown error is swallowed and treated as NOT compromised (fail-open
 *    on the client; the backend audit log remains the source of truth).
 */

import { checkDeviceSecurity } from './deviceSecurity';

/**
 * Determine whether the current device appears rooted / jailbroken.
 * @returns {Promise<{ compromised: boolean, reason: string }>}
 */
export async function isDeviceCompromised() {
  // Skip entirely in development builds / Expo Go — see issue #86 notes.
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return { compromised: false, reason: 'dev_mode_skip' };
  }

  try {
    const sec = await checkDeviceSecurity();
    // checkDeviceSecurity returns { isSecure, reason }; an insecure result
    // means a root/jailbreak artifact or emulator was detected.
    if (sec && sec.isSecure === false) {
      return { compromised: true, reason: sec.reason || 'compromised_device' };
    }
    return { compromised: false, reason: 'clean' };
  } catch (err) {
    // Fail-open: never block the app if the native check itself fails.
    console.warn('[securityUtils] device check failed, assuming clean:', err?.message);
    return { compromised: false, reason: 'check_error' };
  }
}

export default { isDeviceCompromised };
