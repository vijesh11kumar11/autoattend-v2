/**
 * TRACELN v2.0 — Offline Queue Context (web, issues #88 / #121)
 *
 * Tracks online/offline state and the pending offline-queue length, and
 * auto-replays the queue when connectivity is restored. Provides the count
 * used by <OfflineIndicator /> and any badge UI.
 *
 * Mount inside <AuthProvider> so replayed requests carry the auth cookie.
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getQueueLength, processQueue, subscribe, setQueueNotifier } from '../utils/offlineQueue';

const OfflineQueueContext = createContext({
  queueLength: 0,
  isOnline: true,
  notice: null,
  syncNow: () => {},
});

export function OfflineQueueProvider({ children }) {
  const [queueLength, setQueueLength] = useState(getQueueLength());
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  // Transient banner notice for rejection / sync / failure messages.
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  const showNotice = useCallback((message, kind) => {
    setNotice({ message, kind, id: Date.now() });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 8000);
  }, []);

  const syncNow = useCallback(() => {
    processQueue();
  }, []);

  useEffect(() => {
    setQueueNotifier(showNotice);
    const unsubscribe = subscribe(setQueueLength);

    const handleOnline = () => {
      setIsOnline(true);
      processQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Attempt an initial flush in case items were left from a previous session.
    if (navigator.onLine) processQueue();

    return () => {
      unsubscribe();
      setQueueNotifier(null);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [showNotice]);

  return (
    <OfflineQueueContext.Provider value={{ queueLength, isOnline, notice, syncNow }}>
      {children}
    </OfflineQueueContext.Provider>
  );
}

export function useOfflineQueue() {
  return useContext(OfflineQueueContext);
}

export default OfflineQueueContext;
