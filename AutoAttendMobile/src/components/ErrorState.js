/**
 * ErrorState — friendly fallback for when a fetch fails.
 * Used by screens that previously rendered a blank/empty list on error.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const PRIMARY = '#1a237e';

export default function ErrorState({
  message = 'Unable to load data. Pull down to refresh.',
  onRetry,
  retrying = false,
}) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="cloud-offline-outline" size={48} color="#cbd5e1" />
      <Text style={styles.msg}>{message}</Text>
      {typeof onRetry === 'function' && (
        <TouchableOpacity
          style={[styles.btn, retrying && styles.btnDisabled]}
          onPress={onRetry}
          disabled={retrying}
          activeOpacity={0.85}
        >
          {retrying ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.btnText}>Retry</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  msg: { fontSize: 14, color: '#64748b', textAlign: 'center', marginTop: 12 },
  btn: {
    marginTop: 16,
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
