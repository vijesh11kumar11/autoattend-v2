import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function CollegeOverviewScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🏢</Text>
      <Text style={styles.title}>College Overview</Text>
      <Text style={styles.sub}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  icon:  { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#1a237e', marginBottom: 6 },
  sub:   { fontSize: 13, color: '#94a3b8' },
});
