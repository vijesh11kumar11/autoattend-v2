/**
 * Teacher — Session Health Report (T4)
 *  GET /api/live/sessions/{session_id}/health-report
 *  Expects route.params.session_id.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const scoreColor = s => (s >= 80 ? '#22c55e' : s >= 60 ? '#f59e0b' : '#ef4444');

export default function SessionHealthReportScreen({ route }) {
  const { session_id } = route?.params ?? {};
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!session_id) return;
    try {
      const { data } = await client.get(`/live/sessions/${session_id}/health-report`);
      setData(data);
    } catch (err) { console.warn('[Health] error:', err?.message); }
  }, [session_id]);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  if (!data) return <View style={styles.center}><Text style={styles.err}>Could not load.</Text></View>;

  const score = data.overall_score ?? data.health_score ?? 0;
  const metrics = data.metrics ?? {};

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <Text style={styles.heading}>🩺 Session Health</Text>

        <View style={[styles.scoreCard, { borderColor: scoreColor(score) }]}>
          <Text style={[styles.scoreVal, { color: scoreColor(score) }]}>{Number(score).toFixed(0)}</Text>
          <Text style={styles.scoreLabel}>Overall Score</Text>
        </View>

        {data.subject_name ? <InfoRow icon="book-outline" label="Subject" value={data.subject_name} /> : null}
        {data.attendance_percentage != null ? <InfoRow icon="people-outline" label="Attendance" value={`${data.attendance_percentage.toFixed(1)}%`} /> : null}
        {data.duration_minutes != null ? <InfoRow icon="time-outline" label="Duration" value={`${data.duration_minutes} min`} /> : null}

        {Object.keys(metrics).length > 0 && (
          <>
            <Text style={styles.section}>Metrics</Text>
            {Object.entries(metrics).map(([k, v]) => (
              <View key={k} style={styles.metricRow}>
                <Text style={styles.metricKey}>{k.replace(/_/g, ' ')}</Text>
                <Text style={styles.metricVal}>{typeof v === 'number' ? v.toFixed(1) : String(v)}</Text>
              </View>
            ))}
          </>
        )}

        {data.pulse_results?.length > 0 && (
          <>
            <Text style={styles.section}>Pulse Results</Text>
            {data.pulse_results.map((p, i) => (
              <View key={i} style={styles.pulseCard}>
                <Text style={styles.pulseQ}>{p.question ?? p.question_text}</Text>
                <Text style={styles.pulseMeta}>
                  {p.correct_count ?? 0}/{p.response_count ?? 0} correct
                  {p.correct_answer ? ` · Ans: ${p.correct_answer}` : ''}
                </Text>
              </View>
            ))}
          </>
        )}

        {data.ai_narrative ? (
          <View style={styles.narrative}>
            <Text style={styles.section}>🤖 AI Insights</Text>
            <Text style={styles.narrativeTxt}>{data.ai_narrative}</Text>
          </View>
        ) : null}

        {data.recommendations?.length > 0 && (
          <>
            <Text style={styles.section}>Recommendations</Text>
            {data.recommendations.map((r, i) => (
              <View key={i} style={styles.bullet}>
                <Ionicons name="bulb-outline" size={14} color="#f59e0b" />
                <Text style={styles.bulletTxt}>{typeof r === 'string' ? r : JSON.stringify(r)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color="#94a3b8" />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoVal}>{String(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { color: '#ef4444' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY, marginBottom: 14 },
  scoreCard: { backgroundColor: '#fff', borderRadius: 14, padding: 24, alignItems: 'center', borderWidth: 3, marginBottom: 16 },
  scoreVal: { fontSize: 56, fontWeight: '900' },
  scoreLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '700', marginTop: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  infoLabel: { fontSize: 12, color: '#94a3b8', width: 100 },
  infoVal: { fontSize: 13, color: '#1e293b', fontWeight: '600', flex: 1 },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 10, marginTop: 18 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  metricKey: { fontSize: 12, color: '#475569', textTransform: 'capitalize' },
  metricVal: { fontSize: 13, color: '#1e293b', fontWeight: '700' },
  pulseCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  pulseQ: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  pulseMeta: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  narrative: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 14, marginTop: 14, borderLeftWidth: 4, borderLeftColor: '#3b82f6' },
  narrativeTxt: { fontSize: 13, color: '#1e293b', lineHeight: 19 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  bulletTxt: { flex: 1, fontSize: 13, color: '#1e293b' },
});
