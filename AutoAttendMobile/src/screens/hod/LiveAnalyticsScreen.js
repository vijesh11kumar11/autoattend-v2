/**
 * HOD — Live Session Analytics (H6)
 *  GET /hod/dashboard
 *  GET /hod/live-sessions/overview
 *  GET /hod/live-sessions/teacher/{id}/details
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const scoreColor = s => (s >= 80 ? '#22c55e' : s >= 60 ? '#f59e0b' : '#ef4444');

export default function LiveAnalyticsScreen() {
  const [dash, setDash]           = useState(null);
  const [overview, setOverview]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail]       = useState(null);  // teacher detail modal

  const fetchData = useCallback(async () => {
    try {
      const [d, o] = await Promise.allSettled([
        client.get('/hod/dashboard'),
        client.get('/hod/live-sessions/overview'),
      ]);
      if (d.status === 'fulfilled') setDash(d.value.data);
      if (o.status === 'fulfilled') setOverview(o.value.data);
    } catch (err) { console.warn('[LiveAnalytics]', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const openTeacher = async tid => {
    try {
      const { data } = await client.get(`/hod/live-sessions/teacher/${tid}/details`);
      setDetail(data);
    } catch (err) { /* ignore */ }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  const monthly = dash?.live_sessions_this_month ?? {};

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <Text style={styles.heading}>📡 Live Session Analytics</Text>

        <View style={styles.statsGrid}>
          <Stat label="Sessions" value={monthly.total_sessions ?? 0} icon="radio-outline" />
          <Stat label="Avg Health" value={`${(monthly.average_health_score ?? 0).toFixed(0)}`}
            color={scoreColor(monthly.average_health_score ?? 0)} icon="pulse-outline" />
          <Stat label="Hours" value={(monthly.total_live_attendance_hours ?? 0).toFixed(0)} icon="time-outline" />
          <Stat label="Teachers" value={monthly.teachers_using_live ?? 0} icon="people-outline" />
          <Stat label="Capsules" value={monthly.auto_capsules_generated ?? 0} icon="film-outline" />
          <Stat label="Zero-Live" value={monthly.subjects_with_zero_live_sessions ?? 0} icon="alert-circle-outline" />
        </View>

        <Text style={styles.section}>By Teacher</Text>
        {(overview?.sessions_by_teacher ?? []).length === 0 ? <Text style={styles.empty}>No teacher data.</Text> :
          (overview?.sessions_by_teacher ?? []).map(t => (
            <TouchableOpacity key={t.teacher_id ?? t.id} style={styles.card}
              onPress={() => openTeacher(t.teacher_id ?? t.id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t.teacher_name ?? t.name}</Text>
                <Text style={styles.meta}>{t.session_count ?? t.sessions ?? 0} sessions · Avg {(t.avg_health_score ?? 0).toFixed(0)}</Text>
              </View>
              <View style={[styles.scoreBadge, { backgroundColor: scoreColor(t.avg_health_score ?? 0) }]}>
                <Text style={styles.scoreTxt}>{(t.avg_health_score ?? 0).toFixed(0)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          ))}

        {(overview?.department_knowledge_gaps ?? []).length > 0 && (
          <>
            <Text style={styles.section}>📌 Knowledge Gaps</Text>
            {overview.department_knowledge_gaps.slice(0, 10).map((g, i) => (
              <View key={i} style={styles.gapRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                <Text style={styles.gapTxt}>{typeof g === 'string' ? g : (g.topic ?? JSON.stringify(g))}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]}>
            <ScrollView>
              <Text style={styles.modalTitle}>{detail?.teacher_name ?? 'Teacher Details'}</Text>

              {detail?.trend_graph?.length > 0 && (
                <>
                  <Text style={styles.label}>Health Trend</Text>
                  <View style={styles.trendRow}>
                    {detail.trend_graph.slice(-7).map((p, i) => (
                      <View key={i} style={styles.trendCell}>
                        <View style={[styles.trendBar, { height: Math.max(8, (p.avg_health_score ?? 0) * 0.8), backgroundColor: scoreColor(p.avg_health_score ?? 0) }]} />
                        <Text style={styles.trendTxt}>{(p.date ?? '').slice(5, 10)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {detail?.recent_sessions?.length > 0 && (
                <>
                  <Text style={styles.label}>Recent Sessions</Text>
                  {detail.recent_sessions.slice(0, 5).map((s, i) => (
                    <View key={i} style={styles.recentRow}>
                      <Text style={{ fontSize: 12, color: '#1e293b', flex: 1 }}>{s.subject_name ?? s.title ?? `Session ${s.id}`}</Text>
                      <Text style={[styles.scoreTxt, { color: scoreColor(s.health_score ?? 0) }]}>{(s.health_score ?? 0).toFixed(0)}</Text>
                    </View>
                  ))}
                </>
              )}

              {detail?.ai_pattern_observation && (
                <View style={styles.aiBox}>
                  <Text style={styles.label}>🤖 AI Observation</Text>
                  <Text style={styles.aiTxt}>{detail.ai_pattern_observation}</Text>
                </View>
              )}

              <TouchableOpacity style={[styles.bigBtn, { marginTop: 12 }]} onPress={() => setDetail(null)}>
                <Text style={styles.bigBtnTxt}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value, color, icon }) {
  return (
    <View style={styles.statBox}>
      <Ionicons name={icon} size={20} color={color ?? PRIMARY} />
      <Text style={[styles.statVal, color && { color }]}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY, marginBottom: 14 },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 18, marginBottom: 10 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statBox: { width: '31%', backgroundColor: '#fff', borderRadius: 10, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  statVal: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  statLbl: { fontSize: 10, color: '#94a3b8', fontWeight: '700', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  scoreBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  scoreTxt: { fontSize: 12, fontWeight: '800', color: '#fff' },
  gapRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef2f2', padding: 10, borderRadius: 8, marginBottom: 4, gap: 6 },
  gapTxt: { flex: 1, fontSize: 12, color: '#1e293b' },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 20 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: PRIMARY, marginBottom: 12 },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 12, marginBottom: 8 },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 100 },
  trendCell: { flex: 1, alignItems: 'center' },
  trendBar: { width: '70%', borderRadius: 3 },
  trendTxt: { fontSize: 9, color: '#94a3b8', marginTop: 2 },
  recentRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 10, borderRadius: 8, marginBottom: 4 },
  aiBox: { backgroundColor: '#eff6ff', padding: 12, borderRadius: 10, marginTop: 12, borderLeftWidth: 4, borderLeftColor: '#3b82f6' },
  aiTxt: { fontSize: 12, color: '#1e293b', lineHeight: 17 },
  bigBtn: { backgroundColor: PRIMARY, padding: 12, borderRadius: 10, alignItems: 'center' },
  bigBtnTxt: { color: '#fff', fontWeight: '700' },
});
