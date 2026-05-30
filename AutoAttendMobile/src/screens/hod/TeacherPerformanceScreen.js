/**
 * HOD — Teacher Performance (H7)
 *  GET /hod/teacher-performance
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const pctColor = (p) => (p >= 75 ? '#22c55e' : p >= 65 ? '#f59e0b' : '#ef4444');

const SORTS = [
  { key: 'name', label: 'Name' },
  { key: 'subjects', label: 'Subjects' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'disputes', label: 'Disputes' },
];

export default function TeacherPerformanceScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('attendance');

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/hod/teacher-performance');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[TeacherPerf]', err?.message);
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

  const view = useMemo(() => {
    let r = items;
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((t) => `${t.name} ${t.email ?? ''}`.toLowerCase().includes(q));
    }
    return [...r].sort((a, b) => {
      switch (sort) {
        case 'name':
          return (a.name ?? '').localeCompare(b.name ?? '');
        case 'subjects':
          return (b.subjects_count ?? 0) - (a.subjects_count ?? 0);
        case 'sessions':
          return (b.sessions_conducted_this_month ?? 0) - (a.sessions_conducted_this_month ?? 0);
        case 'disputes':
          return (b.pending_disputes ?? 0) - (a.pending_disputes ?? 0);
        default:
          return (b.avg_attendance_pct ?? 0) - (a.avg_attendance_pct ?? 0);
      }
    });
  }, [items, search, sort]);

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.heading}>📈 Teacher Performance</Text>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search teacher"
        placeholderTextColor="#94a3b8"
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sortStrip}
        contentContainerStyle={{ paddingHorizontal: 12 }}
      >
        {SORTS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.chip, sort === s.key && styles.chipActive]}
            onPress={() => setSort(s.key)}
          >
            <Text style={[styles.chipTxt, sort === s.key && styles.chipTxtActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        {view.length === 0 ? (
          <Text style={styles.empty}>No teachers.</Text>
        ) : (
          view.map((t) => (
            <View key={t.teacher_id ?? t.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t.name}</Text>
                <Text style={styles.meta}>{t.email}</Text>
                <View style={styles.metricsRow}>
                  <Metric label="Subjects" value={t.subjects_count ?? 0} />
                  <Metric label="Sessions" value={t.sessions_conducted_this_month ?? 0} />
                  <Metric
                    label="Disputes"
                    value={t.pending_disputes ?? 0}
                    color={(t.pending_disputes ?? 0) > 0 ? '#ef4444' : null}
                  />
                </View>
              </View>
              <View
                style={[styles.pctBox, { backgroundColor: pctColor(t.avg_attendance_pct ?? 0) }]}
              >
                <Text style={styles.pctTxt}>{(t.avg_attendance_pct ?? 0).toFixed(0)}%</Text>
                <Text style={styles.pctLbl}>Attendance</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, color }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricVal, color && { color }]}>{value}</Text>
      <Text style={styles.metricLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '800', color: PRIMARY, padding: 16, paddingBottom: 8 },
  search: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sortStrip: { maxHeight: 44 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginRight: 6,
  },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipTxt: { fontSize: 12, color: '#475569', fontWeight: '600' },
  chipTxtActive: { color: '#fff' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  metricsRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  metric: { alignItems: 'center', minWidth: 50 },
  metricVal: { fontSize: 14, fontWeight: '800', color: PRIMARY },
  metricLbl: { fontSize: 9, color: '#94a3b8', fontWeight: '700' },
  pctBox: { padding: 10, borderRadius: 10, alignItems: 'center', minWidth: 70 },
  pctTxt: { fontSize: 16, fontWeight: '800', color: '#fff' },
  pctLbl: { fontSize: 9, color: '#fff', fontWeight: '700', opacity: 0.9 },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 30,
  },
});
