/**
 * HOD — Students Screen
 * Subject-level view of student attendance in the department.
 * API: GET /api/hod/dashboard → subjects[]
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

export default function StudentsScreen() {
  const [subjects, setSubjects]     = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]         = useState('');

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/hod/dashboard');
      setSubjects(data?.subjects ?? []);
      setStudentCount(data?.student_count ?? 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return subjects;
    return subjects.filter(s =>
      s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.teacher_name || '').toLowerCase().includes(q)
    );
  }, [subjects, search]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={filtered}
        keyExtractor={s => String(s.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>🎓 Students</Text>
            <Text style={styles.sub}>{studentCount} students across {subjects.length} subjects</Text>
            <TextInput style={styles.search} placeholder="Search subject, code, or teacher…"
              placeholderTextColor="#94a3b8" value={search} onChangeText={setSearch} />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No subjects found.</Text>
          </View>
        }
        renderItem={({ item: s }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.meta}>{s.code} · Sem {s.semester ?? '—'}</Text>
              <Text style={styles.meta}>{s.teacher_name || 'Unassigned'} · {s.sessions_done} sessions</Text>
            </View>
            <View style={styles.pctCol}>
              <Text style={[styles.pctVal, { color: pctColor(s.avg_pct) }]}>{s.avg_pct?.toFixed(0) ?? 0}%</Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.min(s.avg_pct ?? 0, 100)}%`, backgroundColor: pctColor(s.avg_pct) }]} />
              </View>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 12 },
  search: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 14, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  name: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  pctCol: { alignItems: 'flex-end', width: 60 },
  pctVal: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  bar: { height: 4, width: 50, borderRadius: 2, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
