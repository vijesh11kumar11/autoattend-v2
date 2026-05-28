/**
 * AutoAttend AI — SSL pinning wrapper.
 *
 * IMPORTANT — Expo managed-workflow caveat:
 *   `react-native-ssl-pinning` is a native module. In the default Expo
 *   managed workflow (Expo Go), it is NOT linked and this wrapper
 *   transparently falls back to ordinary `fetch`. To actually engage
 *   certificate pinning you must build a custom dev client via EAS
 *   (`eas build --profile development --platform android`) and ship
 *   the certificate file with the app bundle.
 *
 * Activation steps (production):
 *   1. Run `npx expo install react-native-ssl-pinning`.
 *   2. Set SSL_PINNING_ENABLED=true in src/config.js.
 *   3. Drop the Render certificate into android/app/src/main/assets/
 *      and ios/Resources/ (filename must match certs[] below).
 *   4. Build with EAS.
 */

import { Platform } from 'react-native';

import { PINNED_CERT_FILES, SSL_PINNING_ENABLED } from '../config';

let _pinnedFetch = null;
try {
  // eslint-disable-next-line global-require
  const lib = require('react-native-ssl-pinning');
  _pinnedFetch = lib?.fetch || null;
} catch {
  _pinnedFetch = null;
}

export function isPinningActive() {
  return SSL_PINNING_ENABLED && !!_pinnedFetch && Platform.OS !== 'web';
}

/**
 * pinnedFetch(url, init?) → Promise<Response>
 *
 * Behaviour:
 *   - When the native module is loaded AND SSL_PINNING_ENABLED is true,
 *     uses react-native-ssl-pinning's fetch with sslPinning.certs[].
 *   - Otherwise falls back to the global fetch (no pinning).
 */
export async function pinnedFetch(url, init = {}) {
  if (!isPinningActive()) {
    return fetch(url, init);
  }
  const opts = {
    method:  init.method || 'GET',
    timeoutInterval: init.timeout ?? 15000,
    headers: init.headers || {},
    body:    init.body,
    sslPinning: { certs: PINNED_CERT_FILES },
  };
  return _pinnedFetch(url, opts);
}
