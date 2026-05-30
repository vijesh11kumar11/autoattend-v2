/**
 * OfflineQueueContext — exposes the offline-queue length for UI badges and
 * auto-syncs queued operations when connectivity is restored.
 *
 * Closes issues #88 / #121. Wraps the app alongside AuthProvider.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { getQueueLength, processQueue, subscribe, setQueueNotifier } from '../utils/offlineQueue';

const OfflineQueueContext = createContext({
  queueLength: 0,
  isOnline: true,
  refreshQueue: async () => {},
  syncNow: async () => {},
});

export function OfflineQueueProvider({ children }) {
  const [queueLength, setQueueLength] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const wasOffline = useRef(false);

  // Surface rejection / failure / sync messages to the user.
  useEffect(() => {
    setQueueNotifier((message, kind) => {
      const title =
        kind === 'rejected'
          ? 'Submission Rejected'
          : kind === 'synced'
            ? 'Back Online'
            : kind === 'failed'
              ? 'Submission Failed'
              : 'AutoAttend';
      Alert.alert(title, message);
    });
    return () => setQueueNotifier(null);
  }, []);

  // Track queue length for badge display.
  useEffect(() => {
    let mounted = true;
    getQueueLength().then((len) => {
      if (mounted) setQueueLength(len);
    });
    const unsub = subscribe((len) => {
      if (mounted) setQueueLength(len);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  // Listen to connectivity; auto-process the queue when we come back online.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);

      if (online && wasOffline.current) {
        // Transition offline → online: flush the queue.
        processQueue().catch(() => {});
      }
      wasOffline.current = !online;
    });

    // Attempt an initial sync on mount in case items were left over.
    processQueue().catch(() => {});

    return () => unsubscribe();
  }, []);

  const value = {
    queueLength,
    isOnline,
    refreshQueue: async () => setQueueLength(await getQueueLength()),
    syncNow: () => processQueue(),
  };

  return <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>;
}

export function useOfflineQueue() {
  return useContext(OfflineQueueContext);
}

export default OfflineQueueContext;
