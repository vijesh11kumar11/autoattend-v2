/**
 * HOD — Tutor Management (H4)
 *  GET    /tutor/assignments?academic_year
 *  DELETE /tutor/remove/{aid}
 *  POST   /tutor/assign-by-roll-range  {tutor_id, roll_start, roll_end, academic_year}
 *  POST   /tutor/assign-by-section     {tutor_id, section_id, academic_year}
 *  POST   /tutor/export-assignments-excel  → blob
 *  GET    /tutor/unassigned-students
 *
 *  Excel import is best done from the web portal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { downloadAndShare } from '../../utils/secureDownload';

const PRIMARY = '#1a237e';
const TABS = ['Assignments', 'Unassigned', 'Bulk Assign'];

export default function TutorManagementScreen() {
  const [tab, setTab]             = useState('Assignments');
  const [year, setYear]           = useState(String(new Date().getFullYear()));
  const [items, setItems]         = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]       = useState('');
  const [showBulk, setShowBulk]   = useState(false);
  const [mode, setMode]           = useState('range');   // range | section
  const [form, setForm]           = useState({ tutor_id: '', roll_start: '', roll_end: '', section_id: '' });
  const [busy, setBusy]           = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [a, u] = await Promise.allSettled([
        client.get('/tutor/assignments', { params: { academic_year: year } }),
        client.get('/tutor/unassigned-students'),
      ]);
      if (a.status === 'fulfilled') setItems(Array.isArray(a.value.data) ? a.value.data : []);
      if (u.status === 'fulfilled') setUnassigned(Array.isArray(u.value.data) ? u.value.data : []);
    } catch (err) { console.warn('[Tutor] error:', err?.message); }
  }, [year]);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(a => `${a.tutor_name} ${a.student_name} ${a.student_roll}`.toLowerCase().includes(q));
  }, [items, search]);

  const remove = a => Alert.alert('Remove Assignment', `Remove ${a.student_name} from ${a.tutor_name}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => {
      try { await client.delete(`/tutor/remove/${a.id}`); fetchData(); }
      catch (err) { Alert.alert('Error', err?.response?.data?.detail ?? 'Failed.'); }
    }},
  ]);

  const exportExcel = () => downloadAndShare({
    path: `/api/tutor/export-assignments-excel?academic_year=${encodeURIComponent(year)}`,
    fileName: `tutor_assignments_${year}.xlsx`,
    fallbackExt: 'xlsx',
    title: 'Tutor Assignments',
  });

  const submitBulk = async () => {
    if (!form.tutor_id) return Alert.alert('Validation', 'Tutor ID required.');
    setBusy(true);
    try {
      if (mode === 'range') {
        if (!form.roll_start.trim() || !form.roll_end.trim()) throw new Error('Roll range required.');
        await client.post('/tutor/assign-by-roll-range', {
          tutor_id: parseInt(form.tutor_id, 10),
          roll_start: form.roll_start.trim(),
          roll_end: form.roll_end.trim(),
          academic_year: year,
        });
      } else {
        if (!form.section_id) throw new Error('Section ID required.');
        await client.post('/tutor/assign-by-section', {
          tutor_id: parseInt(form.tutor_id, 10),
          section_id: parseInt(form.section_id, 10),
          academic_year: year,
        });
      }
      Alert.alert('Done', 'Bulk assignment created.');
      setShowBulk(false); setForm({ tutor_id: '', roll_start: '', roll_end: '', section_id: '' });
      fetchData();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? err?.message ?? 'Failed.');
    } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.heading}>👨‍🏫 Tutor Management</Text>
        <TouchableOpacity style={styles.exportBtn} onPress={exportExcel}>
          <Ionicons name="download-outline" size={14} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.yearRow}>
        <Text style={styles.yearLbl}>Year:</Text>
        <TextInput style={styles.yearInput} value={year} onChangeText={setYear} keyboardType="number-pad" />
        <TouchableOpacity style={styles.refresh} onPress={fetchData}>
          <Ionicons name="refresh" size={14} color={PRIMARY} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabStrip}>
        {TABS.map(t => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        {tab === 'Assignments' && (
          <>
            <TextInput style={styles.search} value={search} onChangeText={setSearch}
              placeholder="Search tutor / student / roll" placeholderTextColor="#94a3b8" />
            <Text style={styles.count}>{filtered.length} assignments</Text>
            {filtered.length === 0 ? <Text style={styles.empty}>No assignments.</Text> :
              filtered.map(a => (
                <View key={a.id} style={styles.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{a.student_name} <Text style={styles.meta}>({a.student_roll})</Text></Text>
                    <Text style={styles.meta}>Tutor: {a.tutor_name}</Text>
                    <Text style={styles.meta}>{a.section_name ?? '—'} · AY {a.academic_year}</Text>
                  </View>
                  <TouchableOpacity onPress={() => remove(a)}>
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))}
          </>
        )}

        {tab === 'Unassigned' && (
          <>
            <Text style={styles.count}>{unassigned.length} students unassigned</Text>
            {unassigned.length === 0 ? <Text style={styles.empty}>All assigned.</Text> :
              unassigned.map(s => (
                <View key={s.id} style={styles.card}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{s.name}</Text>
                    <Text style={styles.meta}>{s.roll_number} · {s.section_name ?? '—'}</Text>
                  </View>
                </View>
              ))}
          </>
        )}

        {tab === 'Bulk Assign' && (
          <View style={styles.bulkCard}>
            <Text style={styles.label}>Mode</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {['range', 'section'].map(m => (
                <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && styles.modeBtnOn]} onPress={() => setMode(m)}>
                  <Text style={[styles.modeTxt, mode === m && styles.modeTxtOn]}>{m === 'range' ? 'Roll Range' : 'Section'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Tutor ID</Text>
            <TextInput style={styles.input} value={form.tutor_id} onChangeText={t => setForm({ ...form, tutor_id: t })} keyboardType="number-pad" placeholder="Tutor user ID" placeholderTextColor="#94a3b8" />
            {mode === 'range' ? (
              <>
                <Text style={styles.label}>Roll Start</Text>
                <TextInput style={styles.input} value={form.roll_start} onChangeText={t => setForm({ ...form, roll_start: t })} placeholder="e.g. 21CSE001" placeholderTextColor="#94a3b8" />
                <Text style={styles.label}>Roll End</Text>
                <TextInput style={styles.input} value={form.roll_end} onChangeText={t => setForm({ ...form, roll_end: t })} placeholder="e.g. 21CSE060" placeholderTextColor="#94a3b8" />
              </>
            ) : (
              <>
                <Text style={styles.label}>Section ID</Text>
                <TextInput style={styles.input} value={form.section_id} onChangeText={t => setForm({ ...form, section_id: t })} keyboardType="number-pad" />
              </>
            )}
            <TouchableOpacity style={[styles.bigBtn, busy && { opacity: 0.5 }]} onPress={submitBulk} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> :
                <><Ionicons name="people-outline" size={16} color="#fff" /><Text style={styles.bigBtnTxt}>Assign Bulk</Text></>}
            </TouchableOpacity>
            <Text style={styles.note}>💡 For Excel import use the web portal.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 6 },
  heading: { flex: 1, fontSize: 20, fontWeight: '800', color: PRIMARY },
  exportBtn: { backgroundColor: '#22c55e', padding: 8, borderRadius: 8 },
  yearRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  yearLbl: { fontSize: 12, color: '#64748b', fontWeight: '700' },
  yearInput: { backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', minWidth: 80 },
  refresh: { padding: 6 },
  tabStrip: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: PRIMARY },
  tabTxt: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  tabTxtActive: { color: PRIMARY },
  search: { backgroundColor: '#fff', borderRadius: 10, padding: 10, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8 },
  count: { fontSize: 11, color: '#94a3b8', fontWeight: '600', marginBottom: 6 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 30 },
  bulkCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0' },
  modeBtn: { flex: 1, padding: 8, borderRadius: 8, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' },
  modeBtnOn: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  modeTxt: { fontSize: 12, color: '#475569', fontWeight: '700' },
  modeTxtOn: { color: '#fff' },
  bigBtn: { flexDirection: 'row', backgroundColor: PRIMARY, padding: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
  bigBtnTxt: { color: '#fff', fontWeight: '700' },
  note: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
});
