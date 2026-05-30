/**
 * TeacherClassPulseMobileScreen — exports 3 screens:
 *   TeacherClassPulseHomeScreen   (tab switcher: My Capsules | Class Wall)
 *   CapsuleAnalyticsMobileScreen  (per-capsule student engagement)
 *   AnswerDoubtMobileScreen       (reply to a wall post)
 *
 * Wire these in the Teacher stack navigator.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const VIOLET = '#7c3aed';

// ═══════════════════════════════════════════════════════════════════════
// Home — tabs
// ═══════════════════════════════════════════════════════════════════════
export function TeacherClassPulseHomeScreen({ navigation }) {
  const [tab, setTab] = useState('capsules');
  const [subjects, setSubjects] = useState([]);
  const [activeSubject, setActiveSubject] = useState(null);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  useEffect(() => {
    navigation.setOptions({ title: '📚 ClassPulse' });
    let cancelled = false;
    client
      .get('/classpulse/teacher/dashboard')
      .then((r) => {
        if (cancelled) return;
        const list = (r.data?.subjects || []).map((x) => ({
          id: x.subject_id,
          name: x.subject_name,
        }));
        setSubjects(list);
        if (list.length > 0) setActiveSubject(list[0]);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSubjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  if (loadingSubjects)
    return (
      <Center>
        <ActivityIndicator color={PRIMARY} />
      </Center>
    );
  if (subjects.length === 0)
    return (
      <Center>
        <Text style={s.muted}>No subjects assigned to you.</Text>
      </Center>
    );

  return (
    <SafeAreaView style={s.root} edges={['left', 'right']}>
      <View style={s.tabs}>
        {[
          { key: 'capsules', label: 'My Capsules' },
          { key: 'wall', label: 'Class Wall' },
        ].map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[s.tabBtn, tab === t.key && s.tabBtnActive]}
          >
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ padding: 8 }}
      >
        {subjects.map((sb) => (
          <TouchableOpacity
            key={sb.id}
            onPress={() => setActiveSubject(sb)}
            style={[s.chip, activeSubject?.id === sb.id && s.chipActive]}
          >
            <Text style={[s.chipText, activeSubject?.id === sb.id && s.chipTextActive]}>
              {sb.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === 'capsules' ? (
        <CapsulesTab subject={activeSubject} navigation={navigation} />
      ) : (
        <WallTab subject={activeSubject} navigation={navigation} />
      )}
    </SafeAreaView>
  );
}

// ── Capsules tab ────────────────────────────────────────────────
function CapsulesTab({ subject, navigation }) {
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!subject) return;
    try {
      const r = await client.get(`/classpulse/teacher/subject/${subject.id}/capsules`);
      setCapsules(r.data?.capsules || []);
    } catch (err) {
      console.warn('[TeacherClassPulseMobileScreen] fetch error:', err?.message);
    }
  }, [subject]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  if (!subject)
    return (
      <Center>
        <Text style={s.muted}>Select a subject.</Text>
      </Center>
    );
  if (loading)
    return (
      <Center>
        <ActivityIndicator color={PRIMARY} />
      </Center>
    );

  return (
    <FlatList
      data={capsules}
      keyExtractor={(c) => String(c.id)}
      contentContainerStyle={{ padding: 12 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          colors={[PRIMARY]}
        />
      }
      ListEmptyComponent={<Empty text="No capsules in this subject." />}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={s.card}
          onPress={() =>
            navigation.navigate('CapsuleAnalytics', {
              capsuleId: item.id,
              capsuleTitle: item.title,
            })
          }
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 18 }}>{iconFor(item.capsule_type)}</Text>
            <Text style={[s.cardTitle, { flex: 1 }]} numberOfLines={2}>
              {item.title}
            </Text>
          </View>
          <View style={s.statRow}>
            <Stat label="Views" value={item.view_count ?? 0} />
            <Stat label="Downloads" value={item.download_count ?? 0} />
            <Stat
              label="Quiz Pass"
              value={`${item.quiz_pass_pct ?? 0}%`}
              tone={
                item.quiz_pass_pct >= 70
                  ? '#15803d'
                  : item.quiz_pass_pct >= 50
                    ? '#b45309'
                    : '#b91c1c'
              }
            />
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

// ── Wall tab ────────────────────────────────────────────────────
function WallTab({ subject, navigation }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!subject) return;
    try {
      const r = await client.get(`/classpulse/teacher/subject/${subject.id}/wall`);
      setPosts(r.data?.posts || []);
    } catch (err) {
      console.warn('[TeacherClassPulseMobileScreen] fetch error:', err?.message);
    }
  }, [subject]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  if (!subject)
    return (
      <Center>
        <Text style={s.muted}>Select a subject.</Text>
      </Center>
    );
  if (loading)
    return (
      <Center>
        <ActivityIndicator color={PRIMARY} />
      </Center>
    );

  // Hot doubts first
  const sorted = [...posts].sort((a, b) => (b.is_hot ? 1 : 0) - (a.is_hot ? 1 : 0));

  return (
    <FlatList
      data={sorted}
      keyExtractor={(p) => String(p.id)}
      contentContainerStyle={{ padding: 12 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          colors={[PRIMARY]}
        />
      }
      ListEmptyComponent={<Empty text="No wall posts." />}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={s.card}
          onPress={() => navigation.navigate('AnswerDoubt', { post: item })}
        >
          {item.is_hot && <Text style={s.hotBadge}>🔥 Hot — {item.resonance_count} students</Text>}
          <Text style={s.postContent} numberOfLines={3}>
            {item.content}
          </Text>
          <View style={s.postRow}>
            <Text style={s.muted}>👤 {item.student_name || 'Anonymous'}</Text>
            <View
              style={[
                s.statusPill,
                { backgroundColor: item.status === 'answered' ? '#dcfce7' : '#fef3c7' },
              ]}
            >
              <Text
                style={[
                  s.statusPillText,
                  { color: item.status === 'answered' ? '#166534' : '#b45309' },
                ]}
              >
                {item.status}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Capsule Analytics — per-student engagement
// ═══════════════════════════════════════════════════════════════════════
export function CapsuleAnalyticsMobileScreen({ route, navigation }) {
  const { capsuleId, capsuleTitle } = route.params || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navigation.setOptions({ title: capsuleTitle || 'Analytics' });
  }, [navigation, capsuleTitle]);

  useEffect(() => {
    let cancelled = false;
    client
      .get(`/classpulse/teacher/capsule/${capsuleId}/analytics`)
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capsuleId]);

  if (loading)
    return (
      <Center>
        <ActivityIndicator color={PRIMARY} />
      </Center>
    );
  if (!data)
    return (
      <Center>
        <Text style={s.muted}>Failed to load analytics.</Text>
      </Center>
    );

  const students = data.students || [];
  const atRisk = students.filter((st) => st.opened && st.quiz_attempted && !st.quiz_passed);

  return (
    <SafeAreaView style={s.root} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        <View style={s.section}>
          <Text style={s.sectionTitle}>📊 Capsule Stats</Text>
          <View style={s.statRow}>
            <Stat label="Opened" value={data.opened_count ?? 0} />
            <Stat
              label="Quiz Pass %"
              value={`${data.quiz_pass_pct ?? 0}%`}
              tone={data.quiz_pass_pct >= 70 ? '#15803d' : '#b45309'}
            />
            <Stat label="Downloads" value={data.download_count ?? 0} />
          </View>
        </View>

        {atRisk.length > 0 && (
          <View
            style={[
              s.section,
              { backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1 },
            ]}
          >
            <Text style={[s.sectionTitle, { color: '#b91c1c' }]}>🚨 At Risk ({atRisk.length})</Text>
            {atRisk.map((st) => (
              <View key={st.student_id} style={s.studentRow}>
                <Text style={[s.studentName, { color: '#b91c1c' }]}>{st.name}</Text>
                <Text style={s.muted}>Quiz: {st.quiz_score ?? 0}%</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>👥 All Students</Text>
          {students.length === 0 ? (
            <Text style={s.muted}>No students.</Text>
          ) : (
            students.map((st) => (
              <View key={st.student_id} style={s.studentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.studentName}>{st.name}</Text>
                  <Text style={s.muted}>Roll: {st.roll_no || '—'}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.tag, { color: st.opened ? '#15803d' : '#94a3b8' }]}>
                    {st.opened ? '📖 Opened' : '⬜ Not opened'}
                  </Text>
                  {st.quiz_attempted && (
                    <Text style={[s.tag, { color: st.quiz_passed ? '#15803d' : '#b91c1c' }]}>
                      {st.quiz_passed ? '✅' : '❌'} {st.quiz_score}%
                    </Text>
                  )}
                  {st.downloaded && (
                    <Text style={[s.tag, { color: '#3b82f6' }]}>⬇️ Downloaded</Text>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Answer Doubt
// ═══════════════════════════════════════════════════════════════════════
export function AnswerDoubtMobileScreen({ route, navigation }) {
  const { post } = route.params || {};
  const [answer, setAnswer] = useState(post?.teacher_answer || '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: '💬 Answer Doubt' });
  }, [navigation]);

  const submit = async () => {
    if (!answer.trim()) return;
    setSubmitting(true);
    try {
      await client.post(`/classpulse/teacher/wall/${post.id}/answer`, { answer: answer.trim() });
      Alert.alert('Posted', 'Your answer has been published to the class wall.');
      navigation.goBack();
    } catch {
      Alert.alert('Failed', 'Could not post answer.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!post)
    return (
      <Center>
        <Text style={s.muted}>Missing post.</Text>
      </Center>
    );

  return (
    <SafeAreaView style={s.root} edges={['left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <View style={s.section}>
            <Text style={s.sectionTitle}>👤 {post.student_name || 'Anonymous'}</Text>
            <Text style={s.postContent}>{post.content}</Text>
            {post.is_hot && (
              <Text style={[s.hotBadge, { marginTop: 6 }]}>
                🔥 Hot — {post.resonance_count} students resonated
              </Text>
            )}
          </View>

          {post.ai_answer && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>🤖 AI Suggestion</Text>
              <Text style={s.postContent}>{post.ai_answer}</Text>
            </View>
          )}

          <View style={s.section}>
            <Text style={s.sectionTitle}>Your Answer</Text>
            <TextInput
              value={answer}
              onChangeText={setAnswer}
              multiline
              placeholder="Type your reply…"
              style={s.textarea}
            />
            <TouchableOpacity
              style={[s.postBtn, (submitting || !answer.trim()) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={submitting || !answer.trim()}
            >
              <Text style={s.postBtnText}>{submitting ? 'Posting…' : 'Post Answer'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════
const iconFor = (t) =>
  t === 'voice_note' ? '🎙️' : t === 'video' ? '🎥' : t === 'image' ? '🖼️' : '📄';
function Center({ children }) {
  return <View style={s.center}>{children}</View>;
}
function Empty({ text }) {
  return <Text style={s.empty}>{text}</Text>;
}
function Stat({ label, value, tone }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[s.statValue, tone && { color: tone }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', color: '#94a3b8', padding: 24 },
  muted: { fontSize: 12, color: '#94a3b8' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderColor: 'transparent',
  },
  tabBtnActive: { borderColor: VIOLET },
  tabText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  tabTextActive: { color: VIOLET, fontWeight: '800' },
  chip: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: { backgroundColor: VIOLET, borderColor: VIOLET },
  chipText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  statRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  statValue: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  statLabel: {
    fontSize: 10,
    color: '#64748b',
    textTransform: 'uppercase',
    fontWeight: '700',
    marginTop: 2,
  },
  hotBadge: { fontSize: 11, fontWeight: '700', color: '#ea580c', marginBottom: 6 },
  postContent: { fontSize: 14, color: '#0f172a', marginTop: 4 },
  postRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  section: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#f1f5f9',
  },
  studentName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  tag: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  textarea: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
    minHeight: 100,
    textAlignVertical: 'top',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
  },
  postBtn: {
    backgroundColor: VIOLET,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  postBtnText: { color: '#fff', fontWeight: '700' },
});

export default TeacherClassPulseHomeScreen;
