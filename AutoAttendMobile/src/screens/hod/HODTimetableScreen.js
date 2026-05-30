/**
 * HOD — Department Timetable (H3)
 *  GET    /timetable/department  → { timetable: [{day, entries:[...]}] }
 *  POST   /timetable/entry       {subject_id, teacher_id, day_of_week, start_time, end_time, ...}
 *  PUT    /timetable/entry/{id}  {…partial…}
 *  DELETE /timetable/entry/{id}
 *  GET    /timetable/export-excel  → blob (download via secureDownload)
 *
 *  Mobile supports add / edit / delete of entries plus day-grid view & export.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { downloadAndShare } from '../../utils/secureDownload';

const PRIMARY = '#1a237e';
const DAYS    = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = { Mon: 'monday', Tue: 'tuesday', Wed: 'wednesday', Thu: 'thursday', Fri: 'friday', Sat: 'saturday' };
const COLORS  = ['#dbeafe', '#fee2e2', '#dcfce7', '#fef3c7', '#e0e7ff', '#fce7f3'];
const TIME_RE = /^\d{2}:\d{2}$/;

const EMPTY_FORM = {
  subject_id: '', teacher_id: '', section_id: '',
  day_of_week: 'monday', start_time: '', end_time: '', room: '', is_lab: false,
};

export default function HODTimetableScreen() {
  const [data, setData]           = useState({ timetable: [] });
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [day, setDay]             = useState('Mon');

  // Picker option lists (for the add/edit form)
  const [subjects, setSubjects]   = useState([]);
  const [teachers, setTeachers]   = useState([]);
  const [sections, setSections]   = useState([]);

  // Add/edit modal state
  const [editing, setEditing]     = useState(null);  // null | 'new' | entryRow
  const [form, setForm]           = useState(EMPTY_FORM);
  const [busy, setBusy]           = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data: d } = await client.get('/timetable/department');
      setData(d ?? { timetable: [] });
    } catch (err) { console.warn('[Timetable] error:', err?.message); }
  }, []);

  const fetchOptions = useCallback(async () => {
    try {
      const [subRes, dashRes, secRes] = await Promise.all([
        client.get('/reports/hod/subjects').catch(() => ({ data: [] })),
        client.get('/hod/dashboard').catch(() => ({ data: {} })),
        client.get('/sections').catch(() => ({ data: [] })),
      ]);
      setSubjects(Array.isArray(subRes.data) ? subRes.data : []);
      setTeachers(dashRes.data?.teachers ?? []);
      setSections(Array.isArray(secRes.data) ? secRes.data : []);
    } catch (err) { console.warn('[Timetable] options error:', err?.message); }
  }, []);

  useEffect(() => { Promise.all([fetchData(), fetchOptions()]).finally(() => setLoading(false)); }, [fetchData, fetchOptions]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await Promise.all([fetchData(), fetchOptions()]); setRefreshing(false); }, [fetchData, fetchOptions]);

  const byDay = useMemo(() => {
    const map = {};
    (data.timetable ?? []).forEach(d => { map[d.day] = d.entries ?? []; });
    return map;
  }, [data]);

  const entries = byDay[day] ?? [];

  const openNew = () => {
    setForm({ ...EMPTY_FORM, day_of_week: DAY_FULL[day] ?? 'monday' });
    setEditing('new');
  };

  const openEdit = e => {
    setForm({
      subject_id:  e.subject_id != null ? String(e.subject_id) : '',
      teacher_id:  e.teacher_id != null ? String(e.teacher_id) : '',
      section_id:  e.section_id != null ? String(e.section_id) : '',
      day_of_week: e.day_of_week ?? DAY_FULL[day] ?? 'monday',
      start_time:  (e.start_time ?? '').slice(0, 5),
      end_time:    (e.end_time ?? '').slice(0, 5),
      room:        e.room ?? '',
      is_lab:      !!e.is_lab,
    });
    setEditing(e);
  };

  const save = async () => {
    if (!form.subject_id) return Alert.alert('Validation', 'Select a subject.');
    if (!form.teacher_id) return Alert.alert('Validation', 'Select a teacher.');
    if (!TIME_RE.test(form.start_time) || !TIME_RE.test(form.end_time))
      return Alert.alert('Validation', 'Start/End time must be in HH:MM format.');
    if (form.start_time >= form.end_time)
      return Alert.alert('Validation', 'End time must be after start time.');

    const payload = {
      subject_id: parseInt(form.subject_id, 10),
      teacher_id: parseInt(form.teacher_id, 10),
      day_of_week: form.day_of_week,
      start_time: form.start_time,
      end_time: form.end_time,
      room: form.room.trim() || null,
      section_id: form.section_id ? parseInt(form.section_id, 10) : null,
      is_lab: form.is_lab,
    };

    setBusy(true);
    try {
      if (editing === 'new') await client.post('/timetable/entry', payload);
      else                    await client.put(`/timetable/entry/${editing.id}`, payload);
      setEditing(null);
      await fetchData();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not save entry.');
    } finally { setBusy(false); }
  };

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
        <TouchableOpacity style={styles.addBtn} onPress={openNew}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.addTxt}>Entry</Text>
        </TouchableOpacity>
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
              <TouchableOpacity key={e.id} activeOpacity={0.7} onPress={() => openEdit(e)}
                style={[styles.entry, { backgroundColor: COLORS[i % COLORS.length] }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.time}>{(e.start_time ?? '').slice(0, 5)} – {(e.end_time ?? '').slice(0, 5)}</Text>
                  <Text style={styles.subj}>{e.subject_name}{e.is_lab ? ' (Lab)' : ''}</Text>
                  <Text style={styles.subMeta}>{e.teacher_name ?? '—'} · {e.section_name ?? ''} · Room {e.room ?? '—'}</Text>
                </View>
                <TouchableOpacity onPress={() => openEdit(e)} style={{ paddingHorizontal: 6 }}>
                  <Ionicons name="create-outline" size={18} color="#3b82f6" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeEntry(e)}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
      </ScrollView>

      {/* Add / Edit entry modal */}
      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing === 'new' ? 'New Entry' : 'Edit Entry'}</Text>
            <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Subject</Text>
              <View style={styles.chipWrap}>
                {subjects.length === 0 ? <Text style={styles.hint}>No subjects available.</Text> :
                  subjects.map(s => {
                    const sel = String(s.id) === String(form.subject_id);
                    return (
                      <TouchableOpacity key={s.id} style={[styles.chip, sel && styles.chipSel]}
                        onPress={() => setForm(f => ({ ...f, subject_id: String(s.id) }))}>
                        <Text style={[styles.chipTxt, sel && styles.chipTxtSel]}>{s.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>

              <Text style={styles.label}>Teacher</Text>
              <View style={styles.chipWrap}>
                {teachers.length === 0 ? <Text style={styles.hint}>No teachers available.</Text> :
                  teachers.map(t => {
                    const sel = String(t.id) === String(form.teacher_id);
                    return (
                      <TouchableOpacity key={t.id} style={[styles.chip, sel && styles.chipSel]}
                        onPress={() => setForm(f => ({ ...f, teacher_id: String(t.id) }))}>
                        <Text style={[styles.chipTxt, sel && styles.chipTxtSel]}>{t.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>

              <Text style={styles.label}>Section (optional)</Text>
              <View style={styles.chipWrap}>
                <TouchableOpacity style={[styles.chip, !form.section_id && styles.chipSel]}
                  onPress={() => setForm(f => ({ ...f, section_id: '' }))}>
                  <Text style={[styles.chipTxt, !form.section_id && styles.chipTxtSel]}>None</Text>
                </TouchableOpacity>
                {sections.map(s => {
                  const sel = String(s.id) === String(form.section_id);
                  return (
                    <TouchableOpacity key={s.id} style={[styles.chip, sel && styles.chipSel]}
                      onPress={() => setForm(f => ({ ...f, section_id: String(s.id) }))}>
                      <Text style={[styles.chipTxt, sel && styles.chipTxtSel]}>{s.name} · Sem {s.semester}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>Day</Text>
              <View style={styles.chipWrap}>
                {DAYS.map(d => {
                  const full = DAY_FULL[d];
                  const sel = form.day_of_week === full;
                  return (
                    <TouchableOpacity key={d} style={[styles.chip, sel && styles.chipSel]}
                      onPress={() => setForm(f => ({ ...f, day_of_week: full }))}>
                      <Text style={[styles.chipTxt, sel && styles.chipTxtSel]}>{d}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Start (HH:MM)</Text>
                  <TextInput style={styles.input} value={form.start_time} placeholder="09:00" placeholderTextColor="#94a3b8"
                    onChangeText={t => setForm(f => ({ ...f, start_time: t }))} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>End (HH:MM)</Text>
                  <TextInput style={styles.input} value={form.end_time} placeholder="10:00" placeholderTextColor="#94a3b8"
                    onChangeText={t => setForm(f => ({ ...f, end_time: t }))} />
                </View>
              </View>

              <Text style={styles.label}>Room (optional)</Text>
              <TextInput style={styles.input} value={form.room} placeholder="e.g. A-204" placeholderTextColor="#94a3b8"
                onChangeText={t => setForm(f => ({ ...f, room: t }))} />

              <View style={styles.switchRow}>
                <Text style={styles.label}>Lab session</Text>
                <Switch value={form.is_lab} onValueChange={v => setForm(f => ({ ...f, is_lab: v }))}
                  trackColor={{ true: PRIMARY }} />
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#f1f5f9' }]} onPress={() => setEditing(null)}>
                <Text style={[styles.btnTxt, { color: '#475569' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: PRIMARY }]} onPress={save} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  heading: { flex: 1, fontSize: 20, fontWeight: '800', color: PRIMARY },
  addBtn: { flexDirection: 'row', backgroundColor: PRIMARY, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, gap: 4, alignItems: 'center', marginRight: 8 },
  addTxt: { color: '#fff', fontWeight: '700', fontSize: 11 },
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
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: PRIMARY, marginBottom: 10 },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  chipSel: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipTxt: { fontSize: 12, color: '#475569', fontWeight: '600' },
  chipTxtSel: { color: '#fff' },
  hint: { fontSize: 11, color: '#94a3b8', fontStyle: 'italic' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700' },
});
