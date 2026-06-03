/**
 * AutoAttend AI v2.0 — Offline Indicator (web, issues #88 / #121)
 *
 * A slim yellow banner shown while the browser is offline (or while items are
 * still queued), plus a transient notice for rejection / sync / failure
 * messages surfaced by the offline queue. Purely informational.
 */

import { useOfflineQueue } from '../context/OfflineQueueContext';

export default function OfflineIndicator() {
  const { isOnline, queueLength, notice } = useOfflineQueue();

  // Transient notice (rejection / sync / failure) takes precedence.
  if (notice) {
    const palette =
      notice.kind === 'rejected' || notice.kind === 'failed'
        ? 'bg-red-50 text-red-800 border-red-200'
        : 'bg-emerald-50 text-emerald-800 border-emerald-200';
    return (
      <div role="status" className={`w-full border-b px-4 py-2 text-sm text-center ${palette}`}>
        {notice.message}
      </div>
    );
  }

  if (isOnline && queueLength === 0) return null;

  const message = !isOnline
    ? `You are offline. ${queueLength} pending submission${queueLength === 1 ? '' : 's'} will sync when you reconnect.`
    : `Reconnecting… ${queueLength} pending submission${queueLength === 1 ? '' : 's'} syncing.`;

  return (
    <div
      role="status"
      className="w-full border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-center text-amber-800"
    >
      {message}
    </div>
  );
}
