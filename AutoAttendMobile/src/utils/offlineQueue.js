/**
 * offlineQueue — offline-first operation queue for AutoAttend mobile.
 * Closes issues #88 / #121.
 *
 * Purely ADDITIVE behaviour: when a write fails because the device is offline,
 * the operation is persisted to AsyncStorage and replayed automatically once
 * connectivity returns. Online behaviour is unchanged.
 *
 * Queued operations (and only these):
 *   - 'attendance' : student attendance marking   (highest priority)
 *   - 'leave'      : student leave request
 *   - 'dispute'    : student attendance dispute
 *
 * NEVER queued: authentication, reports, dashboards, live-session controls.
 * NEVER store passwords or tokens in the queue body.
 *
 * Conflict policy: SERVER WINS. If the operation window is already closed when
 * a queued item syncs, the server replies 409/410/400 with a "session_closed"
 * or "window_expired" marker; the item is dropped and the user is notified to
 * resubmit.
 *
 * Queue item shape:
 *   { id, operation, endpoint, method, body, timestamp, retries }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import client from '../api/client';

const QUEUE_KEY = 'offline_queue';
const MAX_RETRIES = 5;

// Lower number = processed first. Attendance is the highest priority.
const PRIORITY = { attendance: 0, leave: 1, dispute: 2 };

// Human-friendly label used in user notifications.
const LABEL = { attendance: 'attendance', leave: 'leave', dispute: 'dispute' };

// ── Subscribers (badge updates) ───────────────────────────────────────
const _listeners = new Set();

/** Subscribe to queue-length changes. Returns an unsubscribe function. */
export function subscribe(listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

async function _emitChange() {
  const len = await getQueueLength();
  _listeners.forEach((fn) => {
    try {
      fn(len);
    } catch {
      /* listener errors are non-fatal */
    }
  });
}

// ── Notifier (user-facing messages) ───────────────────────────────────
let _notifier = null;

/**
 * Register a callback used to surface rejection / failure messages to the user.
 * @param {(message: string, kind?: 'rejected'|'failed'|'queued'|'synced') => void} fn
 */
export function setQueueNotifier(fn) {
  _notifier = typeof fn === 'function' ? fn : null;
}

function _notify(message, kind) {
  if (_notifier) {
    try {
      _notifier(message, kind);
    } catch {
      /* non-fatal */
    }
  }
}

// ── Storage helpers ───────────────────────────────────────────────────
async function _readQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function _writeQueue(items) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

function _newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Queue an operation for later sync.
 * @param {'attendance'|'leave'|'dispute'} operation
 * @param {string} endpoint  API path relative to the axios baseURL (e.g. '/attendance/mark')
 * @param {string} method    HTTP method ('post' | 'put' | 'patch' | 'delete')
 * @param {object} body      Request payload (must NOT contain secrets/tokens)
 * @returns {Promise<object>} the stored queue item
 */
export async function addToQueue(operation, endpoint, method, body) {
  const item = {
    id: _newId(),
    operation,
    endpoint,
    method: (method || 'post').toLowerCase(),
    body: body ?? {},
    timestamp: Date.now(),
    retries: 0,
  };
  const items = await _readQueue();
  items.push(item);
  await _writeQueue(items);
  await _emitChange();
  return item;
}

/** Remove a single item from the queue by id. */
export async function clearItem(id) {
  const items = await _readQueue();
  const next = items.filter((it) => it.id !== id);
  if (next.length !== items.length) {
    await _writeQueue(next);
    await _emitChange();
  }
}

/** Number of pending items currently in the queue. */
export async function getQueueLength() {
  const items = await _readQueue();
  return items.length;
}

/** Remove every item (used rarely, e.g. on logout). */
export async function clearQueue() {
  await AsyncStorage.removeItem(QUEUE_KEY);
  await _emitChange();
}

// ── Sync engine ───────────────────────────────────────────────────────
let _processing = false;

function _formatTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

function _isRejection(status, payload) {
  if (![400, 409, 410].includes(status)) return false;
  const blob = `${payload?.detail ?? ''} ${payload?.message ?? ''}`.toLowerCase();
  return blob.includes('session_closed') || blob.includes('window_expired');
}

// Server reachable but the request will never succeed on retry → drop it.
function _isPermanentError(status) {
  // 401/403 → auth; 422 → validation; 404 → gone. Retrying won't help.
  return [400, 401, 403, 404, 405, 410, 422].includes(status);
}

/**
 * Attempt to sync every queued item. Safe to call repeatedly; a single run is
 * in-flight at a time. No-ops when offline.
 * @returns {Promise<{ processed: number, synced: number, remaining: number }>}
 */
export async function processQueue() {
  if (_processing) return { processed: 0, synced: 0, remaining: await getQueueLength() };
  _processing = true;
  let synced = 0;
  let processed = 0;

  try {
    // Only attempt when we believe we're online.
    const net = await NetInfo.fetch();
    const online = net.isConnected && net.isInternetReachable !== false;
    if (!online) {
      return { processed: 0, synced: 0, remaining: await getQueueLength() };
    }

    let items = await _readQueue();
    // Highest-priority operations first, then oldest first.
    items = [...items].sort(
      (a, b) =>
        (PRIORITY[a.operation] ?? 9) - (PRIORITY[b.operation] ?? 9) || a.timestamp - b.timestamp
    );

    for (const item of items) {
      processed += 1;
      try {
        await client.request({
          url: item.endpoint,
          method: item.method,
          data: item.body,
        });
        // 2xx → success.
        await clearItem(item.id);
        synced += 1;
      } catch (err) {
        const status = err?.response?.status;
        const payload = err?.response?.data;

        if (status && _isRejection(status, payload)) {
          // SERVER WINS — window/session already closed. Drop + notify.
          await clearItem(item.id);
          _notify(
            `Your offline ${LABEL[item.operation] ?? 'submission'} from ` +
              `${_formatTime(item.timestamp)} was rejected because the ` +
              `session/window was already closed. Please resubmit.`,
            'rejected'
          );
        } else if (!err?.response) {
          // Network error — keep and retry later (bounded).
          item.retries = (item.retries || 0) + 1;
          if (item.retries > MAX_RETRIES) {
            await clearItem(item.id);
            _notify(
              `Your offline ${LABEL[item.operation] ?? 'submission'} from ` +
                `${_formatTime(item.timestamp)} could not be submitted after ` +
                `several attempts. Please try again.`,
              'failed'
            );
          } else {
            await _persistRetry(item);
            // Stop the run on a network error — connectivity likely dropped.
            break;
          }
        } else if (_isPermanentError(status)) {
          // Server reached, request invalid/forbidden → will never succeed.
          await clearItem(item.id);
          _notify(
            `Your offline ${LABEL[item.operation] ?? 'submission'} from ` +
              `${_formatTime(item.timestamp)} could not be submitted ` +
              `(${payload?.detail ?? payload?.message ?? 'rejected by server'}).`,
            'failed'
          );
        } else {
          // Transient server error (5xx/429/timeout) — retry later (bounded).
          item.retries = (item.retries || 0) + 1;
          if (item.retries > MAX_RETRIES) {
            await clearItem(item.id);
            _notify(
              `Your offline ${LABEL[item.operation] ?? 'submission'} from ` +
                `${_formatTime(item.timestamp)} could not be submitted after ` +
                `several attempts. Please try again.`,
              'failed'
            );
          } else {
            await _persistRetry(item);
          }
        }
      }
    }

    if (synced > 0) {
      _notify(`${synced} offline submission(s) synced successfully.`, 'synced');
    }
  } finally {
    _processing = false;
  }

  return { processed, synced, remaining: await getQueueLength() };
}

// Persist an incremented retry counter for a single item without disturbing
// the ordering of the rest of the queue.
async function _persistRetry(item) {
  const items = await _readQueue();
  const idx = items.findIndex((it) => it.id === item.id);
  if (idx !== -1) {
    items[idx] = { ...items[idx], retries: item.retries };
    await _writeQueue(items);
  }
}

export default {
  addToQueue,
  processQueue,
  clearItem,
  clearQueue,
  getQueueLength,
  subscribe,
  setQueueNotifier,
};
