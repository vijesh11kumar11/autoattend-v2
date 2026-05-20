/**
 * HOD — Disputes Resolution (H8)
 *  GET  /hod/disputes/pending
 *  POST /hod/disputes/{id}/escalate?action=approve|reject&resolution_note=...
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

export default function HODDisputesScreen() {
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive]       = useState(null);
  const [note, setNote]           = useState('');
  const [busy, setBusy]           = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/hod/disputes/pending');
      setItems(Array.isArray(data) ? data : []);
    } catch (err) { console.warn('[Disputes]', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const escalate = async action => {
    if (!note.trim()) return Alert.alert('Validation', 'Resolution note required.');
    setBusy(true);
    try {
      await client.post(`/hod/disputes/${active.id}/escalate`, null, {
        params: { action, resolution_note: note.trim() },
      });
      Alert.alert('Done', `Dispute ${action}d.`);
      setActive(null); setNote('');
      fetchData();
    } catch (err) { Alert.alert('Error', err?.response?.data?.detail ?? 'Failed.'); }
    finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.heading}>⚖️ Pending Disputes ({items.length})</Text>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        {items.length === 0 ? <Text style={styles.empty}>No pending disputes.</Text> :
          items.map(d => (
            <TouchableOpacity key={d.id} style={styles.card} onPress={() => setActive(d)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{d.student_name} <Text style={styles.meta}>({d.roll_number})</Text></Text>
                <Text style={styles.meta}>{d.subject_name} · {d.session_date}</Text>
                <Text style={styles.meta}>Teacher: {d.teacher_name}</Text>
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonTxt} numberOfLines={3}>{d.reason}</Text>
                </View>
                {d.resolved_by && <Text style={styles.meta}>Resolved by: {d.resolved_by} — {d.resolution_note}</Text>}
              </View>
              <View style={[styles.pill, { backgroundColor: d.status === 'pending' ? '#fde68a' : '#dcfce7' }]}>
                <Text style={styles.pillTxt}>{d.status}</Text>
              </View>
            </TouchableOpacity>
          ))}
      </ScrollView>

      <Modal visible={!!active} animationType="slide" transparent onRequestClose={() => setActive(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Resolve Dispute</Text>
            <Text style={styles.title}>{active?.student_name}</Text>
            <Text style={styles.meta}>{active?.subject_name} · {active?.session_date}</Text>
            <View style={styles.reasonBox}><Text style={styles.reasonTxt}>{active?.reason}</Text></View>

            <Text style={styles.label}>Resolution Note</Text>
            <TextInput style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
              value={note} onChangeText={setNote} multiline placeholder="Required" placeholderTextColor="#94a3b8" />

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#ef4444' }]} onPress={() => escalate('reject')} disabled={busy}>
                <Text style={styles.btnTxt}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#22c55e' }]} onPress={() => escalate('approve')} disabled={busy}>
                <Text style={styles.btnTxt}>Approve</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => { setActive(null); setNote(''); }} style={{ marginTop: 8, alignItems: 'center' }}>
              <Text style={{ color: '#64748b', fontWeight: '600' }}>Cancel</Text>
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
  heading: { fontSize: 20, fontWeight: '800', color: PRIMARY, padding: 16, paddingBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row' },
  title: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  reasonBox: { backgroundColor: '#fef3c7', padding: 8, borderRadius: 6, marginTop: 6 },
  reasonTxt: { fontSize: 12, color: '#92400e', fontStyle: 'italic' },
  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start' },
  pillTxt: { fontSize: 10, fontWeight: '700', color: '#1e293b' },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 30 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: PRIMARY, marginBottom: 10 },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 12, marginBottom: 4 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 13, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0' },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700' },
});
