/**
 * BlockedScreen — full-screen, non-dismissable security dead-end (issue #86).
 *
 * Rendered by App.js INSTEAD of the app when the device is detected as rooted
 * or jailbroken. There is intentionally no navigation, no button, and no way
 * to dismiss it — the app is completely blocked.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

export default function BlockedScreen() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.iconWrap}>
        <Ionicons name="warning-outline" size={64} color="#fff" />
      </View>
      <Text style={styles.title}>Security Warning</Text>
      <Text style={styles.message}>
        AutoAttend cannot run on rooted or jailbroken devices. This policy protects the integrity of
        attendance records.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#b91c1c',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
  },
  message: {
    color: '#fee2e2',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 360,
  },
});
