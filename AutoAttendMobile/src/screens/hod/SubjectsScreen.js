/**
 * HOD — Subjects Management (H2)
 *  GET    /reports/hod/subjects
 *  PATCH  /hod/subjects/{id}/total-lectures?total_lectures={n}
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

export default function SubjectsScreen() {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [semester, setSemester]   = useState('all');
  const [editing, setEditing]     = useState(null);
  const [val, setVal]             = useState('');
  const [busy, setBusy]           = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/reports/hod/subjects');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) { console.warn('[Subjects] error:', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const semesters = useMemo(() => {
    const set = new Set(items.map(s => s.semester).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(() =>
    semester === 'all' ? items : items.filter(s => String(s.semester) === String(semester))
  , [items, semester]);

  const save = async () => {
    const n = parseInt(val, 10);
    if (!n || n < 1 || n > 200) return Alert.alert('Validation', 'Enter 1–200.');
    setBusy(true);
    try {
      await client.patch(`/hod/subjects/${editing.id}/total-lectures`, null, { params: { total_lectures: n } });
      setEditing(null); setVal(''); fetchData();
    } catch (err) { Alert.alert('Error', err?.response?.data?.detail ?? 'Failed.'); }
    finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.heading}>📚 Subjects ({items.length})</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipStrip}
        contentContainerStyle={{ paddingHorizontal: 16 }}>
        {semesters.map(s => (
          <TouchableOpacity key={String(s)} style={[styles.chip, semester === s && styles.chipActive]}
            onPress={() => setSemester(s)}>
            <Text style={[styles.chipTxt, semester === s && styles.chipTxtActive]}>
              {s === 'all' ? 'All' : `Sem ${s}`}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        {filtered.length === 0
          ? <Text style={styles.empty}>No subjects.</Text>
          : filtered.map(s => (
              <View key={s.id} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{s.name}</Text>
                  <Text style={styles.meta}>{s.code} · {s.course_name ?? `Course ${s.course_id}`} · Sem {s.semester}</Text>
                  <Text style={styles.totalLec}>Total Lectures: <Text style={{ fontWeight: '800', color: PRIMARY }}>{s.total_lectures ?? '—'}</Text></Text>
                </View>
                <TouchableOpacity style={styles.editBtn} onPress={() => { setEditing(s); setVal(String(s.total_lectures ?? '')); }}>
                  <Ionicons name="create-outline" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
      </ScrollView>

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Total Lectures</Text>
            <Text style={styles.meta}>{editing?.name}</Text>
            <Text style={styles.label}>Lectures (1–200)</Text>
            <TextInput style={styles.input} value={val} onChangeText={setVal} keyboardType="number-pad" autoFocus />
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
  heading: { fontSize: 20, fontWeight: '800', color: PRIMARY, padding: 16, paddingBottom: 8 },
  chipStrip: { maxHeight: 44 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', marginRight: 6 },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipTxt: { fontSize: 12, color: '#475569', fontWeight: '600' },
  chipTxtActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  totalLec: { fontSize: 12, color: '#475569', marginTop: 6 },
  editBtn: { backgroundColor: '#3b82f6', padding: 8, borderRadius: 8 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 30 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: PRIMARY, marginBottom: 6 },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0' },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700' },
});
