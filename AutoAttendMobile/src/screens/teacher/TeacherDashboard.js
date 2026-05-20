/**
 * Teacher — Dashboard Screen
 * Shows today's session status, quick actions, and assigned classes summary.
 * API: GET /api/faculty/{id}/classes
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const PRIMARY = '#1a237e';

export default function TeacherDashboard({ navigation }) {
  const { user } = useAuth();
  const [classes, setClasses]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get(`/faculty/${user?.id}/classes`);
      setClasses(Array.isArray(data) ? data : []);
    } catch (err) { console.warn("[TeacherDashboard] fetch error:", err?.message); }
  }, [user?.id]);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>

        {/* Header */}
        <Text style={styles.greeting}>{greeting}, {user?.name?.split(' ')[0] ?? 'Teacher'} 👋</Text>

        {/* Quick Actions */}
        <Text style={styles.section}>Quick Actions</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('QRGenerate')}>
            <Ionicons name="qr-code-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Generate QR</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('Classes')}>
            <Ionicons name="book-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>My Classes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('Reports')}>
            <Ionicons name="stats-chart-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Reports</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('LeaveManagement')}>
            <Ionicons name="mail-unread-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Leave Reqs</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.actionsRow, { marginTop: 12 }]}>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('Disputes')}>
            <Ionicons name="shield-checkmark-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Disputes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('TWMDashboard')}>
            <Ionicons name="people-circle-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>TWM</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('TutorDashboard')}>
            <Ionicons name="school-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Tutor</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('AttendanceHistory')}>
            <Ionicons name="calendar-clear-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>History</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.actionsRow, { marginTop: 12 }]}>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('MyLiveSessions')}>
            <Ionicons name="radio-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Live</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('CareerRoadmap')}>
            <Ionicons name="rocket-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Career</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('SuggestionBox')}>
            <Ionicons name="bulb-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Ideas</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('Feed')}>
            <Ionicons name="newspaper-outline" size={28} color={PRIMARY} />
            <Text style={styles.actionTxt}>Feed</Text>
          </TouchableOpacity>
        </View>

        {/* Classes */}
        <Text style={styles.section}>My Classes ({classes.length})</Text>
        {classes.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="book-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No classes assigned.</Text>
          </View>
        ) : (
          classes.map(c => (
            <View key={c.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.className}>{c.name}</Text>
                <Text style={styles.classMeta}>{c.code} · Sem {c.semester ?? '—'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  greeting: { fontSize: 22, fontWeight: '700', color: PRIMARY, marginBottom: 20 },
  section: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginTop: 20, marginBottom: 12 },
  actionsRow: { flexDirection: 'row', gap: 12 },
  actionCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  actionTxt: { fontSize: 12, fontWeight: '600', color: '#1e293b', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  className: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  classMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 30 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
