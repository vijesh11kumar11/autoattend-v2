/**
 * Principal — College Overview Screen
 * Shows college-wide stats, department breakdown, and 30-day trend.
 * API: GET /api/principal/stats
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

function StatCard({ icon, label, value, color }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={22} color={color || PRIMARY} />
      <Text style={[styles.statVal, color ? { color } : {}]}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function CollegeOverviewScreen() {
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await client.get('/principal/stats');
      setData(res.data);
    } catch (err) { console.warn("[CollegeOverviewScreen] fetch error:", err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  if (!data) return <View style={styles.center}><Text style={{ color: '#ef4444' }}>Failed to load.</Text></View>;

  const stats = data.stats ?? [];
  const depts = data.departments ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>

        <Text style={styles.heading}>🏢 {data.college?.name ?? 'College Overview'}</Text>

        {/* Stats strip */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
          {stats.length > 0 ? stats.map((s, i) => (
            <StatCard key={i} icon={
              ['business-outline', 'school-outline', 'people-outline', 'stats-chart-outline', 'notifications-outline'][i] ?? 'ellipse-outline'
            } label={s.label} value={s.value} color={s.label?.includes('Avg') ? pctColor(parseFloat(s.value)) : undefined} />
          )) : (
            <>
              <StatCard icon="business-outline" label="Departments" value={depts.length} />
              <StatCard icon="school-outline" label="Students" value="—" />
              <StatCard icon="people-outline" label="Teachers" value="—" />
            </>
          )}
        </ScrollView>

        {/* Departments */}
        <Text style={styles.section}>Departments ({depts.length})</Text>
        {depts.map(d => {
          const avg = d.avg_attendance ?? d.attendance_pct ?? 0;
          return (
            <View key={d.id ?? d.name} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deptName}>{d.name}</Text>
                <Text style={styles.deptMeta}>
                  {d.teacher_count ?? 0} teachers · {d.student_count ?? 0} students
                </Text>
              </View>
              <View style={styles.pctCol}>
                <Text style={[styles.pctVal, { color: pctColor(avg) }]}>{avg.toFixed(0)}%</Text>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.min(avg, 100)}%`, backgroundColor: pctColor(avg) }]} />
                </View>
              </View>
            </View>
          );
        })}

        {depts.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="business-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No departments found.</Text>
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
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY, marginBottom: 16 },
  stat: { width: 105, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginRight: 10, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  statVal: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  statLabel: { fontSize: 10, color: '#94a3b8', fontWeight: '600', textAlign: 'center' },
  section: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  deptName: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  deptMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  pctCol: { alignItems: 'flex-end', width: 60 },
  pctVal: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  bar: { height: 4, width: 50, borderRadius: 2, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
