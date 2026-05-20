/**
 * Principal — Departments Screen
 * Lists all departments with their attendance stats and HOD info.
 * API: GET /api/principal/stats → departments[]
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl,
  SafeAreaView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const pctColor = p => (p >= 75 ? '#22c55e' : p >= 65 ? '#f59e0b' : '#ef4444');

export default function DepartmentsScreen() {
  const [departments, setDepts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]         = useState('');

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/principal/stats');
      setDepts(data?.departments ?? []);
    } catch (err) { console.warn("[DepartmentsScreen] fetch error:", err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return departments;
    return departments.filter(d => (d.name || '').toLowerCase().includes(q) || (d.code || '').toLowerCase().includes(q));
  }, [departments, search]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={filtered}
        keyExtractor={d => String(d.id ?? d.name)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>🏛️ Departments ({departments.length})</Text>
            <TextInput style={styles.search} placeholder="Search department…"
              placeholderTextColor="#94a3b8" value={search} onChangeText={setSearch} />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="business-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No departments found.</Text>
          </View>
        }
        renderItem={({ item: d }) => {
          const avg = d.avg_attendance ?? d.attendance_pct ?? 0;
          return (
            <View style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="business" size={20} color={PRIMARY} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{d.name}</Text>
                <Text style={styles.meta}>
                  {d.teacher_count ?? 0} teachers · {d.student_count ?? 0} students
                </Text>
                {d.hod_name && <Text style={styles.meta}>HOD: {d.hod_name}</Text>}
              </View>
              <View style={styles.pctCol}>
                <Text style={[styles.pctVal, { color: pctColor(avg) }]}>{avg.toFixed(0)}%</Text>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.min(avg, 100)}%`, backgroundColor: pctColor(avg) }]} />
                </View>
                {avg < 65 && <Ionicons name="warning" size={14} color="#ef4444" style={{ marginTop: 4 }} />}
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
  heading: { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 12 },
  search: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 14, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  pctCol: { alignItems: 'flex-end', width: 60 },
  pctVal: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  bar: { height: 4, width: 50, borderRadius: 2, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
});
