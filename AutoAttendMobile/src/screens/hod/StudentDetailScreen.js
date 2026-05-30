/**
 * HOD — Student Detail Screen
 * Uses existing endpoints:
 *   GET /api/attendance/student/{student_id}/summary
 *   GET /api/attendance/student/{student_id}/recent
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
function statusOf(p) {
  if (p < 65) return { label: 'Detained', color: '#7f1d1d', bg: '#fee2e2' };
  if (p < 70) return { label: 'Critical', color: '#b91c1c', bg: '#fee2e2' };
  if (p < 75) return { label: 'Warning', color: '#b45309', bg: '#fef3c7' };
  return { label: 'Safe', color: '#15803d', bg: '#dcfce7' };
}

export default function StudentDetailScreen({ route }) {
  const { student_id, student_name } = route.params || {};
  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!student_id) return;
    try {
      const [s, r] = await Promise.all([
        client.get(`/attendance/student/${student_id}/summary`).catch(() => ({ data: null })),
        client.get(`/attendance/student/${student_id}/recent`).catch(() => ({ data: null })),
      ]);
      setSummary(s.data);
      setRecent(r.data?.records ?? r.data?.sessions ?? (Array.isArray(r.data) ? r.data : []));
    } catch (err) {
      console.warn('[StudentDetail] fetch error:', err?.message);
    }
  }, [student_id]);

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

  const pct = summary?.overall_pct ?? summary?.attendance_pct ?? 0;
  const status = statusOf(pct);
  const subjects = summary?.subjects ?? summary?.subject_wise ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <View style={styles.headerCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>
              {(student_name ?? summary?.name ?? '?')[0]?.toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.name}>
              {student_name ?? summary?.name ?? `Student #${student_id}`}
            </Text>
            <Text style={styles.meta}>{summary?.roll_no ?? summary?.email ?? ''}</Text>
            <View style={[styles.statusChip, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusTxt, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>
          <View style={styles.pctCircle}>
            <Text style={[styles.pctVal, { color: status.color }]}>{Math.round(pct)}%</Text>
          </View>
        </View>

        <Text style={styles.section}>Subject-wise Attendance</Text>
        {subjects.length === 0 ? (
          <Text style={styles.empty}>No subject data.</Text>
        ) : (
          subjects.map((s, i) => {
            const sp = s.pct ?? s.attendance_pct ?? 0;
            const c = statusOf(sp);
            return (
              <View key={s.subject_id ?? i} style={styles.subCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subName}>{s.name ?? s.subject_name}</Text>
                  <Text style={styles.subMeta}>
                    {s.present ?? 0}/{s.total ?? 0} sessions
                  </Text>
                </View>
                <Text style={[styles.subPct, { color: c.color }]}>{Math.round(sp)}%</Text>
              </View>
            );
          })
        )}

        <Text style={styles.section}>Recent Sessions</Text>
        {recent.length === 0 ? (
          <Text style={styles.empty}>No recent attendance.</Text>
        ) : (
          recent.slice(0, 30).map((r, i) => (
            <View key={i} style={styles.recRow}>
              <Ionicons
                name={r.status === 'present' || r.present ? 'checkmark-circle' : 'close-circle'}
                size={18}
                color={r.status === 'present' || r.present ? '#22c55e' : '#ef4444'}
              />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.recName}>{r.subject_name ?? r.subject ?? '—'}</Text>
                <Text style={styles.recMeta}>
                  {r.date ?? r.session_date ?? r.created_at?.slice(0, 10)}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { fontSize: 20, fontWeight: '800', color: PRIMARY },
  name: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  statusChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
  },
  statusTxt: { fontSize: 10, fontWeight: '700' },
  pctCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctVal: { fontSize: 16, fontWeight: '900' },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 16, marginBottom: 10 },
  subCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  subName: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  subMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  subPct: { fontSize: 14, fontWeight: '800' },
  recRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  recName: { fontSize: 12, fontWeight: '600', color: '#1e293b' },
  recMeta: { fontSize: 10, color: '#94a3b8' },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 10,
  },
});
