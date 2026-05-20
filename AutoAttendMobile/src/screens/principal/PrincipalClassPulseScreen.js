/**
 * Principal — ClassPulse Overview (P1)
 *  GET /principal/stats              → list of departments
 *  GET /classpulse/hod/department-analytics?department_id={id}
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const pctColor = p => (p >= 75 ? '#22c55e' : p >= 60 ? '#f59e0b' : '#ef4444');

export default function PrincipalClassPulseScreen() {
  const [stats, setStats]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [activeDept, setActiveDept] = useState(null);
  const [busy, setBusy]           = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/principal/stats');
      setStats(data);
    } catch (err) { console.warn('[PrincipalCP]', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const openDept = async d => {
    setActiveDept(d); setBusy(true); setAnalytics(null);
    try {
      const { data } = await client.get('/classpulse/hod/department-analytics', { params: { department_id: d.id } });
      setAnalytics(data);
    } catch (err) { /* swallow */ }
    finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  const departments = stats?.departments ?? stats?.department_stats ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <Text style={styles.heading}>📊 ClassPulse — All Departments</Text>
        <Text style={styles.sub}>Tap a department to view detailed analytics.</Text>

        {departments.length === 0 ? <Text style={styles.empty}>No departments.</Text> :
          departments.map(d => (
            <TouchableOpacity key={d.id ?? d.department_id} style={styles.card} onPress={() => openDept({ id: d.id ?? d.department_id, name: d.name ?? d.department_name })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{d.name ?? d.department_name}</Text>
                <Text style={styles.meta}>
                  {d.total_students ?? 0} students · {d.total_teachers ?? 0} teachers · Avg {(d.avg_attendance ?? d.attendance_pct ?? 0).toFixed(0)}%
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>
          ))}
      </ScrollView>

      <Modal visible={!!activeDept} animationType="slide" transparent onRequestClose={() => { setActiveDept(null); setAnalytics(null); }}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{activeDept?.name}</Text>
              <TouchableOpacity onPress={() => { setActiveDept(null); setAnalytics(null); }}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            {busy ? <ActivityIndicator color={PRIMARY} style={{ marginVertical: 30 }} /> :
              !analytics ? <Text style={styles.empty}>No data.</Text> :
              <ScrollView>
                <View style={styles.statsGrid}>
                  <Stat label="Capsules" value={analytics?.department_stats?.total_capsules ?? 0} icon="film-outline" />
                  <Stat label="Engagement" value={`${(analytics?.department_stats?.avg_engagement_pct ?? 0).toFixed(0)}%`}
                    color={pctColor(analytics?.department_stats?.avg_engagement_pct ?? 0)} icon="pulse-outline" />
                  <Stat label="Comprehension" value={`${(analytics?.department_stats?.avg_comprehension_pct ?? 0).toFixed(0)}%`}
                    color={pctColor(analytics?.department_stats?.avg_comprehension_pct ?? 0)} icon="bulb-outline" />
                  <Stat label="At Risk" value={analytics?.department_stats?.students_at_risk_count ?? 0}
                    color="#ef4444" icon="warning-outline" />
                </View>

                {(analytics?.subjects_overview ?? []).length > 0 && (
                  <>
                    <Text style={styles.section}>Subjects</Text>
                    {analytics.subjects_overview.slice(0, 20).map(s => (
                      <View key={s.subject_id ?? s.id} style={styles.miniCard}>
                        <Text style={styles.title}>{s.subject_name ?? s.name}</Text>
                        <Text style={styles.meta}>{s.capsules_count ?? 0} capsules · Eng {(s.avg_engagement ?? 0).toFixed(0)}% · Comp {(s.avg_comprehension ?? 0).toFixed(0)}%</Text>
                      </View>
                    ))}
                  </>
                )}

                {(analytics?.top_doubts ?? []).length > 0 && (
                  <>
                    <Text style={styles.section}>Top Doubts</Text>
                    {analytics.top_doubts.slice(0, 8).map((d, i) => (
                      <View key={i} style={styles.doubtRow}>
                        <Ionicons name="help-circle-outline" size={14} color="#f59e0b" />
                        <Text style={styles.doubtTxt}>{typeof d === 'string' ? d : (d.text ?? d.doubt ?? JSON.stringify(d))}</Text>
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value, color, icon }) {
  return (
    <View style={styles.statBox}>
      <Ionicons name={icon} size={18} color={color ?? PRIMARY} />
      <Text style={[styles.statVal, color && { color }]}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY, marginBottom: 4 },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 14 },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 14, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 20 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: PRIMARY },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statBox: { width: '48%', backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, alignItems: 'center', gap: 2 },
  statVal: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  statLbl: { fontSize: 9, color: '#94a3b8', fontWeight: '700' },
  miniCard: { backgroundColor: '#f8fafc', padding: 10, borderRadius: 8, marginBottom: 4 },
  doubtRow: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fffbeb', padding: 10, borderRadius: 8, marginBottom: 4, gap: 6 },
  doubtTxt: { flex: 1, fontSize: 12, color: '#92400e' },
});
