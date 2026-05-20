/**
 * Teacher — Disputes Screen
 * GET  /api/teacher/disputes/pending
 * POST /api/teacher/disputes/{dispute_id}/resolve { action: 'accept' | 'reject' }
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  SafeAreaView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

export default function TeacherDisputesScreen() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/teacher/disputes/pending');
      setDisputes(Array.isArray(data) ? data : (data?.disputes ?? []));
    } catch (err) { console.warn('[TeacherDisputes] fetch error:', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const resolve = (d, action) => {
    Alert.alert(
      action === 'accept' ? 'Accept Dispute' : 'Reject Dispute',
      `${action === 'accept' ? 'Mark this student PRESENT' : 'Keep this student ABSENT'} for "${d.subject_name ?? 'the session'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', style: action === 'reject' ? 'destructive' : 'default', onPress: async () => {
          setBusyId(d.id);
          try {
            await client.post(`/teacher/disputes/${d.id}/resolve`, { action });
            setDisputes(prev => prev.filter(x => x.id !== d.id));
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to resolve dispute.');
          } finally { setBusyId(null); }
        }},
      ],
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={disputes}
        keyExtractor={d => String(d.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>🛡️ Pending Disputes ({disputes.length})</Text>
            <Text style={styles.sub}>Students contesting attendance records.</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No pending disputes.</Text>
          </View>
        }
        renderItem={({ item: d }) => (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{d.student_name ?? `Student #${d.student_id}`}</Text>
                <Text style={styles.meta}>{d.subject_name ?? '—'} · {d.session_date ?? d.created_at?.slice(0, 10)}</Text>
              </View>
              <View style={styles.statusChip}><Text style={styles.statusChipTxt}>Pending</Text></View>
            </View>
            {d.reason ? <Text style={styles.reason}>“{d.reason}”</Text> : null}
            {d.evidence_url ? <Text style={styles.evid}>📎 Evidence attached</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnReject]}
                onPress={() => resolve(d, 'reject')}
                disabled={busyId === d.id}>
                {busyId === d.id
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><Ionicons name="close-outline" size={16} color="#fff" /><Text style={styles.btnTxt}> Reject</Text></>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnAccept]}
                onPress={() => resolve(d, 'accept')}
                disabled={busyId === d.id}>
                {busyId === d.id
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><Ionicons name="checkmark-outline" size={16} color="#fff" /><Text style={styles.btnTxt}> Accept</Text></>}
              </TouchableOpacity>
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
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  statusChip: { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusChipTxt: { fontSize: 10, fontWeight: '700', color: '#b45309' },
  reason: { fontSize: 12, color: '#475569', marginTop: 8, fontStyle: 'italic' },
  evid: { fontSize: 11, color: '#3b82f6', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 10 },
  btnAccept: { backgroundColor: '#22c55e' },
  btnReject: { backgroundColor: '#ef4444' },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
});
