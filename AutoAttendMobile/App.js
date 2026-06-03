/**
 * AutoAttend AI v2.0 — Mobile App Entry Point
 *
 * Startup sequence:
 *  1. SplashScreen.preventAutoHideAsync() keeps splash visible
 *  2. App mounts → pings backend (10s timeout)
 *  3. Registers for push notifications
 *  4. On network/timeout error → shows alert (non-blocking)
 *  5. SplashScreen.hideAsync() once the app is ready to paint
 *
 * Wraps everything in:
 *   ErrorBoundary → PaperProvider (theme) → AuthProvider → AppNavigator + OfflineBanner
 */

import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import './src/i18n/index.js'; // initialise i18next (English-only infrastructure)

import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import BlockedScreen from './src/screens/shared/BlockedScreen';
import { AuthProvider } from './src/context/AuthContext';
import { OfflineQueueProvider } from './src/context/OfflineQueueContext';
import AppNavigator from './src/navigation/AppNavigator';
import { API_BASE_URL, STARTUP_PING_TIMEOUT } from './src/config';
import { isDeviceCompromised } from './src/utils/securityUtils';
import {
  registerForPushNotifications,
  setupNotificationResponseListener,
} from './src/utils/notifications';

// Keep splash visible until the app is ready
SplashScreen.preventAutoHideAsync();

// ── react-native-paper theme ──────────────────────────────────────────
const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1a237e',
    secondary: '#3b82f6',
    primaryContainer: '#e8eaf6',
    secondaryContainer: '#dbeafe',
    surface: '#ffffff',
    background: '#f8fafc',
  },
};

// ── Backend ping ──────────────────────────────────────────────────────
async function pingBackend() {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), STARTUP_PING_TIMEOUT);
  try {
    await fetch(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    Alert.alert(
      isTimeout ? 'Connection Timeout' : 'Server Unreachable',
      isTimeout
        ? 'Could not reach the AutoAttend server within 10 seconds. Check your network.'
        : 'Could not connect to the AutoAttend server. Some features may be unavailable.',
      [{ text: 'OK' }]
    );
  } finally {
    clearTimeout(tid);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// App
// ═══════════════════════════════════════════════════════════════════════
export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [deviceBlock, setDeviceBlock] = useState(null);

  useEffect(() => {
    (async () => {
      // Root/jailbreak gate (issue #86) — runs ONCE at startup, before any
      // screen or AuthContext loads. Skipped automatically in development /
      // Expo Go. Server-side audit log remains the source of truth.
      try {
        const { compromised, reason } = await isDeviceCompromised();
        if (compromised) {
          setDeviceBlock(reason || 'insecure_device');
          setAppReady(true);
          await SplashScreen.hideAsync();
          return;
        }
      } catch {
        // Best-effort: if the check itself fails, do not block startup.
      }
      await pingBackend();
      await registerForPushNotifications();
      setAppReady(true);
      await SplashScreen.hideAsync();
    })();

    // Deep-link: handle notification tap → navigate to ScanQR
    const cleanup = setupNotificationResponseListener();
    return cleanup;
  }, []);

  if (!appReady) return null;

  // Rooted / jailbroken device → dead-end BlockedScreen, no app access.
  if (deviceBlock) {
    return <BlockedScreen />;
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <ErrorBoundary>
        <PaperProvider theme={theme}>
          <AuthProvider>
            <OfflineQueueProvider>
              <OfflineBanner />
              <AppNavigator />
            </OfflineQueueProvider>
          </AuthProvider>
        </PaperProvider>
      </ErrorBoundary>
    </View>
  );
}
