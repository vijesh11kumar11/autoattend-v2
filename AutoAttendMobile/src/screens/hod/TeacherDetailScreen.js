/**
 * HOD — Teacher Detail Screen
 * Pulls teacher performance from GET /api/hod/teacher-performance
 * and filters by teacher_id (route param).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const pctColor = p => (p >= 75 ? '#22c55e' : p >= 65 ? '#f59e0b' : '#ef4444');

export default function TeacherDetailScreen({ route }) {
  const { teacher_id, teacher_name } = route.params || {};
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/hod/teacher-performance');
      setList(Array.isArray(data) ? data : (data?.teachers ?? []));
    } catch (err) { console.warn('[TeacherDetail] fetch error:', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const teacher = useMemo(
    () => list.find(t => String(t.id ?? t.teacher_id) === String(teacher_id)) ?? null,
    [list, teacher_id],
  );

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  if (!teacher) return (
    <View style={styles.center}>
      <Ionicons name="person-outline" size={40} color="#cbd5e1" />
      <Text style={styles.empty}>Teacher data not found.</Text>
    </View>
  );

  const avg = teacher.avg_attendance ?? teacher.avg_pct ?? 0;
  const subjects = teacher.subjects ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <View style={styles.headerCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{(teacher.name ?? teacher_name ?? '?')[0]?.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.name}>{teacher.name ?? teacher_name}</Text>
            <Text style={styles.email}>{teacher.email ?? ''}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}><Ionicons name="library-outline" size={20} color={PRIMARY}/><Text style={styles.statV}>{teacher.subject_count ?? subjects.length ?? 0}</Text><Text style={styles.statL}>Subjects</Text></View>
          <View style={styles.stat}><Ionicons name="calendar-outline" size={20} color={PRIMARY}/><Text style={styles.statV}>{teacher.total_sessions ?? teacher.sessions ?? 0}</Text><Text style={styles.statL}>Sessions</Text></View>
          <View style={styles.stat}><Ionicons name="stats-chart-outline" size={20} color={pctColor(avg)}/><Text style={[styles.statV, {color: pctColor(avg)}]}>{Number(avg).toFixed(1)}%</Text><Text style={styles.statL}>Avg %</Text></View>
        </View>

        <Text style={styles.section}>Subjects ({subjects.length})</Text>
        {subjects.length === 0 ? (
          <Text style={styles.emptyTxt}>No subject data.</Text>
        ) : subjects.map((s, i) => (
          <View key={s.id ?? i} style={styles.subCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subName}>{s.name ?? s.subject_name}</Text>
              <Text style={styles.subMeta}>{s.code ?? ''} · {s.sessions ?? s.sessions_done ?? 0} sessions</Text>
            </View>
            <Text style={[styles.subPct, { color: pctColor(s.avg_pct ?? 0) }]}>{Number(s.avg_pct ?? 0).toFixed(0)}%</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 20, fontWeight: '800', color: PRIMARY },
  name: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  email: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  statV: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  statL: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  subCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  subName: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  subMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  subPct: { fontSize: 14, fontWeight: '800' },
  empty: { fontSize: 13, color: '#94a3b8', marginTop: 10 },
  emptyTxt: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
});
