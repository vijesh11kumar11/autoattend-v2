/**
 * Push Notification Setup — expo-notifications
 *
 * Handles permission request, token registration, and notification listeners.
 * Deep-link: "session_started" → navigate to ScanQR screen.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import client from '../api/client';
import { navigationRef } from '../navigation/AppNavigator';

// ── Default notification handler ──────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request permission and register the Expo push token with the backend.
 * Call once after login/app start.
 */
export async function registerForPushNotifications() {
  if (!Device.isDevice) {
    // Push notifications don't work on emulator/simulator
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Android channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'AutoAttend',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: undefined, // uses EAS projectId from app.json automatically
  });
  const pushToken = tokenData.data;

  // Send to backend
  try {
    await client.post('/users/register-push-token', { push_token: pushToken });
  } catch {
    // Silently fail — token registration is best-effort
  }

  return pushToken;
}

/**
 * Set up listener that handles tapped notifications (deep linking).
 * Returns a cleanup function.
 */
export function setupNotificationResponseListener() {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data ?? {};

    // Deep link: if the notification says to open ScanQR, navigate there
    if (data.screen === 'ScanQR' || data.type === 'session_started') {
      if (navigationRef.isReady()) {
        navigationRef.navigate('ScanQR');
      }
    }
  });

  return () => subscription.remove();
}
