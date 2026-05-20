/**
 * Teacher — Attendance History (T6)
 *
 *  GET /api/faculty/my-sessions
 *  Lists all past attendance sessions with subject + date filters.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

function pct(p, total) { return total ? (p / total) * 100 : 0; }
const pctColor = p => (p >= 75 ? '#22c55e' : p >= 50 ? '#f59e0b' : '#ef4444');

export default function AttendanceHistoryScreen({ navigation }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subj, setSubj]       = useState('all');
  const [search, setSearch]   = useState('');

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/faculty/my-sessions');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) { console.warn('[History] error:', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const subjects = useMemo(() => {
    const set = new Map();
    items.forEach(s => { if (s.subject_name) set.set(s.subject_code ?? s.subject_name, s.subject_name); });
    return [['all', 'All']].concat(Array.from(set.entries()));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter(s => {
      if (subj !== 'all' && (s.subject_code ?? s.subject_name) !== subj) return false;
      if (search && !`${s.subject_name} ${s.date}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, subj, search]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <Text style={styles.heading}>📚 Attendance History</Text>
        <Text style={styles.sub}>{items.length} session{items.length === 1 ? '' : 's'} conducted</Text>

        <TextInput style={styles.search} value={search} onChangeText={setSearch}
          placeholder="Search subject or date…" placeholderTextColor="#94a3b8" />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          {subjects.map(([k, label]) => (
            <TouchableOpacity key={k} style={[styles.chip, subj === k && styles.chipActive]} onPress={() => setSubj(k)}>
              <Text style={[styles.chipTxt, subj === k && styles.chipTxtActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filtered.length === 0
          ? <Text style={styles.empty}>No sessions match.</Text>
          : filtered.map(s => {
              const p = pct(s.present_count ?? 0, s.total_students ?? 0);
              return (
                <View key={s.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>{s.subject_name}</Text>
                      <Text style={styles.meta}>{s.subject_code} · {s.date}{s.start_time ? ` · ${String(s.start_time).slice(0, 5)}` : ''}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: s.status === 'active' ? '#dcfce7' : '#f1f5f9' }]}>
                      <Text style={[styles.badgeTxt, s.status === 'active' && { color: '#15803d' }]}>{s.status ?? 'ended'}</Text>
                    </View>
                  </View>
                  <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                      <Text style={[styles.statV, { color: pctColor(p) }]}>{p.toFixed(0)}%</Text>
                      <Text style={styles.statL}>Rate</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statV}>{s.present_count ?? 0}</Text>
                      <Text style={styles.statL}>Present</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statV}>{s.total_students ?? 0}</Text>
                      <Text style={styles.statL}>Total</Text>
                    </View>
                  </View>
                </View>
              );
            })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 14 },
  search: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', marginRight: 6 },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipTxt: { fontSize: 12, color: '#475569', fontWeight: '600' },
  chipTxtActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
  statsRow: { flexDirection: 'row', gap: 8 },
  statBox: { flex: 1, backgroundColor: '#f8fafc', padding: 8, borderRadius: 8, alignItems: 'center' },
  statV: { fontSize: 16, fontWeight: '900', color: '#1e293b' },
  statL: { fontSize: 10, color: '#94a3b8', fontWeight: '700', marginTop: 2 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 30 },
});
