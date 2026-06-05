/**
 * TRACELN v2.0 — Axios instance
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
    c.width = 200;
    c.height = 50;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('TRACELN🎓', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('TRACELN🎓', 4, 17);
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

const DEVICE_KEY = 'aa_device_id'; // legacy localStorage key (read-only migration)
const DEVICE_COOKIE = 'aa_device'; // new canonical store

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
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch (_) {
    /* ignore */
  }
  return id;
}

// ── Axios instance ────────────────────────────────────────────────────

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api` : '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // send httpOnly aa_token cookie on every request
});

// ── Bearer-token fallback (Safari / cross-site cookie blocking) ──────────
// Safari's ITP and some mobile browsers block cross-site (SameSite=None)
// cookies between traceln.vercel.app and traceln.onrender.com. When that
// happens the httpOnly aa_token cookie never reaches the API and every
// request 401s. To stay functional we ALSO keep the JWT returned in the
// login/refresh response body and send it as `Authorization: Bearer`.
// The cookie remains primary; this is a same-origin sessionStorage fallback.
const AUTH_TOKEN_KEY = 'aa_auth_token';

function setAuthToken(token) {
  try {
    if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    /* private mode — ignore */
  }
}

function getAuthToken() {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearAuthToken() {
  try {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

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
        const mod = window.__aaGuestStore;
        const guestToken = mod?.getGuestSession?.()?.token;
        if (guestToken) {
          config.headers['Authorization'] = `Bearer ${guestToken}`;
        }
      } catch {
        /* no-op */
      }
    }
    // Bearer fallback: attach stored JWT when the request has no explicit
    // Authorization header (i.e. not a guest live call). Harmless when the
    // cookie also works — the backend reads the header first, cookie second.
    if (!config.headers['Authorization']) {
      const stored = getAuthToken();
      if (stored) config.headers['Authorization'] = `Bearer ${stored}`;
    }
    config.headers['X-Device-ID'] = getDeviceId();
    config.headers['X-Client-Type'] = 'web';
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
// On 401: try refresh-token rotation ONCE, then retry the original request.
// If refresh fails or 401 repeats → redirect to /login.
let _refreshInFlight = null;

function refreshAccessToken() {
  if (!_refreshInFlight) {
    const stored = getAuthToken();
    _refreshInFlight = axios
      .post(
        (import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api` : '/api') +
          '/auth/refresh',
        {},
        {
          withCredentials: true,
          headers: {
            'X-Client-Type': 'web',
            'X-Device-ID': getDeviceId(),
            // Safari blocks the cross-site aa_refresh cookie; pass the last
            // known access token so the backend can still identify the user.
            ...(stored ? { Authorization: `Bearer ${stored}` } : {}),
          },
        }
      )
      .then((res) => {
        // Capture the rotated access token for the Bearer fallback.
        if (res?.data?.access_token) setAuthToken(res.data.access_token);
        return res;
      })
      .finally(() => {
        _refreshInFlight = null;
      });
  }
  return _refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
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
        const onAdmin = window.location.pathname.startsWith('/admin');
        const target = onAdmin ? '/admin/login' : '/login';
        if (window.location.pathname !== target) {
          // Tell LoginPage why we got bounced so we can surface a banner
          // instead of a silent redirect.
          try {
            sessionStorage.setItem('aa_login_reason', 'session_expired');
          } catch {
            /* ignore */
          }
          window.location.replace(target);
        }
        return Promise.reject(error);
      }
    }

    if (status === 401 && !isPublicLiveCall) {
      const onAdmin = window.location.pathname.startsWith('/admin');
      const target = onAdmin ? '/admin/login' : '/login';
      if (window.location.pathname !== target) {
        try {
          sessionStorage.setItem('aa_login_reason', 'session_expired');
        } catch {
          /* ignore */
        }
        window.location.replace(target);
      }
    } else if (status === 403 && !isPublicLiveCall) {
      const detail = error.response?.data?.detail || '';
      if (detail.includes('Device mismatch') || detail.includes('Access restricted')) {
        window.location.replace('/unauthorized');
      }
    }

    return Promise.reject(error);
  }
);

export { setAuthToken, clearAuthToken, getAuthToken };
export default api;
export { getDeviceId };
