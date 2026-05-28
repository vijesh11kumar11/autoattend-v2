/**
 * AutoAttend AI v2.0 — Axios instance
 *
 * • baseURL  = /api  (Vite proxies to FastAPI in dev)
 * • Auth     = httpOnly cookie `aa_token` (set by /api/auth/login).
 *              The browser sends it automatically when `withCredentials: true`.
 * • Request interceptor:
 *     - X-Device-ID:  stable browser fingerprint
 *     - X-Client-Type: "web"  (so backend sets cookie, not body token)
 * • Response interceptor:
 *     - 401 → redirect to /login
 *     - 403 (Device mismatch / Access restricted) → /unauthorized
 *
 * Device fingerprint (NOT auth — only session binding):
 *   Persisted in the `aa_device` cookie (Secure, SameSite=Strict, 1-year
 *   max-age) which is automatically echoed by the browser. The header
 *   X-Device-ID still carries the value for backwards compatibility, but
 *   the backend now prefers the cookie. Cookie storage tightens scope
 *   compared to localStorage (cookie attributes + auto-expiry).
 *   Combines: userAgent + screen WxH + colour depth + timezone +
 *   canvas pixel hash (non-tracking, purely for device-binding).
 */

import axios from 'axios';

// ── Device fingerprint ────────────────────────────────────────────────

function canvasHash() {
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 50;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('AutoAttend🎓', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('AutoAttend🎓', 4, 17);
    const data = c.toDataURL();
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  } catch {
    return '00000000';
  }
}

function generateDeviceFingerprint() {
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}`,
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvasHash(),
  ].join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const DEVICE_KEY = 'aa_device_id';        // legacy localStorage key (read-only migration)
const DEVICE_COOKIE = 'aa_device';        // new canonical store

function readCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeDeviceCookie(value) {
  // 1 year, root path, Secure on HTTPS, SameSite=Strict.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${DEVICE_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Strict${secure}`;
}

function getDeviceId() {
  // 1. Prefer cookie (preferred by backend, scoped + auto-expires).
  let id = readCookie(DEVICE_COOKIE);
  if (id) return id;
  // 2. Migrate from legacy localStorage if present.
  id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = generateDeviceFingerprint();
  }
  writeDeviceCookie(id);
  // Best-effort clean-up of legacy storage.
  try { localStorage.removeItem(DEVICE_KEY); } catch (_) { /* ignore */ }
  return id;
}

// ── Axios instance ────────────────────────────────────────────────────

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api` : '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,  // send httpOnly aa_token cookie on every request
});

// Defence in depth: marks every call as XHR so backend can reject
// non-XHR cross-origin POST attempts (anti-CSRF heuristic).
api.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Guest fallback for live-session endpoints (no cookie/login required).
    // Guest token now lives in module memory (live/guestSessionStore) —
    // NOT sessionStorage — to keep it out of XSS reach.
    const url = config.url || '';
    if (url.includes('/live/')) {
      try {
        // Dynamic import avoids a circular dep when axios is imported first.
        // Synchronous: the module is already loaded by JoinSessionPage.
        // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
        const mod = window.__aaGuestStore;
        const guestToken = mod?.getGuestSession?.()?.token;
        if (guestToken) {
          config.headers['Authorization'] = `Bearer ${guestToken}`;
        }
      } catch { /* no-op */ }
    }
    config.headers['X-Device-ID']  = getDeviceId();
    config.headers['X-Client-Type'] = 'web';
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor
// On 401: try refresh-token rotation ONCE, then retry the original request.
// If refresh fails or 401 repeats → redirect to /login.
let _refreshInFlight = null;

function refreshAccessToken() {
  if (!_refreshInFlight) {
    _refreshInFlight = axios.post(
      (import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api` : '/api') +
        '/auth/refresh',
      {},
      {
        withCredentials: true,
        headers: { 'X-Client-Type': 'web', 'X-Device-ID': getDeviceId() },
      },
    ).finally(() => { _refreshInFlight = null; });
  }
  return _refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const url    = error.config?.url || '';
    const isPublicLiveCall =
      url.includes('/live/join/') ||
      url.includes('/live/sessions/') ||
      url.includes('/live/doubts') ||
      url.includes('/live/liveness');
    const isAuthCall =
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/verify-totp');

    if (status === 401 && !isPublicLiveCall && !isAuthCall && !error.config?._retried) {
      try {
        await refreshAccessToken();
        // Replay original request once
        const cfg = { ...error.config, _retried: true };
        return api.request(cfg);
      } catch {
        if (window.location.pathname !== '/login') {
          window.location.replace('/login');
        }
        return Promise.reject(error);
      }
    }

    if (status === 401 && !isPublicLiveCall) {
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    } else if (status === 403 && !isPublicLiveCall) {
      const detail = error.response?.data?.detail || '';
      if (detail.includes('Device mismatch') || detail.includes('Access restricted')) {
        window.location.replace('/unauthorized');
      }
    }

    return Promise.reject(error);
  },
);

export default api;
export { getDeviceId };

