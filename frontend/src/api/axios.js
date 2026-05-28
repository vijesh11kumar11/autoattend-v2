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
 *   Generated once, stored in localStorage under "aa_device_id".
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

const DEVICE_KEY = 'aa_device_id';

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = generateDeviceFingerprint();
    localStorage.setItem(DEVICE_KEY, id);
  }
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
    // Guest fallback for live-session endpoints (no cookie/login required)
    const url = config.url || '';
    if (url.includes('/live/')) {
      const guestToken = sessionStorage.getItem('aa_guest_token');
      if (guestToken) {
        config.headers['Authorization'] = `Bearer ${guestToken}`;
      }
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

