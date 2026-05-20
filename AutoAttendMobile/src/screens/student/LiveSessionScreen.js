/**
 * Student — Live Session Screen
 * GET /api/live/sessions/{session_id}/details (poll every 10s)
 * Used to display current live session status the student has joined.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const POLL_MS = 10_000;

export default function LiveSessionScreen({ route }) {
  const { session_id } = route.params || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef(null);

  const fetchData = useCallback(async () => {
    if (!session_id) return;
    try {
      const { data: d } = await client.get(`/live/sessions/${session_id}/details`);
      setData(d);
    } catch (err) { console.warn('[LiveSession] fetch error:', err?.message); }
  }, [session_id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    timerRef.current = setInterval(fetchData, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  if (!data)   return <View style={styles.center}><Text style={styles.err}>Could not load session.</Text></View>;

  const isLive = data.status === 'active' || data.is_active;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <View style={[styles.statusCard, { backgroundColor: isLive ? '#dcfce7' : '#fee2e2' }]}>
          <Ionicons name={isLive ? 'radio-outline' : 'stop-circle-outline'} size={28} color={isLive ? '#15803d' : '#b91c1c'} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.statusTxt, { color: isLive ? '#15803d' : '#b91c1c' }]}>
              {isLive ? '🔴 LIVE' : 'Session Ended'}
            </Text>
            <Text style={styles.statusSub}>{data.subject_name ?? data.subject ?? ''}</Text>
          </View>
        </View>

        <Text style={styles.section}>Session Info</Text>
        <View style={styles.infoCard}>
          <InfoRow icon="person-outline" label="Teacher" value={data.teacher_name ?? '—'} />
          <InfoRow icon="time-outline" label="Started" value={data.started_at?.replace('T', ' ').slice(0, 16) ?? '—'} />
          <InfoRow icon="people-outline" label="Participants" value={data.participant_count ?? data.participants?.length ?? 0} />
          {data.topic ? <InfoRow icon="bookmark-outline" label="Topic" value={data.topic} /> : null}
        </View>

        {data.pulse_checks?.length > 0 && (
          <>
            <Text style={styles.section}>Active Pulse Checks</Text>
            {data.pulse_checks.map((p, i) => (
              <View key={p.id ?? i} style={styles.pulseCard}>
                <Text style={styles.pulseQ}>{p.question}</Text>
                <Text style={styles.pulseMeta}>{p.response_count ?? 0} responses</Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.hint}>This screen auto-refreshes every 10 seconds.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color="#94a3b8" />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoVal}>{String(value)}</Text>
    </View>
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
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 16, marginBottom: 10 },
  infoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  infoLabel: { fontSize: 12, color: '#94a3b8', width: 100 },
  infoVal: { fontSize: 13, color: '#1e293b', fontWeight: '600', flex: 1 },
  pulseCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  pulseQ: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  pulseMeta: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  hint: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 24, fontStyle: 'italic' },
});
