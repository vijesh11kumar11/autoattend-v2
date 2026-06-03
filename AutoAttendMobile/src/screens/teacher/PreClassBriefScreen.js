/**
 * Teacher — Pre-Class Brief (T3)
 *  GET /api/live/sessions/{session_id}/pre-class-brief
 *  AI-generated context: prior session recap, weak spots, suggested topics.
 *  Expects route.params.session_id.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

export default function PreClassBriefScreen({ route }) {
  const { session_id } = route?.params ?? {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!session_id) {
      setError('Missing session_id');
      return;
    }
    try {
      const { data } = await client.get(`/live/sessions/${session_id}/pre-class-brief`);
      setData(data);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not load brief.');
    }
  }, [session_id]);

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
        <Text style={styles.heading}>📚 Pre-Class Brief</Text>
        <Text style={styles.sub}>AI-prepared context for your upcoming session.</Text>

        {error && (
          <View style={styles.errBox}>
            <Ionicons name="warning-outline" size={18} color="#b91c1c" />
            <Text style={styles.errTxt}>{error}</Text>
          </View>
        )}

        {data && (
          <>
            <Section title="📌 Summary" body={data.summary ?? data.overview ?? null} />
            <Section
              title="🔄 Last Session Recap"
              body={data.last_session_recap ?? data.previous_summary ?? null}
            />
            <ListSection
              title="⚠️ Weak Topics"
              items={data.weak_topics ?? data.gaps ?? []}
              icon="alert-circle-outline"
              color="#ef4444"
            />
            <ListSection
              title="💡 Suggested Talking Points"
              items={data.suggested_topics ?? data.talking_points ?? data.suggestions ?? []}
              icon="bulb-outline"
              color="#f59e0b"
            />
            <ListSection
              title="🎯 Pre-requisites"
              items={data.prerequisites ?? []}
              icon="checkmark-circle-outline"
              color="#22c55e"
            />
            <ListSection
              title="📖 Key Concepts"
              items={data.key_concepts ?? data.concepts ?? []}
              icon="bookmark-outline"
              color={PRIMARY}
            />

            {!data.summary && !data.weak_topics?.length && !data.suggested_topics?.length && (
              <View style={styles.rawCard}>
                <Text style={{ fontSize: 11, color: '#64748b' }} selectable>
                  {JSON.stringify(data, null, 2)}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, body }) {
  if (!body) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{typeof body === 'string' ? body : JSON.stringify(body)}</Text>
    </View>
  );
}

function ListSection({ title, items, icon, color }) {
  if (!items?.length) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {items.map((it, i) => (
        <View key={i} style={styles.bullet}>
          <Ionicons name={icon} size={14} color={color} />
          <Text style={styles.bulletTxt}>
            {typeof it === 'string' ? it : (it.title ?? it.name ?? it.text ?? JSON.stringify(it))}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#1e293b', marginBottom: 8 },
  cardBody: { fontSize: 13, color: '#475569', lineHeight: 19 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  bulletTxt: { flex: 1, fontSize: 13, color: '#1e293b' },
  errBox: {
    flexDirection: 'row',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    alignItems: 'center',
    marginBottom: 14,
  },
  errTxt: { flex: 1, color: '#b91c1c', fontSize: 12, fontWeight: '600' },
  rawCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
});
