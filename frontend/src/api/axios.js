/**
 * AutoAttend AI v2.0 — Axios instance
 *
 * • baseURL  = /api  (Vite proxies to FastAPI in dev)
 * • Request interceptor:
 *     - Authorization: Bearer <token>
 *     - X-Device-ID: <stable browser fingerprint>
 * • Response interceptor:
 *     - 401 → clear storage → /login
 *     - 403 → /unauthorized
 *
 * Device fingerprint:
 *   Generated once, stored in localStorage under "aa_device_id".
 *   Combines: userAgent + screen WxH + colour depth + timezone +
 *   canvas pixel hash (non-tracking, purely for session binding).
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
    // FNV-1a 32-bit hash for the data URI
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

  // FNV-1a over the combined string
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
  // In dev, Vite proxies /api → localhost:8000.
  // In production, set VITE_API_BASE_URL=https://your-api.example.com
  // and requests become https://your-api.example.com/api.
  // Leave unset when frontend + backend share the same origin (nginx reverse-proxy).
  baseURL: import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api` : '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
  // Send the httpOnly aa_token cookie with every cross-origin request.
  withCredentials: true,
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Web clients authenticate via httpOnly cookie — no manual Authorization header needed.
    // Only inject a ****** for guest live-session calls that use a
    // short-lived token stored in sessionStorage (no httpOnly cookie for guests).
    const url = config.url || '';
    if (url.includes('/live/')) {
      const guestToken = sessionStorage.getItem('aa_guest_token');
      if (guestToken) {
        config.headers['Authorization'] = `******;
      }
    }
    config.headers['X-Client-Type'] = 'web';
    config.headers['X-Device-ID']   = getDeviceId();
    return config;
  },
  (error) => Promise.reject(error),
);
// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url    = error.config?.url || '';
    // Live-session endpoints must NEVER trigger a global logout-redirect.
    // Guests legitimately hit these without an aa_token (they use a guest
    // token in sessionStorage). The page handles its own error states.
    const isPublicLiveCall =
      url.includes('/live/join/') ||
      url.includes('/live/sessions/') ||
      url.includes('/live/doubts') ||
      url.includes('/live/liveness');

    if (status === 401 && !isPublicLiveCall) {
      // Cookie expired or invalid — clear client-side user metadata and redirect
      localStorage.removeItem('aa_user');
      // Use replace to prevent back navigation to protected page
      window.location.replace('/login');
    } else if (status === 403 && !isPublicLiveCall) {
      const detail = error.response?.data?.detail || '';
      // Device mismatch or role-based access → unauthorized page
      // But NOT for face enrollment issues — let the page handle those
      if (detail.includes('Device mismatch') || detail.includes('Access restricted')) {
        window.location.replace('/unauthorized');
      }
    }

    return Promise.reject(error);
  },
);

export default api;
export { getDeviceId };

