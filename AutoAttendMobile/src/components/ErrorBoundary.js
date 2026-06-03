/**
 * ErrorBoundary — catches all unhandled JS errors and shows a friendly screen.
 * Uses expo-updates to reload the app when the user taps "Restart".
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Uncaught error:', error, info);
  }

  async handleRestart() {
    try {
      // expo-updates preferred; falls back to state reset (re-renders root)
      const Updates = await import('expo-updates');
      await Updates.reloadAsync();
    } catch {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message} numberOfLines={4}>
          {this.state.error?.message ?? 'An unexpected error occurred.'}
        </Text>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => this.handleRestart()}
          activeOpacity={0.8}
        >
          <Text style={styles.btnText}>Restart App</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 32,
  },
  icon: { fontSize: 56, marginBottom: 16 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1e3a5f',
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  btn: {
    backgroundColor: '#1a237e',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
