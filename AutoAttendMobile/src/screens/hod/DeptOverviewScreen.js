/**
 * HOD — Department Overview Screen
 * Shows department statistics: teachers, students, avg attendance, subjects.
 * API: GET /api/hod/dashboard
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const pctColor = (p) => (p >= 75 ? '#22c55e' : p >= 65 ? '#f59e0b' : '#ef4444');

function StatCard({ icon, label, value, color }) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={24} color={color || PRIMARY} />
      <Text style={[styles.statVal, color ? { color } : {}]}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function DeptOverviewScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await client.get('/hod/dashboard');
      setData(res.data);
    } catch (err) {
      console.warn('[DeptOverviewScreen] fetch error:', err?.message);
    }
  }, []);

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
  if (!data)
    return (
      <View style={styles.center}>
        <Text style={styles.errTxt}>Failed to load data.</Text>
      </View>
    );

  const avgPct = data.avg_attendance_pct ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <Text style={styles.heading}>📈 {data.department_name ?? 'Department'}</Text>
        <Text style={styles.sub}>Department overview & statistics</Text>

        {/* Stat Cards */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsRow}>
          <StatCard icon="people-outline" label="Teachers" value={data.teacher_count} />
          <StatCard icon="school-outline" label="Students" value={data.student_count} />
          <StatCard
            icon="stats-chart-outline"
            label="Avg %"
            value={`${avgPct.toFixed(1)}%`}
            color={pctColor(avgPct)}
          />
          <StatCard
            icon="hourglass-outline"
            label="Pending"
            value={data.pending_approvals}
            color={data.pending_approvals > 0 ? '#ef4444' : '#22c55e'}
          />
        </ScrollView>

        {/* Subjects Table */}
        <Text style={styles.section}>Subjects ({data.subjects?.length ?? 0})</Text>
        {(data.subjects ?? []).map((s) => (
          <View key={s.id} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{s.name}</Text>
              <Text style={styles.cardMeta}>
                {s.code} · Sem {s.semester ?? '—'} · {s.teacher_name || 'Unassigned'}
              </Text>
            </View>
            <View style={styles.pctBadge}>
              <Text style={[styles.pctTxt, { color: pctColor(s.avg_pct) }]}>
                {s.avg_pct?.toFixed(0) ?? 0}%
              </Text>
              <Text style={styles.sessionsTxt}>{s.sessions_done} sess</Text>
            </View>
          </View>
        ))}

        {(data.subjects ?? []).length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="library-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No subjects found.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 16 },
  statsRow: { marginBottom: 20 },
  statCard: {
    width: 110,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginRight: 10,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statVal: { fontSize: 20, fontWeight: '800', color: '#1e293b' },
  statLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  section: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  cardMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  pctBadge: { alignItems: 'flex-end' },
  pctTxt: { fontSize: 16, fontWeight: '800' },
  sessionsTxt: { fontSize: 10, color: '#94a3b8' },
  empty: { alignItems: 'center', paddingTop: 30 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
  errTxt: { fontSize: 14, color: '#ef4444' },
});
