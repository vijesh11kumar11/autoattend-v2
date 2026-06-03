/**
 * HOD — Semester Progress Screen
 * GET /api/analytics/semester-progress
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

export default function SemesterProgressScreen() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data: d } = await client.get('/analytics/semester-progress');
      setData(d);
    } catch (err) {
      console.warn('[SemesterProgress] fetch error:', err?.message);
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
        <Text style={styles.err}>Failed to load.</Text>
      </View>
    );

  const subjects = data.subjects ?? data.subject_progress ?? [];
  const overall = data.overall_progress ?? data.overall_pct ?? 0;
  const weeks = data.weeks_elapsed ?? data.week ?? null;
  const totalWeeks = data.total_weeks ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <Text style={styles.heading}>📅 Semester Progress</Text>
        {weeks != null && (
          <Text style={styles.sub}>
            Week {weeks}
            {totalWeeks ? ` of ${totalWeeks}` : ''}
          </Text>
        )}

        <View style={styles.overallCard}>
          <Text style={styles.overallLabel}>Overall Sessions Completed</Text>
          <Text style={[styles.overallVal, { color: pctColor(overall) }]}>
            {Number(overall).toFixed(1)}%
          </Text>
          <View style={styles.bar}>
            <View
              style={[
                styles.fill,
                { width: `${Math.min(overall, 100)}%`, backgroundColor: pctColor(overall) },
              ]}
            />
          </View>
        </View>

        <Text style={styles.section}>Subject-wise Progress</Text>
        {subjects.length === 0 ? (
          <Text style={styles.empty}>No subject data yet.</Text>
        ) : (
          subjects.map((s, i) => {
            const pct = s.progress_pct ?? s.completion_pct ?? s.pct ?? 0;
            return (
              <View key={s.id ?? i} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{s.name ?? s.subject_name}</Text>
                  <Text style={styles.meta}>
                    {s.code ?? ''} · {s.sessions_done ?? s.completed ?? 0}/
                    {s.total_sessions ?? s.total ?? '?'} sessions
                  </Text>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.fill,
                        { width: `${Math.min(pct, 100)}%`, backgroundColor: pctColor(pct) },
                      ]}
                    />
                  </View>
                </View>
                <Text style={[styles.cardPct, { color: pctColor(pct) }]}>{Math.round(pct)}%</Text>
              </View>
            );
          })
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
  err: { fontSize: 14, color: '#ef4444' },
  overallCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  overallLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  overallVal: { fontSize: 28, fontWeight: '900', marginVertical: 8 },
  bar: { height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginTop: 6 },
  fill: { height: '100%', borderRadius: 4 },
  section: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  name: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2, marginBottom: 6 },
  cardPct: { fontSize: 16, fontWeight: '800' },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
});
