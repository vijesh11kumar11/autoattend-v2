/**
 * Student — My Sessions / Upcoming (S6)
 * GET /api/live/sessions/my-sessions  (student's joined / available live sessions)
 * Plus, today's classes from /api/students/today-classes used as upcoming roster.
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

export default function MySessionsScreen({ navigation }) {
  const [live, setLive] = useState([]);
  const [today, setToday] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [a, b] = await Promise.allSettled([
        client.get('/live/sessions/my-sessions'),
        client.get('/students/today-classes'),
      ]);
      if (a.status === 'fulfilled') {
        const v = a.value.data;
        setLive(Array.isArray(v) ? v : (v?.sessions ?? []));
      }
      if (b.status === 'fulfilled') {
        const v = b.value.data;
        setToday(Array.isArray(v) ? v : (v?.classes ?? []));
      }
    } catch (err) {
      console.warn('[MySessions] fetch error:', err?.message);
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
        <Text style={styles.heading}>📅 My Sessions</Text>
        <Text style={styles.sub}>Live sessions and today's scheduled classes.</Text>

        <Text style={styles.section}>🔴 Live / Recent ({live.length})</Text>
        {live.length === 0 ? (
          <Text style={styles.empty}>No live sessions.</Text>
        ) : (
          live.slice(0, 20).map((s, i) => {
            const active = s.status === 'active' || s.is_active;
            return (
              <TouchableOpacity
                key={s.id ?? i}
                style={styles.row}
                onPress={() => navigation.navigate('LiveSession', { session_id: s.id })}
              >
                <Ionicons
                  name={active ? 'radio' : 'radio-outline'}
                  size={20}
                  color={active ? '#ef4444' : '#94a3b8'}
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.title}>{s.subject_name ?? s.subject ?? 'Session'}</Text>
                  <Text style={styles.meta}>
                    {active
                      ? 'LIVE NOW'
                      : (s.ended_at ?? s.end_time ?? s.created_at ?? '')
                          .slice(0, 16)
                          .replace('T', ' ')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
              </TouchableOpacity>
            );
          })
        )}

        <Text style={[styles.section, { marginTop: 18 }]}>🗓️ Today's Classes ({today.length})</Text>
        {today.length === 0 ? (
          <Text style={styles.empty}>No classes today.</Text>
        ) : (
          today.map((c, i) => (
            <View key={c.id ?? i} style={styles.row}>
              <Ionicons name="book-outline" size={18} color={PRIMARY} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.title}>{c.subject_name ?? c.subject ?? 'Class'}</Text>
                <Text style={styles.meta}>
                  {c.start_time ?? c.from_time ?? '—'}
                  {c.end_time || c.to_time ? ` – ${c.end_time ?? c.to_time}` : ''}
                  {c.faculty_name ? ` · ${c.faculty_name}` : ''}
                </Text>
              </View>
              {c.status && (
                <View
                  style={[styles.badge, c.status === 'active' && { backgroundColor: '#dcfce7' }]}
                >
                  <Text style={[styles.badgeTxt, c.status === 'active' && { color: '#15803d' }]}>
                    {c.status}
                  </Text>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 14 },
  section: { fontSize: 13, fontWeight: '700', color: '#1e293b', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  title: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  badge: { backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
});
