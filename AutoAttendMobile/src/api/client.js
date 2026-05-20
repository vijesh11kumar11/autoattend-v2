/**
 * AutoAttend AI — Axios client
 *
 * Request interceptor:
 *   - Attaches Authorization: Bearer <token>
 *   - Attaches X-Device-ID: stable hardware fingerprint
 *     (expo-device + SHA256 via expo-crypto; falls back to stored UUID)
 *
 * Response interceptor:
 *   - 401 → calls registered logout callback (set by AuthContext)
 *   - 503 → shows "Server maintenance" alert
 *
 * NOTE: expo-device and expo-crypto are NOT in package.json by default.
 * Run: npx expo install expo-device expo-crypto
 * A UUID fallback is provided so the app still works without them.
 */

import axios from 'axios';
import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL, API_TIMEOUT } from '../config';

const TOKEN_KEY     = 'aa_auth_token';
const DEVICE_ID_KEY = 'aa_device_id';

// ── JWT helpers ───────────────────────────────────────────────────────
/** Decode the payload portion of a JWT without an external library. */
export function decodeJWTPayload(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return null;
    const padded  = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/** True if a JWT is missing/malformed or its `exp` claim is in the past. */
export function isTokenExpired(token) {
  if (!token) return true;
  const payload = decodeJWTPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 <= Date.now();
}

let _expiryAlertShown = false;
function notifyExpiredOnce() {
  if (_expiryAlertShown) return;
  _expiryAlertShown = true;
  Alert.alert(
    'Session Expired',
    'Your session has expired. Please log in again.',
    [{ text: 'OK', onPress: () => { _expiryAlertShown = false; } }],
  );
}
export function resetExpiryAlert() { _expiryAlertShown = false; }

// ── Unauthorized callback (set by AuthContext on mount) ───────────────
let _onUnauthorized = null;
export function setUnauthorizedCallback(fn) {
  _onUnauthorized = fn;
}

// ── Device fingerprint ────────────────────────────────────────────────
async function getDeviceId() {
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (id) return id;

  try {
    const Device = await import('expo-device');
    const raw = [
      Device.modelId,
      Device.osVersion,
      Device.deviceName,
    ].filter(Boolean).join('|');

    try {
      const Crypto = await import('expo-crypto');
      id = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        raw,
      );
    } catch {
      // expo-crypto not installed — use fast FNV-1a hash
      id = raw.split('').reduce((h, c) => {
        return (((h ^ c.charCodeAt(0)) >>> 0) * 0x01000193) >>> 0;
      }, 0x811c9dc5).toString(16);
    }
  } catch {
    // expo-device not installed — generate a stable random UUID
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}

// ── Axios instance ────────────────────────────────────────────────────
const client = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: API_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor ───────────────────────────────────────────────
client.interceptors.request.use(
  async (config) => {
    const [token, deviceId] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      getDeviceId(),
    ]);
    if (token) {
      // Pre-flight expiry guard — never send a request with a dead token.
      if (isTokenExpired(token)) {
        try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch {}
        notifyExpiredOnce();
        if (_onUnauthorized) {
          try { await _onUnauthorized(); } catch {}
        }
        return Promise.reject(new axios.Cancel('Session expired'));
      }
      config.headers.Authorization = `Bearer ${token}`;
    }
    config.headers['X-Device-ID'] = deviceId;
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response interceptor ──────────────────────────────────────────────
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;

    if (status === 401) {
      if (_onUnauthorized) {
        await _onUnauthorized();
      }
    } else if (status === 503) {
      Alert.alert(
        'Server Maintenance',
        'AutoAttend AI is currently under maintenance. Please try again later.',
        [{ text: 'OK' }],
      );
    }

    return Promise.reject(error);
  },
);

export default client;
