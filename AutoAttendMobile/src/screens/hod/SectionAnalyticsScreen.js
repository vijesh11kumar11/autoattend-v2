/**
 * HOD — Section Analytics Screen
 * GET /api/hod/section-analytics
 * GET /api/sections (department's sections)
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

export default function SectionAnalyticsScreen() {
  const [analytics, setAnalytics] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        client.get('/hod/section-analytics').catch(() => ({ data: null })),
        client.get('/sections').catch(() => ({ data: null })),
      ]);
      setAnalytics(Array.isArray(a.data) ? a.data : (a.data?.sections ?? []));
      setSections(Array.isArray(s.data) ? s.data : []);
    } catch (err) { console.warn('[SectionAnalytics] fetch error:', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <Text style={styles.heading}>🧮 Section Analytics</Text>
        <Text style={styles.sub}>{sections.length} sections in your department</Text>

        {analytics.length > 0 ? analytics.map((s, i) => {
          const pct = s.avg_attendance ?? s.avg_pct ?? 0;
          return (
            <View key={s.id ?? i} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{s.section_name ?? s.name ?? `Section ${i + 1}`}</Text>
                <Text style={styles.meta}>
                  Sem {s.semester ?? '—'} · {s.student_count ?? 0} students · {s.session_count ?? 0} sessions
                </Text>
                <View style={styles.bar}>
                  <View style={[styles.fill, { width: `${Math.min(pct, 100)}%`, backgroundColor: pctColor(pct) }]} />
                </View>
              </View>
              <Text style={[styles.pct, { color: pctColor(pct) }]}>{Math.round(pct)}%</Text>
            </View>
          );
        }) : sections.length > 0 ? sections.map((s, i) => (
          <View key={s.id ?? i} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.meta}>Sem {s.semester ?? '—'} · {s.student_count ?? 0} students</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </View>
        )) : (
          <View style={styles.empty}>
            <Ionicons name="grid-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No section data yet.</Text>
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
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  name: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2, marginBottom: 6 },
  bar: { height: 6, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  pct: { fontSize: 16, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
