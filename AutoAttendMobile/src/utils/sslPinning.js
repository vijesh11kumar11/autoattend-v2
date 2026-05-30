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

// ─────────────────────────────────────────────────────────────────────────────
// JavaScript-level SSL pin awareness (issue #10)
//
// Expo Go cannot perform a real native TLS handshake comparison, so the block
// below is a lightweight, Expo-compatible *awareness* layer that reads the
// expected SHA-256 public-key pin from app.json (expo.extra.sslPin) — so the
// pin can be rotated WITHOUT a code change — and exposes validatePin(cert) for
// call sites (and a future native bridge) to compare a presented fingerprint.
//
// To update the pin:
//   // Run the openssl command below against traceln.onrender.com and update
//   // app.json extra.sslPin:
//   //
//   //   openssl s_client -connect traceln.onrender.com:443 </dev/null 2>/dev/null | \
//   //   openssl x509 -pubkey -noout | \
//   //   openssl pkey -pubin -outform der | \
//   //   openssl dgst -sha256 -binary | \
//   //   openssl enc -base64
//   //
//   // The pin looks like: sha256/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX==
//
// TODO: Upgrade to full native SSL pinning with react-native-ssl-pinning (or
// OkHttp CertificatePinner) once an EAS dev build is ready. The current
// implementation is JS-level awareness only and never blocks in __DEV__.
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line global-require
const Constants = require('expo-constants').default;

/**
 * Normalise a pin value to its raw base64 body, dropping an optional
 * "sha256/" prefix and surrounding whitespace. Returns '' for falsy input.
 */
function normalisePin(value) {
  if (!value) return '';
  return String(value).trim().replace(/^sha256\//i, '').trim();
}

/** Read the expo.extra block, tolerant of SDK manifest shape differences. */
function getExtra() {
  return (
    Constants?.expoConfig?.extra ??
    Constants?.manifest?.extra ??
    Constants?.manifest2?.extra ??
    {}
  );
}

/** The expected SHA-256 public-key pin (raw base64, no "sha256/" prefix). */
export const EXPECTED_PIN = normalisePin(getExtra().sslPin);

/** The domain the pin applies to (e.g. "traceln.onrender.com"). */
export const PINNED_DOMAIN = getExtra().sslPinnedDomain ?? null;

/** True when a usable pin + domain are configured. */
export function isPinningConfigured() {
  return Boolean(EXPECTED_PIN) && Boolean(PINNED_DOMAIN);
}

/**
 * Check whether a request URL targets the pinned domain.
 * Accepts absolute URLs; relative URLs are matched against the domain string.
 */
export function urlMatchesPinnedDomain(url) {
  if (!PINNED_DOMAIN || !url) return false;
  try {
    return new URL(url).hostname === PINNED_DOMAIN;
  } catch {
    // Relative URL (no scheme): can't be cross-origin. Match on substring so
    // awareness logging still fires for the app's own API base URL.
    return String(url).includes(PINNED_DOMAIN);
  }
}

/**
 * Compare a presented certificate fingerprint against the expected pin.
 *
 * @param {string} cert  Presented SHA-256 public-key fingerprint (raw base64 or
 *                       prefixed with "sha256/").
 * @returns {boolean}    true if it matches the configured pin.
 *
 * In __DEV__ this always returns true so Expo Go is never blocked. A future
 * native TLS bridge would call this with the real server certificate
 * fingerprint to decide whether to allow the connection.
 */
export function validatePin(cert) {
  if (__DEV__) return true;                  // never block development / Expo Go
  if (!isPinningConfigured()) return true;   // nothing to enforce → JS-level only
  return normalisePin(cert) === EXPECTED_PIN;
}
