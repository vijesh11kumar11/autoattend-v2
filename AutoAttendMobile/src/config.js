/**
 * AutoAttend AI — Mobile runtime config
 *
 * API_BASE_URL   Set EXPO_PUBLIC_API_URL in your .env file for each environment.
 *                A loud console warning fires below if the fallback is hit so
 *                production builds without the env var don't silently target
 *                a LAN IP.
 *
 * API_TIMEOUT           Axios request timeout (milliseconds).
 * STARTUP_PING_TIMEOUT  Startup backend health-check timeout (milliseconds).
 */

const _ENV_URL = process.env.EXPO_PUBLIC_API_URL;
const _FALLBACK = 'http://192.168.1.100:8000';

export const API_BASE_URL = _ENV_URL ?? _FALLBACK;
export const API_TIMEOUT = 15_000;
// STARTUP_PING_TIMEOUT is intentionally SHORTER than API_TIMEOUT (#89):
// the startup health-check should fail fast so we can show "server
// unreachable" before the user blames the next real request. Long-running
// in-flight requests still get the full API_TIMEOUT window.
export const STARTUP_PING_TIMEOUT = 10_000;
export const IS_USING_FALLBACK = !_ENV_URL;

if (IS_USING_FALLBACK) {
  console.warn(
    '[config] EXPO_PUBLIC_API_URL is not set — falling back to ' +
      _FALLBACK +
      '. Set EXPO_PUBLIC_API_URL in your .env / EAS build profile before shipping.'
  );
}

// ── SSL pinning (off in Expo Go; requires EAS dev client to engage) ───
// Filenames (sans extension) of certificate files bundled with the app.
// Drop the cert into android/app/src/main/assets/<name>.cer and
// ios/<name>.cer, then list it here.
export const PINNED_CERT_FILES = ['traceln_render'];
export const SSL_PINNING_ENABLED = false;
