/**
 * AutoAttend AI — Mobile root / jailbreak / emulator detection.
 *
 * Heuristic only — a determined attacker with root can defeat any
 * client-side check. The backend remains the source of truth (audit
 * log records is_rooted; principal can review).
 *
 * Strategy:
 *  - expo-device flags emulator (`Device.isDevice === false`).
 *  - expo-file-system probes for well-known root/jailbreak filesystem
 *    artifacts on Android and iOS.
 */

import * as Device      from 'expo-device';
import * as FileSystem  from 'expo-file-system';
import { Platform }     from 'react-native';

const ANDROID_ROOT_PATHS = [
  'file:///system/app/Superuser.apk',
  'file:///system/xbin/su',
  'file:///system/bin/su',
  'file:///sbin/su',
  'file:///data/local/su',
  'file:///data/local/bin/su',
  'file:///system/sd/xbin/su',
  'file:///data/local/xbin/su',
];

const IOS_JAILBREAK_PATHS = [
  'file:///Applications/Cydia.app',
  'file:///Library/MobileSubstrate/MobileSubstrate.dylib',
  'file:///bin/bash',
  'file:///usr/sbin/sshd',
  'file:///etc/apt',
  'file:///private/var/lib/apt/',
];

async function _existsAny(paths) {
  for (const p of paths) {
    try {
      const info = await FileSystem.getInfoAsync(p);
      if (info?.exists) return p;
    } catch {
      // permission errors are expected on most paths — ignore
    }
  }
  return null;
}

export async function checkDeviceSecurity() {
  // Emulator check
  if (Device.isDevice === false) {
    return { isSecure: false, reason: 'emulator_detected' };
  }

  const paths = Platform.OS === 'ios' ? IOS_JAILBREAK_PATHS : ANDROID_ROOT_PATHS;
  const hit   = await _existsAny(paths);
  if (hit) {
    return { isSecure: false, reason: `suspicious_path:${hit}` };
  }

  return { isSecure: true, reason: null };
}
