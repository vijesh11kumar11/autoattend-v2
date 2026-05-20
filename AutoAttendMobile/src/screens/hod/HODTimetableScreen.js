/**
 * HOD — Department Timetable (H3)
 *  GET    /timetable/department  → { timetable: [{day, entries:[...]}] }
 *  DELETE /timetable/entry/{id}
 *  GET    /timetable/export-excel  → blob (download via secureDownload)
 *
 *  NOTE: Excel bulk upload is best done from the web (file picker UX);
 *  mobile shows day-grid + entry detail + delete + export.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { downloadAndShare } from '../../utils/secureDownload';

const PRIMARY = '#1a237e';
const DAYS    = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COLORS  = ['#dbeafe', '#fee2e2', '#dcfce7', '#fef3c7', '#e0e7ff', '#fce7f3'];

export default function HODTimetableScreen() {
  const [data, setData]           = useState({ timetable: [] });
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [day, setDay]             = useState('Mon');

  const fetchData = useCallback(async () => {
    try {
      const { data: d } = await client.get('/timetable/department');
      setData(d ?? { timetable: [] });
    } catch (err) { console.warn('[Timetable] error:', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const byDay = useMemo(() => {
    const map = {};
    (data.timetable ?? []).forEach(d => { map[d.day] = d.entries ?? []; });
    return map;
  }, [data]);

  const entries = byDay[day] ?? [];

  const removeEntry = e => Alert.alert('Delete Entry', `Delete ${e.subject_name} ${e.start_time}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await client.delete(`/timetable/entry/${e.id}`); fetchData(); }
      catch (err) { Alert.alert('Error', err?.response?.data?.detail ?? 'Failed.'); }
    }},
  ]);

  const exportExcel = () => downloadAndShare({
    path: '/api/timetable/export-excel',
    fileName: `timetable_${new Date().toISOString().slice(0, 10)}.xlsx`,
    fallbackExt: 'xlsx',
    title: 'Department Timetable',
  });

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.heading}>📅 Timetable</Text>
        <TouchableOpacity style={styles.exportBtn} onPress={exportExcel}>
          <Ionicons name="download-outline" size={14} color="#fff" />
          <Text style={styles.exportTxt}>Excel</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayStrip}
        contentContainerStyle={{ paddingHorizontal: 12 }}>
        {DAYS.map(d => (
          <TouchableOpacity key={d} style={[styles.dayChip, day === d && styles.dayChipActive]} onPress={() => setDay(d)}>
            <Text style={[styles.dayTxt, day === d && styles.dayTxtActive]}>{d}</Text>
            {byDay[d]?.length > 0 && <View style={styles.cnt}><Text style={styles.cntTxt}>{byDay[d].length}</Text></View>}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        {entries.length === 0
          ? <Text style={styles.empty}>No entries for {day}.</Text>
          : entries.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')).map((e, i) => (
              <View key={e.id} style={[styles.entry, { backgroundColor: COLORS[i % COLORS.length] }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.time}>{(e.start_time ?? '').slice(0, 5)} – {(e.end_time ?? '').slice(0, 5)}</Text>
                  <Text style={styles.subj}>{e.subject_name}{e.is_lab ? ' (Lab)' : ''}</Text>
                  <Text style={styles.subMeta}>{e.teacher_name ?? '—'} · {e.section_name ?? ''} · Room {e.room ?? '—'}</Text>
                </View>
                <TouchableOpacity onPress={() => removeEntry(e)}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
        <Text style={styles.note}>💡 Use the web portal for bulk Excel upload of timetable entries.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  heading: { flex: 1, fontSize: 20, fontWeight: '800', color: PRIMARY },
  exportBtn: { flexDirection: 'row', backgroundColor: '#22c55e', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, gap: 4, alignItems: 'center' },
  exportTxt: { color: '#fff', fontWeight: '700', fontSize: 11 },
  dayStrip: { maxHeight: 50 },
  dayChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, marginRight: 6, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  dayChipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  dayTxt: { fontSize: 13, fontWeight: '700', color: '#475569' },
  dayTxtActive: { color: '#fff' },
  cnt: { marginLeft: 6, backgroundColor: '#ef4444', borderRadius: 8, paddingHorizontal: 6, minWidth: 18, alignItems: 'center' },
  cntTxt: { fontSize: 10, color: '#fff', fontWeight: '800' },
  entry: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 8 },
  time: { fontSize: 12, fontWeight: '800', color: PRIMARY },
  subj: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 2 },
  subMeta: { fontSize: 11, color: '#475569', marginTop: 2 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 30 },
  note: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 14, fontStyle: 'italic' },
});
