/**
 * screenshotUtils — block screenshots / screen recording (issue #120).
 *
 * Provides the `usePreventScreenshot()` hook which, while the host screen is
 * mounted, prevents screen capture (Android FLAG_SECURE / iOS recording
 * detection) and logs any screenshot attempt. On unmount it restores normal
 * capture behaviour.
 *
 * Apply ONLY to sensitive screens that render QR codes (attendance QR
 * generate / scan) — NOT globally.
 *
 * ⚠️ Requires a custom EAS dev build; fails silently on unsupported
 *    platforms (e.g. Expo Go / web).
 */

import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

/**
 * Prevent screenshots / screen recording for the lifetime of the calling
 * component. No-op (silently) where the native module is unavailable.
 */
export function usePreventScreenshot() {
  useEffect(() => {
    let subscription;

    (async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync();
      } catch (e) {
        // Unsupported platform — fail silently.
      }

      try {
        subscription = ScreenCapture.addScreenshotListener(() => {
          console.warn('[screenshotUtils] screenshot attempt detected on a protected screen');
        });
      } catch (e) {
        // Listener unsupported — ignore.
      }
    })();

    return () => {
      try {
        subscription?.remove?.();
      } catch (e) {
        // ignore
      }
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, []);
}

export default { usePreventScreenshot };
