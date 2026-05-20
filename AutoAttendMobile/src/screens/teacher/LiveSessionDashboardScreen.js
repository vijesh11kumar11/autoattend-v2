/**
 * Teacher — Live Session Dashboard
 * GET  /api/live/sessions/{session_id}/details (poll every 10s)
 * POST /api/live/sessions/{session_id}/end
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const POLL_MS = 10_000;

export default function LiveSessionDashboardScreen({ route, navigation }) {
  const { session_id } = route.params || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ending, setEnding] = useState(false);
  const timerRef = useRef(null);

  const fetchData = useCallback(async () => {
    if (!session_id) return;
    try {
      const { data: d } = await client.get(`/live/sessions/${session_id}/details`);
      setData(d);
    } catch (err) { console.warn('[LiveDashboard] fetch error:', err?.message); }
  }, [session_id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    timerRef.current = setInterval(fetchData, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const endSession = () => {
    Alert.alert(
      'End Live Session',
      'Are you sure you want to end this live session? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Session', style: 'destructive', onPress: async () => {
          setEnding(true);
          clearInterval(timerRef.current);
          try {
            await client.post(`/live/sessions/${session_id}/end`);
            Alert.alert('Ended', 'Live session ended successfully.', [
              { text: 'OK', onPress: () => navigation.goBack() },
            ]);
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to end session.');
          } finally { setEnding(false); }
        }},
      ],
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  if (!data)   return <View style={styles.center}><Text style={styles.err}>Could not load session.</Text></View>;

  const isLive = data.status === 'active' || data.is_active;
  const participants = data.participants ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <View style={[styles.statusCard, { backgroundColor: isLive ? '#dcfce7' : '#fee2e2' }]}>
          <Ionicons name={isLive ? 'radio-outline' : 'stop-circle-outline'} size={28} color={isLive ? '#15803d' : '#b91c1c'} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.statusTxt, { color: isLive ? '#15803d' : '#b91c1c' }]}>
              {isLive ? '🔴 LIVE' : 'Ended'}
            </Text>
            <Text style={styles.statusSub}>{data.subject_name ?? '—'}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}><Ionicons name="people-outline" size={20} color={PRIMARY}/><Text style={styles.statV}>{participants.length}</Text><Text style={styles.statL}>Joined</Text></View>
          <View style={styles.stat}><Ionicons name="hand-right-outline" size={20} color={PRIMARY}/><Text style={styles.statV}>{data.doubt_count ?? 0}</Text><Text style={styles.statL}>Doubts</Text></View>
          <View style={styles.stat}><Ionicons name="pulse-outline" size={20} color={PRIMARY}/><Text style={styles.statV}>{data.pulse_count ?? data.pulse_checks?.length ?? 0}</Text><Text style={styles.statL}>Pulses</Text></View>
        </View>

        <Text style={styles.section}>Participants ({participants.length})</Text>
        {participants.length === 0
          ? <Text style={styles.empty}>No participants yet.</Text>
          : participants.slice(0, 50).map((p, i) => (
              <View key={p.id ?? i} style={styles.pRow}>
                <Ionicons name="person-circle-outline" size={22} color="#94a3b8" />
                <Text style={styles.pName}>{p.name ?? p.student_name ?? `User ${p.id}`}</Text>
                <View style={[styles.pStatus, { backgroundColor: p.is_active ? '#dcfce7' : '#f1f5f9' }]}>
                  <Text style={{ fontSize: 10, color: p.is_active ? '#15803d' : '#64748b', fontWeight: '700' }}>
                    {p.is_active ? 'Active' : 'Idle'}
                  </Text>
                </View>
              </View>
            ))}

        {isLive && (
          <TouchableOpacity style={styles.endBtn} onPress={endSession} disabled={ending}>
            {ending
              ? <ActivityIndicator size="small" color="#fff" />
              : <><Ionicons name="stop-circle-outline" size={18} color="#fff" /><Text style={styles.endTxt}>End Session</Text></>}
          </TouchableOpacity>
        )}

        <Text style={styles.hint}>Auto-refreshes every 10 seconds.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { fontSize: 14, color: '#ef4444' },
  statusCard: { borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  statusTxt: { fontSize: 18, fontWeight: '800' },
  statusSub: { fontSize: 12, color: '#475569', marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  statV: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  statL: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  pRow: { backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  pName: { flex: 1, fontSize: 13, color: '#1e293b', fontWeight: '600' },
  pStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  endBtn: { backgroundColor: '#ef4444', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 },
  endTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  hint: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 24, fontStyle: 'italic' },
});
