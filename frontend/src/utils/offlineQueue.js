/**
 * AutoAttend AI v2.0 — Web Offline Operation Queue (issues #88 / #121)
 *
 * Purely additive resilience layer. When a *write* operation fails because the
 * browser is offline (network error, no HTTP response), it is persisted to
 * localStorage and replayed automatically once connectivity returns.
 *
 * SERVER WINS conflict policy
 * ───────────────────────────
 * When a queued item finally reaches the server, the server is authoritative.
 * If the attendance session / dispute window has since closed, the server
 * replies 4xx with a marker ("session_closed" / "window_expired"); the item is
 * dropped and the user is told their offline submission was rejected.
 *
 * Queued operations (priority order):
 *   0. attendance  (highest — web students normally mark on mobile, kept for parity)
 *   1. leave       (leave request submission)
 *   2. dispute     (dispute submission)
 *
 * NOT queued: login, reports, dashboards, live-session controls.
 * NEVER stores passwords or tokens — auth rides on the httpOnly cookie, which
 * the browser re-attaches automatically on replay.
 */

import api from '../api/axios';

const QUEUE_KEY   = 'offline_queue';
const MAX_RETRIES = 5;

const PRIORITY = { attendance: 0, leave: 1, dispute: 2 };
const LABEL    = { attendance: 'attendance', leave: 'leave', dispute: 'dispute' };

// ── Subscribers (for badge / indicator counts) ───────────────────────────────
const listeners = new Set();

/** Subscribe to queue-length changes. Returns an unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  const len = getQueueLength();
  listeners.forEach((l) => {
    try { l(len); } catch { /* ignore listener errors */ }
  });
}

// ── User-message notifier (rejection / failure / sync alerts) ─────────────────
let notifier = null;

/** Register a callback `(message, kind)` where kind ∈ rejected|failed|queued|synced. */
export function setQueueNotifier(fn) {
  notifier = typeof fn === 'function' ? fn : null;
}

function notify(message, kind) {
  if (notifier) {
    try { notifier(message, kind); } catch { /* ignore */ }
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────
function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    /* storage full / disabled — best effort */
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Number of pending items in the queue. */
export function getQueueLength() {
  return readQueue().length;
}

/** Add a write operation to the offline queue. */
export function addToQueue(operation, endpoint, method, body) {
  const items = readQueue();
  items.push({
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    endpoint,
    method:    String(method || 'post').toLowerCase(),
    body,
    timestamp: Date.now(),
    retries:   0,
  });
  writeQueue(items);
  emitChange();
}

/** Remove a single item by id. */
export function clearItem(id) {
  const items = readQueue().filter((it) => it.id !== id);
  writeQueue(items);
  emitChange();
}

/** Empty the entire queue. */
export function clearQueue() {
  writeQueue([]);
  emitChange();
}

function isRejection(status, payload) {
  if (![400, 409, 410].includes(status)) return false;
  const detail  = String(payload?.detail  ?? '').toLowerCase();
  const message = String(payload?.message ?? '').toLowerCase();
  const blob = `${detail} ${message}`;
  return blob.includes('session_closed') || blob.includes('window_expired');
}

function isPermanentError(status) {
  return [400, 401, 403, 404, 405, 410, 422].includes(status);
}

function rejectionMessage(operation, timestamp) {
  const label = LABEL[operation] || 'submission';
  const when  = new Date(timestamp).toLocaleString();
  return `Your offline ${label} submission from ${when} was rejected because the ` +
         `session/window was already closed. Please resubmit.`;
}

let processing = false;

/**
 * Replay queued operations. Highest-priority (attendance) first, then oldest.
 * Safe to call repeatedly; guarded against re-entrancy.
 */
export async function processQueue() {
  if (processing) return { processed: 0, synced: 0, remaining: getQueueLength() };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { processed: 0, synced: 0, remaining: getQueueLength() };
  }

  processing = true;
  let processed = 0;
  let synced = 0;

  try {
    let items = readQueue();
    items.sort((a, b) => {
      const pa = PRIORITY[a.operation] ?? 99;
      const pb = PRIORITY[b.operation] ?? 99;
      return pa !== pb ? pa - pb : a.timestamp - b.timestamp;
    });

    for (const item of items) {
      processed += 1;
      try {
        await api.request({ url: item.endpoint, method: item.method, data: item.body });
        clearItem(item.id);
        synced += 1;
      } catch (err) {
        const status  = err?.response?.status;
        const payload = err?.response?.data;

        if (!err?.response) {
          // Still offline → stop; bump retry, keep item.
          const retries = (item.retries || 0) + 1;
          if (retries > MAX_RETRIES) {
            clearItem(item.id);
            notify(
              `An offline ${LABEL[item.operation] || 'submission'} could not be ` +
              `delivered after several attempts and was discarded.`,
              'failed',
            );
          } else {
            persistRetry(item.id, retries);
          }
          break; // network is down — no point trying the rest now
        }

        if (isRejection(status, payload)) {
          clearItem(item.id);
          notify(rejectionMessage(item.operation, item.timestamp), 'rejected');
        } else if (isPermanentError(status)) {
          clearItem(item.id);
          notify(
            `An offline ${LABEL[item.operation] || 'submission'} was rejected by ` +
            `the server and has been discarded.`,
            'failed',
          );
        } else {
          // Transient server error (5xx/429) → bump retry, keep.
          const retries = (item.retries || 0) + 1;
          if (retries > MAX_RETRIES) {
            clearItem(item.id);
            notify(
              `An offline ${LABEL[item.operation] || 'submission'} could not be ` +
              `delivered after several attempts and was discarded.`,
              'failed',
            );
          } else {
            persistRetry(item.id, retries);
          }
        }
      }
    }

    if (synced > 0) {
      notify(`${synced} offline submission(s) synced successfully.`, 'synced');
    }
  } finally {
    processing = false;
  }

  return { processed, synced, remaining: getQueueLength() };
}

function persistRetry(id, retries) {
  const items = readQueue().map((it) => (it.id === id ? { ...it, retries } : it));
  writeQueue(items);
}

export default {
  addToQueue,
  clearItem,
  clearQueue,
  getQueueLength,
  processQueue,
  subscribe,
  setQueueNotifier,
};
