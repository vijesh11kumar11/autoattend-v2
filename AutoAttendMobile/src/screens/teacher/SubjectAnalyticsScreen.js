/**
 * Teacher — Subject Analytics Screen
 * GET /api/teacher/subject/{subject_id}/analytics
 * Shows top10 lowest / highest attendance and overall metrics.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const pctColor = p => (p >= 75 ? '#22c55e' : p >= 65 ? '#f59e0b' : '#ef4444');

function StudentRow({ s, danger }) {
  const pct = s.attendance_pct ?? s.pct ?? 0;
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: danger ? '#ef4444' : '#22c55e' }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{s.name ?? s.student_name ?? '—'}</Text>
        <Text style={styles.rowMeta}>{s.roll_no ?? s.email ?? ''}</Text>
      </View>
      <Text style={[styles.rowPct, { color: pctColor(pct) }]}>{pct.toFixed?.(0) ?? pct}%</Text>
    </View>
  );
}

export default function SubjectAnalyticsScreen({ route }) {
  const { subject_id, subject_name } = route.params || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!subject_id) return;
    try {
      const { data: d } = await client.get(`/teacher/subject/${subject_id}/analytics`);
      setData(d);
    } catch (err) { console.warn('[SubjectAnalytics] fetch error:', err?.message); }
  }, [subject_id]);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  if (!data)   return <View style={styles.center}><Text style={styles.errTxt}>Failed to load analytics.</Text></View>;

  const students = data.students ?? data.student_attendance ?? [];
  const sorted = [...students].sort((a, b) => (a.attendance_pct ?? 0) - (b.attendance_pct ?? 0));
  const lowest  = sorted.slice(0, 10);
  const highest = [...sorted].reverse().slice(0, 10);
  const avg     = data.avg_attendance ?? data.avg_pct ?? 0;
  const sessions = data.total_sessions ?? data.sessions ?? 0;
  const total    = data.total_students ?? students.length;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <Text style={styles.heading}>📊 {subject_name ?? data.subject_name ?? 'Subject'}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}><Ionicons name="people-outline" size={20} color={PRIMARY}/><Text style={styles.statV}>{total}</Text><Text style={styles.statL}>Students</Text></View>
          <View style={styles.stat}><Ionicons name="calendar-outline" size={20} color={PRIMARY}/><Text style={styles.statV}>{sessions}</Text><Text style={styles.statL}>Sessions</Text></View>
          <View style={styles.stat}><Ionicons name="stats-chart-outline" size={20} color={pctColor(avg)}/><Text style={[styles.statV, {color: pctColor(avg)}]}>{Number(avg).toFixed(1)}%</Text><Text style={styles.statL}>Avg</Text></View>
        </View>

        <Text style={styles.section}>⚠️ Top 10 — Lowest Attendance</Text>
        {lowest.length === 0
          ? <Text style={styles.empty}>No student data available.</Text>
          : lowest.map((s, i) => <StudentRow key={`l-${s.id ?? i}`} s={s} danger />)}

        <Text style={styles.section}>🏆 Top 10 — Highest Attendance</Text>
        {highest.length === 0
          ? <Text style={styles.empty}>No student data available.</Text>
          : highest.map((s, i) => <StudentRow key={`h-${s.id ?? i}`} s={s} />)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  statV: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  statL: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 16, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  rowName: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  rowMeta: { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  rowPct: { fontSize: 14, fontWeight: '800' },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 10 },
  errTxt: { fontSize: 14, color: '#ef4444' },
});
