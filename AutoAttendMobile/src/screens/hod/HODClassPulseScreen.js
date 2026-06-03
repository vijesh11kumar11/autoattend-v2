/**
 * HOD — ClassPulse Department Analytics (H9)
 *  GET /classpulse/hod/department-analytics
 *  GET /classpulse/hod/subject/{sid}/full-report
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const pctColor = (p) => (p >= 75 ? '#22c55e' : p >= 60 ? '#f59e0b' : '#ef4444');

export default function HODClassPulseScreen({ route }) {
  const departmentId = route?.params?.departmentId; // optional — for principal drilldown
  const [data, setData] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const params = departmentId ? { department_id: departmentId } : {};
      const { data: d } = await client.get('/classpulse/hod/department-analytics', { params });
      setData(d);
    } catch (err) {
      console.warn('[HODClassPulse]', err?.message);
    }
  }, [departmentId]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const openSubject = async (sid) => {
    try {
      const { data: d } = await client.get(`/classpulse/hod/subject/${sid}/full-report`);
      setReport(d);
    } catch (err) {
      /* ignore */
    }
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  const stats = data?.department_stats ?? {};

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <Text style={styles.heading}>📊 ClassPulse Analytics</Text>

        <View style={styles.statsGrid}>
          <Stat label="Total Capsules" value={stats.total_capsules ?? 0} icon="film-outline" />
          <Stat
            label="Avg Engagement"
            value={`${(stats.avg_engagement_pct ?? 0).toFixed(0)}%`}
            color={pctColor(stats.avg_engagement_pct ?? 0)}
            icon="pulse-outline"
          />
          <Stat
            label="Avg Comprehension"
            value={`${(stats.avg_comprehension_pct ?? 0).toFixed(0)}%`}
            color={pctColor(stats.avg_comprehension_pct ?? 0)}
            icon="bulb-outline"
          />
          <Stat
            label="Students at Risk"
            value={stats.students_at_risk_count ?? 0}
            color="#ef4444"
            icon="warning-outline"
          />
        </View>

        <Text style={styles.section}>Subjects</Text>
        {(data?.subjects_overview ?? []).length === 0 ? (
          <Text style={styles.empty}>No subjects.</Text>
        ) : (
          (data?.subjects_overview ?? []).map((s) => (
            <TouchableOpacity
              key={s.subject_id ?? s.id}
              style={styles.card}
              onPress={() => openSubject(s.subject_id ?? s.id)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{s.subject_name ?? s.name}</Text>
                <Text style={styles.meta}>
                  {s.capsules_count ?? 0} capsules · Eng {(s.avg_engagement ?? 0).toFixed(0)}% ·
                  Comp {(s.avg_comprehension ?? 0).toFixed(0)}%
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>
          ))
        )}

        {(data?.top_doubts ?? []).length > 0 && (
          <>
            <Text style={styles.section}>Top Doubts</Text>
            {data.top_doubts.slice(0, 8).map((d, i) => (
              <View key={i} style={styles.doubtRow}>
                <Ionicons name="help-circle-outline" size={14} color="#f59e0b" />
                <Text style={styles.doubtTxt}>
                  {typeof d === 'string' ? d : (d.text ?? d.doubt ?? JSON.stringify(d))}
                </Text>
              </View>
            ))}
          </>
        )}

        {(data?.teachers_not_using ?? []).length > 0 && (
          <>
            <Text style={styles.section}>Teachers Not Using</Text>
            {data.teachers_not_using.map((t, i) => (
              <View key={i} style={styles.notUsingRow}>
                <Ionicons name="person-circle-outline" size={16} color="#ef4444" />
                <Text style={styles.notUsingTxt}>
                  {t.name ?? t.teacher_name ?? `Teacher ${t.id}`}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal
        visible={!!report}
        animationType="slide"
        transparent
        onRequestClose={() => setReport(null)}
      >
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]}>
            <ScrollView>
              <Text style={styles.modalTitle}>{report?.subject_name ?? 'Subject Report'}</Text>
              <Text style={styles.meta}>{report?.capsules_count ?? 0} capsules</Text>

              {report?.recent_capsules?.length > 0 && (
                <>
                  <Text style={styles.label}>Recent Capsules</Text>
                  {report.recent_capsules.slice(0, 10).map((c, i) => (
                    <View key={i} style={styles.miniCard}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e293b' }}>
                        {c.title ?? `Capsule ${c.id}`}
                      </Text>
                      <Text style={styles.meta}>
                        Eng {(c.engagement_pct ?? 0).toFixed(0)}% · Comp{' '}
                        {(c.comprehension_pct ?? 0).toFixed(0)}%
                      </Text>
                    </View>
                  ))}
                </>
              )}

              {report?.knowledge_gaps?.length > 0 && (
                <>
                  <Text style={styles.label}>Knowledge Gaps</Text>
                  {report.knowledge_gaps.slice(0, 10).map((g, i) => (
                    <Text key={i} style={[styles.doubtTxt, { marginBottom: 4 }]}>
                      • {typeof g === 'string' ? g : (g.topic ?? JSON.stringify(g))}
                    </Text>
                  ))}
                </>
              )}

              <TouchableOpacity
                style={[styles.bigBtn, { marginTop: 14 }]}
                onPress={() => setReport(null)}
              >
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
  statBox: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statVal: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  statLbl: { fontSize: 10, color: '#94a3b8', fontWeight: '700', textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  doubtRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fffbeb',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
    gap: 6,
  },
  doubtTxt: { flex: 1, fontSize: 12, color: '#92400e' },
  notUsingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
    gap: 8,
  },
  notUsingTxt: { fontSize: 12, color: '#991b1b', fontWeight: '600' },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: PRIMARY, marginBottom: 4 },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 12, marginBottom: 8 },
  miniCard: { backgroundColor: '#f8fafc', padding: 10, borderRadius: 8, marginBottom: 4 },
  bigBtn: { backgroundColor: PRIMARY, padding: 12, borderRadius: 10, alignItems: 'center' },
  bigBtnTxt: { color: '#fff', fontWeight: '700' },
});
