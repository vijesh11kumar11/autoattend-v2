/**
 * Student — Attendance Forecast (S1)
 * GET /api/student/portal/attendance-forecast
 * Shows per-subject "can miss X / need Y more classes" projections.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, SafeAreaView,
  StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const pctColor = p => (p >= 75 ? '#22c55e' : p >= 65 ? '#f59e0b' : '#ef4444');

export default function AttendanceForecastScreen() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overall, setOverall] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/student/portal/attendance-forecast');
      setItems(data?.subjects ?? data?.forecasts ?? data ?? []);
      setOverall(data?.overall ?? null);
    } catch (err) { console.warn('[Forecast] fetch error:', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={Array.isArray(items) ? items : []}
        keyExtractor={(s, i) => String(s.id ?? s.subject_id ?? i)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>📊 Attendance Forecast</Text>
            <Text style={styles.sub}>Plan your absences without dropping below 75%.</Text>
            {overall && (
              <View style={styles.overallCard}>
                <Ionicons name="stats-chart-outline" size={22} color={pctColor(overall.percentage ?? 0)} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.overallLabel}>Overall</Text>
                  <Text style={[styles.overallVal, { color: pctColor(overall.percentage ?? 0) }]}>
                    {(overall.percentage ?? 0).toFixed(1)}% · {overall.present ?? 0}/{overall.total ?? 0}
                  </Text>
                </View>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="document-outline" size={40} color="#cbd5e1" /><Text style={styles.emptyTxt}>No forecast data.</Text></View>}
        renderItem={({ item: s }) => {
          const pct = s.percentage ?? s.attendance_percentage ?? 0;
          const canMiss = s.can_skip ?? s.can_miss ?? 0;
          const needMore = s.need_more ?? s.need_to_attend ?? 0;
          const safe = pct >= 75;
          return (
            <View style={[styles.card, { borderLeftColor: pctColor(pct) }]}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subjName}>{s.name ?? s.subject_name ?? '—'}</Text>
                  <Text style={styles.subjMeta}>{s.code ?? s.subject_code ?? ''} · {s.present ?? 0}/{s.total ?? 0}</Text>
                </View>
                <Text style={[styles.pct, { color: pctColor(pct) }]}>{pct.toFixed(0)}%</Text>
              </View>
              <View style={[styles.advice, { backgroundColor: safe ? '#f0fdf4' : '#fef2f2' }]}>
                <Ionicons name={safe ? 'checkmark-circle' : 'warning'} size={18} color={safe ? '#22c55e' : '#ef4444'} />
                <Text style={[styles.adviceTxt, { color: safe ? '#15803d' : '#b91c1c' }]}>
                  {safe
                    ? `You can miss ${canMiss} more class${canMiss === 1 ? '' : 'es'} and stay safe.`
                    : `You need to attend ${needMore} more class${needMore === 1 ? '' : 'es'} to reach 75%.`}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 14 },
  overallCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 14 },
  overallLabel: { fontSize: 11, color: '#64748b', fontWeight: '700' },
  overallVal: { fontSize: 18, fontWeight: '900', marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0', borderLeftWidth: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  subjName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  subjMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  pct: { fontSize: 20, fontWeight: '900' },
  advice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8 },
  adviceTxt: { flex: 1, fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { fontSize: 13, color: '#94a3b8', marginTop: 10 },
});
