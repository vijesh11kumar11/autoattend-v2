/**
 * HOD — Sections Management (H1)
 *  GET    /sections?course_id&semester
 *  POST   /sections      {course_id, semester, name, max_strength}
 *  PUT    /sections/{id} {name, max_strength}
 *  DELETE /sections/{id}
 *  GET    /sections/{id}/students
 *  POST   /sections/remove-student {student_id}
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

export default function SectionsScreen() {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterSem, setFilterSem] = useState('');
  const [editing, setEditing]     = useState(null);   // null | row | 'new'
  const [form, setForm]           = useState({ course_id: '', semester: '', name: '', max_strength: '60' });
  const [busy, setBusy]           = useState(false);
  const [members, setMembers]     = useState(null);   // { section, students }

  const fetchData = useCallback(async () => {
    try {
      const params = filterSem ? { semester: filterSem } : {};
      const { data } = await client.get('/sections', { params });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) { console.warn('[Sections] error:', err?.message); }
  }, [filterSem]);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const openNew = () => { setForm({ course_id: '', semester: '', name: '', max_strength: '60' }); setEditing('new'); };
  const openEdit = row => { setForm({ course_id: String(row.course_id), semester: String(row.semester), name: row.name, max_strength: String(row.max_strength ?? 60) }); setEditing(row); };

  const save = async () => {
    if (!form.name.trim()) return Alert.alert('Validation', 'Name required.');
    setBusy(true);
    try {
      if (editing === 'new') {
        await client.post('/sections', {
          course_id: parseInt(form.course_id, 10),
          semester: parseInt(form.semester, 10),
          name: form.name.trim(),
          max_strength: parseInt(form.max_strength, 10) || 60,
        });
      } else {
        await client.put(`/sections/${editing.id}`, {
          name: form.name.trim(),
          max_strength: parseInt(form.max_strength, 10) || 60,
        });
      }
      setEditing(null); fetchData();
    } catch (err) { Alert.alert('Error', err?.response?.data?.detail ?? 'Save failed.'); }
    finally { setBusy(false); }
  };

  const remove = row => Alert.alert('Delete Section', `Delete "${row.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try { await client.delete(`/sections/${row.id}`); fetchData(); }
      catch (err) { Alert.alert('Error', err?.response?.data?.detail ?? 'Delete failed.'); }
    }},
  ]);

  const viewStudents = async row => {
    try {
      const { data } = await client.get(`/sections/${row.id}/students`);
      setMembers({ section: row, students: Array.isArray(data) ? data : [] });
    } catch (err) { Alert.alert('Error', 'Could not load students.'); }
  };

  const removeStudent = async (sid, name) => {
    Alert.alert('Remove Student', `Remove ${name} from section?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await client.post('/sections/remove-student', { student_id: sid });
          const { data } = await client.get(`/sections/${members.section.id}/students`);
          setMembers({ ...members, students: Array.isArray(data) ? data : [] });
        } catch (err) { Alert.alert('Error', 'Failed.'); }
      }},
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.heading}>👥 Sections ({items.length})</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openNew}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addTxt}>New</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        <TextInput style={styles.semInput} value={filterSem} onChangeText={setFilterSem}
          placeholder="Filter by semester (optional)" placeholderTextColor="#94a3b8" keyboardType="number-pad" />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        {items.length === 0
          ? <Text style={styles.empty}>No sections.</Text>
          : items.map(s => (
              <View key={s.id} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{s.name} · Sem {s.semester}</Text>
                  <Text style={styles.meta}>{s.course_name ?? `Course ${s.course_id}`} · Cap {s.max_strength}</Text>
                </View>
                <TouchableOpacity onPress={() => viewStudents(s)}><Ionicons name="people-outline" size={20} color={PRIMARY} /></TouchableOpacity>
                <TouchableOpacity onPress={() => openEdit(s)} style={{ marginLeft: 12 }}><Ionicons name="create-outline" size={20} color="#3b82f6" /></TouchableOpacity>
                <TouchableOpacity onPress={() => remove(s)} style={{ marginLeft: 12 }}><Ionicons name="trash-outline" size={20} color="#ef4444" /></TouchableOpacity>
              </View>
            ))}
      </ScrollView>

      {/* Edit/New modal */}
      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editing === 'new' ? 'New Section' : 'Edit Section'}</Text>
            {editing === 'new' && (
              <>
                <Text style={styles.label}>Course ID</Text>
                <TextInput style={styles.input} value={form.course_id} onChangeText={t => setForm({ ...form, course_id: t })} keyboardType="number-pad" />
                <Text style={styles.label}>Semester</Text>
                <TextInput style={styles.input} value={form.semester} onChangeText={t => setForm({ ...form, semester: t })} keyboardType="number-pad" />
              </>
            )}
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={t => setForm({ ...form, name: t })} placeholder="A / B / C" placeholderTextColor="#94a3b8" />
            <Text style={styles.label}>Max Strength</Text>
            <TextInput style={styles.input} value={form.max_strength} onChangeText={t => setForm({ ...form, max_strength: t })} keyboardType="number-pad" />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#f1f5f9' }]} onPress={() => setEditing(null)}><Text style={[styles.btnTxt, { color: '#475569' }]}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: PRIMARY }]} onPress={save} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Save</Text>}</TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Students modal */}
      <Modal visible={!!members} animationType="slide" transparent onRequestClose={() => setMembers(null)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>{members?.section?.name} — Students</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {(members?.students ?? []).length === 0 ? <Text style={styles.empty}>No students assigned.</Text> :
                members.students.map(st => (
                  <View key={st.id} style={styles.stuRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stuName}>{st.name}</Text>
                      <Text style={styles.meta}>{st.roll_number}</Text>
                    </View>
                    <TouchableOpacity onPress={() => removeStudent(st.id, st.name)}>
                      <Ionicons name="remove-circle-outline" size={20} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                ))}
            </ScrollView>
            <TouchableOpacity style={[styles.btn, { backgroundColor: PRIMARY, marginTop: 12 }]} onPress={() => setMembers(null)}>
              <Text style={styles.btnTxt}>Close</Text>
            </TouchableOpacity>
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
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 6 },
  heading: { flex: 1, fontSize: 20, fontWeight: '800', color: PRIMARY },
  addBtn: { flexDirection: 'row', backgroundColor: PRIMARY, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignItems: 'center', gap: 4 },
  addTxt: { color: '#fff', fontWeight: '700' },
  filterRow: { paddingHorizontal: 16, paddingBottom: 8 },
  semInput: { backgroundColor: '#fff', borderRadius: 10, padding: 10, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 30 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: PRIMARY, marginBottom: 10 },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0' },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700' },
  stuRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 10, borderRadius: 8, marginBottom: 6 },
  stuName: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
});
