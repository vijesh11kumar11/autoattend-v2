/**
 * Student — Knowledge Graph (S5)
 * GET /api/live/students/my-knowledge-graph
 * Lists subjects/topics with mastery scores; tap to expand topics.
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
const masteryColor = (m) => (m >= 75 ? '#22c55e' : m >= 50 ? '#f59e0b' : '#ef4444');

export default function StudentKnowledgeGraphScreen() {
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState({});

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/live/students/my-knowledge-graph');
      setGraph(data);
    } catch (err) {
      console.warn('[KG] fetch error:', err?.message);
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

  const subjects = graph?.subjects ?? graph?.knowledge_graph ?? graph?.nodes ?? [];
  const overall = graph?.overall_mastery ?? graph?.average_mastery;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <Text style={styles.heading}>🧠 Knowledge Graph</Text>
        <Text style={styles.sub}>Topic-level mastery across your subjects.</Text>

        {overall != null && (
          <View style={styles.overall}>
            <Text style={styles.overallLabel}>Overall Mastery</Text>
            <Text style={[styles.overallVal, { color: masteryColor(overall) }]}>
              {Number(overall).toFixed(0)}%
            </Text>
          </View>
        )}

        {!subjects.length ? (
          <View style={styles.empty}>
            <Ionicons name="school-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No knowledge data yet.</Text>
            <Text style={styles.emptySub}>
              Attend live sessions and answer pulse-checks to build your graph.
            </Text>
          </View>
        ) : (
          subjects.map((s, i) => {
            const key = String(s.id ?? s.subject_id ?? i);
            const exp = expanded[key];
            const topics = s.topics ?? s.children ?? [];
            const mastery = s.mastery ?? s.mastery_score ?? s.score ?? 0;
            return (
              <View key={key} style={styles.subjCard}>
                <TouchableOpacity
                  style={styles.subjHead}
                  onPress={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                >
                  <View style={[styles.dot, { backgroundColor: masteryColor(mastery) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subjName}>{s.name ?? s.subject_name ?? 'Subject'}</Text>
                    <Text style={styles.subjMeta}>
                      {topics.length} topic{topics.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text style={[styles.subjPct, { color: masteryColor(mastery) }]}>
                    {Number(mastery).toFixed(0)}%
                  </Text>
                  <Ionicons name={exp ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
                </TouchableOpacity>
                {exp &&
                  topics.map((t, j) => {
                    const tm = t.mastery ?? t.mastery_score ?? t.score ?? 0;
                    return (
                      <View key={j} style={styles.topicRow}>
                        <View style={[styles.topicDot, { backgroundColor: masteryColor(tm) }]} />
                        <Text style={styles.topicName}>{t.name ?? t.topic ?? 'Topic'}</Text>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              { width: `${Math.min(100, tm)}%`, backgroundColor: masteryColor(tm) },
                            ]}
                          />
                        </View>
                        <Text style={[styles.topicPct, { color: masteryColor(tm) }]}>
                          {Number(tm).toFixed(0)}%
                        </Text>
                      </View>
                    );
                  })}
                {exp && !topics.length && <Text style={styles.empty2}>No topics tracked yet.</Text>}
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
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 14 },
  overall: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  overallLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '700' },
  overallVal: { fontSize: 28, fontWeight: '900', marginTop: 4 },
  subjCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  subjHead: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  subjName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  subjMeta: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  subjPct: { fontSize: 16, fontWeight: '800' },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    paddingLeft: 26,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  topicDot: { width: 6, height: 6, borderRadius: 3 },
  topicName: { flex: 1, fontSize: 12, color: '#475569', fontWeight: '600' },
  barTrack: {
    width: 70,
    height: 6,
    backgroundColor: '#f1f5f9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },
  topicPct: { fontSize: 11, fontWeight: '700', minWidth: 36, textAlign: 'right' },
  empty: {
    alignItems: 'center',
    paddingTop: 40,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyTxt: { fontSize: 14, color: '#64748b', fontWeight: '600', marginTop: 10 },
  emptySub: { fontSize: 11, color: '#94a3b8', marginTop: 4, textAlign: 'center' },
  empty2: { fontSize: 11, color: '#94a3b8', fontStyle: 'italic', padding: 10, paddingLeft: 26 },
});
