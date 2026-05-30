/**
 * Teacher — My Live Sessions / Recent Sessions (T5)
 *
 *  GET /api/live/sessions/my-sessions
 *  Lets teacher pick a session to view: PreClassBrief / HealthReport / LiveDashboard.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

export default function MyLiveSessionsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/live/sessions/my-sessions');
      setItems(Array.isArray(data) ? data : (data?.sessions ?? []));
    } catch (err) {
      console.warn('[MyLive] error:', err?.message);
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <Text style={styles.heading}>📡 My Live Sessions</Text>
        <Text style={styles.sub}>Tap a session to view AI brief or post-class health report.</Text>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="radio-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No live sessions yet.</Text>
          </View>
        ) : (
          items.map((s, i) => {
            const live = s.status === 'live' || s.status === 'active' || s.is_active;
            return (
              <View key={s.id ?? i} style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons
                    name={live ? 'radio' : 'radio-outline'}
                    size={18}
                    color={live ? '#ef4444' : '#94a3b8'}
                  />
                  <Text style={styles.cardTitle}>{s.subject_name ?? s.title ?? 'Session'}</Text>
                  {live && (
                    <View style={styles.livePill}>
                      <Text style={styles.livePillTxt}>LIVE</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.meta}>
                  {(s.started_at ?? s.created_at ?? '').slice(0, 16).replace('T', ' ')}
                  {s.section_name ? ` · ${s.section_name}` : ''}
                </Text>
                <View style={styles.btnRow}>
                  {live && (
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: PRIMARY }]}
                      onPress={() =>
                        navigation.navigate('LiveSessionDashboard', { session_id: s.id })
                      }
                    >
                      <Ionicons name="grid-outline" size={14} color="#fff" />
                      <Text style={styles.btnTxt}>Dashboard</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: '#3b82f6' }]}
                    onPress={() => navigation.navigate('PreClassBrief', { session_id: s.id })}
                  >
                    <Ionicons name="book-outline" size={14} color="#fff" />
                    <Text style={styles.btnTxt}>Brief</Text>
                  </TouchableOpacity>
                  {!live && (
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: '#22c55e' }]}
                      onPress={() =>
                        navigation.navigate('SessionHealthReport', { session_id: s.id })
                      }
                    >
                      <Ionicons name="pulse-outline" size={14} color="#fff" />
                      <Text style={styles.btnTxt}>Health</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#1e293b' },
  livePill: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  livePillTxt: { fontSize: 9, color: '#fff', fontWeight: '800' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  btnTxt: { fontSize: 11, color: '#fff', fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { fontSize: 14, color: '#64748b', fontWeight: '600', marginTop: 10 },
});
