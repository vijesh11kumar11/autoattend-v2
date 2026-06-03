/**
 * Student — Timetable / Subject Schedule Screen
 * Shows enrolled subjects with attendance stats as a schedule overview.
 * API: GET /api/attendance/student/{id}/summary
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const PRIMARY = '#1a237e';
const pctColor = (p) => (p >= 75 ? '#22c55e' : p >= 65 ? '#f59e0b' : '#ef4444');

export default function TimetableScreen() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get(`/attendance/student/${user?.id}/summary`);
      setSubjects(data?.subjects ?? []);
    } catch (err) {
      console.warn('[TimetableScreen] fetch error:', err?.message);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  const renderItem = ({ item: s, index }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.numBadge}>
          <Text style={styles.numTxt}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.subName}>{s.subject_name}</Text>
          <Text style={styles.subCode}>
            {s.subject_code ?? ''} · Sem {s.semester ?? '—'}
          </Text>
        </View>
        <Text style={[styles.pct, { color: pctColor(s.percentage) }]}>{s.percentage}%</Text>
      </View>
      <View style={styles.bar}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(s.percentage, 100)}%`, backgroundColor: pctColor(s.percentage) },
          ]}
        />
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaTxt}>
          {s.present}/{s.total_sessions} attended
        </Text>
        <Text style={[styles.statusBadge, { color: pctColor(s.percentage) }]}>
          {s.attendance_status?.toUpperCase() ?? ''}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <FlatList
        data={subjects}
        keyExtractor={(s) => String(s.subject_id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
        ListHeaderComponent={<Text style={styles.heading}>📅 My Subjects ({subjects.length})</Text>}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="calendar-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No subjects found.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  heading: { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  numBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numTxt: { fontSize: 14, fontWeight: '700', color: PRIMARY },
  subName: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  subCode: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  pct: { fontSize: 18, fontWeight: '800' },
  bar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e2e8f0',
    marginTop: 12,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: 3 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  metaTxt: { fontSize: 12, color: '#64748b' },
  statusBadge: { fontSize: 11, fontWeight: '700' },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
});
