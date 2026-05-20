/**
 * ClassPulseMobileScreen — exports 4 screens:
 *   ClassPulseHomeScreen       (subject list)
 *   ClassPulseSubjectScreen    (capsules under one subject)
 *   CapsuleMobileDetailScreen  (open one capsule + voice + PDF + quiz + ask)
 *   ClassWallMobileScreen      (anonymous wall for one subject)
 *
 * Wire each in the Student stack navigator.
 *
 * Optional native deps (graceful fallback if not installed):
 *   expo-av           — audio playback
 *   expo-web-browser  — open PDF
 *   expo-file-system  — download PDF with auth header
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const VIOLET  = '#7c3aed';

// ── Access status banners (mirror web) ───────────────────────────────
const ACCESS_BANNER = {
  granted:        null,
  not_enrolled:   { tone: '#ef4444', label: 'Not enrolled in this subject' },
  wrong_section:  { tone: '#ef4444', label: 'Different section' },
  capsule_inactive: { tone: '#94a3b8', label: 'Capsule inactive' },
  locked_attendance: { tone: '#f59e0b', label: 'Unlocks after meeting attendance threshold' },
  locked_pre_class:  { tone: '#f59e0b', label: 'Locked until class begins' },
  locked_post_class: { tone: '#f59e0b', label: 'Locked until class ends' },
  summary_only:      { tone: '#3b82f6', label: 'Summary-only (full PDF locked)' },
};
const DENY = new Set(['not_enrolled', 'wrong_section', 'capsule_inactive', 'locked_attendance', 'locked_pre_class', 'locked_post_class']);

const STATUS_LABEL = (s) => ACCESS_BANNER[s]?.label || s;

// ═══════════════════════════════════════════════════════════════════════
// SCREEN 1 — Subject Selection
// ═══════════════════════════════════════════════════════════════════════
export function ClassPulseHomeScreen({ navigation }) {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await client.get('/students/dashboard');
      setSubjects(r.data?.subjects || []);
    } catch (err) { console.warn("[ClassPulseMobileScreen] fetch error:", err?.message); }
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) return <Center><ActivityIndicator color={PRIMARY} /></Center>;

  return (
    <SafeAreaView style={s.root} edges={['left', 'right']}>
      <FlatList
        data={subjects}
        keyExtractor={i => String(i.subject_id)}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListHeaderComponent={(
          <View style={{ marginBottom: 8 }}>
            <Text style={s.h1}>📚 ClassPulse</Text>
            <Text style={s.sub}>Tap a subject to view capsules</Text>
          </View>
        )}
        ListEmptyComponent={<Empty text="No subjects assigned." />}
        renderItem={({ item }) => (
          <SubjectCard
            item={item}
            onPress={() => navigation.navigate('ClassPulseSubject', {
              subjectId:    item.subject_id,
              subjectName:  item.subject_name,
              attendancePct: item.percentage,
            })}
          />
        )}
      />
    </SafeAreaView>
  );
}

function SubjectCard({ item, onPress }) {
  const pct = item.percentage || 0;
  const ringColor = pct >= 75 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <TouchableOpacity style={s.card} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={s.cardTitle}>{item.subject_name}</Text>
        <Text style={s.cardSub}>{item.subject_code || ''}</Text>
        <Text style={[s.attBadge, { color: ringColor }]}>Attendance: {pct}%</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SCREEN 2 — Subject Capsules
// ═══════════════════════════════════════════════════════════════════════
export function ClassPulseSubjectScreen({ route, navigation }) {
  const { subjectId, subjectName, attendancePct } = route.params || {};
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denyInfo, setDenyInfo] = useState(null);

  useEffect(() => { navigation.setOptions({ title: subjectName || 'Subject' }); }, [navigation, subjectName]);

  const load = useCallback(async () => {
    try {
      const r = await client.get(`/classpulse/student/subject/${subjectId}/capsules`);
      setCapsules(r.data?.capsules || []);
    } catch (err) { console.warn("[ClassPulseMobileScreen] fetch error:", err?.message); }
  }, [subjectId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) return <Center><ActivityIndicator color={PRIMARY} /></Center>;

  return (
    <SafeAreaView style={s.root} edges={['left', 'right']}>
      <View style={s.subjectHeader}>
        <Text style={s.subjectHeaderTitle}>{subjectName}</Text>
        {attendancePct !== undefined && (
          <View style={[s.pill, { backgroundColor: attendancePct >= 75 ? '#dcfce7' : attendancePct >= 60 ? '#fef3c7' : '#fee2e2' }]}>
            <Text style={[s.pillText, { color: attendancePct >= 75 ? '#15803d' : attendancePct >= 60 ? '#b45309' : '#b91c1c' }]}>
              {attendancePct}%
            </Text>
          </View>
        )}
        <TouchableOpacity onPress={() => navigation.navigate('ClassWall', { subjectId, subjectName })} style={s.wallBtn}>
          <Text style={s.wallBtnText}>💬 Wall</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={capsules}
        keyExtractor={i => String(i.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={<Empty text="No capsules yet." />}
        renderItem={({ item }) => (
          <CapsuleCard
            c={item}
            onPress={() => {
              if (DENY.has(item.access_status)) {
                setDenyInfo({ status: item.access_status, title: item.title });
                return;
              }
              navigation.navigate('CapsuleDetail', {
                capsuleId: item.id,
                capsuleTitle: item.title,
              });
            }}
          />
        )}
      />

      {/* Deny bottom sheet */}
      <Modal visible={!!denyInfo} transparent animationType="slide" onRequestClose={() => setDenyInfo(null)}>
        <Pressable style={s.sheetBackdrop} onPress={() => setDenyInfo(null)}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>🔒 Locked</Text>
            <Text style={s.sheetText}>{denyInfo?.title}</Text>
            <Text style={s.sheetReason}>{denyInfo ? STATUS_LABEL(denyInfo.status) : ''}</Text>
            <TouchableOpacity style={s.sheetBtn} onPress={() => setDenyInfo(null)}>
              <Text style={s.sheetBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function CapsuleCard({ c, onPress }) {
  const banner = ACCESS_BANNER[c.access_status];
  const keyPoints = (c.ai_summary?.key_points || []).slice(0, 2);
  return (
    <TouchableOpacity style={s.capsuleCard} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 18 }}>{c.capsule_type === 'voice_note' ? '🎙️' : c.capsule_type === 'video' ? '🎥' : c.capsule_type === 'image' ? '🖼️' : '📄'}</Text>
        <Text style={[s.capsuleTitle, { flex: 1 }]} numberOfLines={2}>{c.title}</Text>
      </View>
      {banner && (
        <View style={[s.accessBanner, { borderColor: banner.tone, backgroundColor: banner.tone + '15' }]}>
          <Text style={[s.accessBannerText, { color: banner.tone }]}>{banner.label}</Text>
        </View>
      )}
      {keyPoints.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {keyPoints.map((kp, i) => (
            <Text key={i} style={s.bullet}>• {kp}</Text>
          ))}
        </View>
      )}
      {c.my_interaction && (
        <View style={s.interactionRow}>
          {c.my_interaction.opened && <Tag bg="#dbeafe" fg="#1e40af" text="Opened" />}
          {c.my_interaction.quiz_attempted && (
            <Tag
              bg={c.my_interaction.quiz_passed ? '#dcfce7' : '#fee2e2'}
              fg={c.my_interaction.quiz_passed ? '#166534' : '#991b1b'}
              text={c.my_interaction.quiz_passed ? `Quiz ✓ ${c.my_interaction.quiz_score}` : `Quiz ✗ ${c.my_interaction.quiz_score}`}
            />
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SCREEN 3 — Capsule Detail
// ═══════════════════════════════════════════════════════════════════════
export function CapsuleMobileDetailScreen({ route, navigation }) {
  const { capsuleId, capsuleTitle } = route.params || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasOpenedDoc, setHasOpenedDoc] = useState(false);
  const [audioState, setAudioState] = useState({ loading: false, sound: null, playing: false });
  const [doubt, setDoubt] = useState('');
  const [postingDoubt, setPostingDoubt] = useState(false);

  useEffect(() => { navigation.setOptions({ title: capsuleTitle || 'Capsule' }); }, [navigation, capsuleTitle]);

  // Heartbeat (only when foreground)
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { appStateRef.current = s; });
    return () => sub.remove();
  }, []);

  // Open + load capsule
  useEffect(() => {
    let cancelled = false;
    client.post(`/classpulse/student/capsule/${capsuleId}/open`)
      .then(r => { if (!cancelled) { setData(r.data); setLoading(false); } })
      .catch(() => { if (!cancelled) { setLoading(false); } });
    return () => { cancelled = true; };
  }, [capsuleId]);

  // Heartbeat every 30s
  useEffect(() => {
    const h = setInterval(() => {
      if (appStateRef.current !== 'active') return;
      client.post(`/classpulse/student/capsule/${capsuleId}/heartbeat`, {
        pages_viewed: hasOpenedDoc ? 1 : 0,
        total_pages: 1,
      }).catch(() => {});
    }, 30000);
    return () => clearInterval(h);
  }, [capsuleId, hasOpenedDoc]);

  // Cleanup audio
  useEffect(() => () => { if (audioState.sound) audioState.sound.unloadAsync().catch(() => {}); }, [audioState.sound]);

  const playVoice = async () => {
    if (audioState.playing && audioState.sound) {
      await audioState.sound.pauseAsync().catch(() => {});
      setAudioState(st => ({ ...st, playing: false }));
      return;
    }
    if (audioState.sound) {
      await audioState.sound.playAsync().catch(() => {});
      setAudioState(st => ({ ...st, playing: true }));
      return;
    }
    setAudioState(st => ({ ...st, loading: true }));
    try {
      const Av = await import('expo-av');
      const SecureStore = await import('expo-secure-store');
      const token = await SecureStore.getItemAsync('aa_auth_token');
      const baseURL = client.defaults.baseURL;
      const uri = `${baseURL}/classpulse/student/capsule/${capsuleId}/voice`;
      const { sound } = await Av.Audio.Sound.createAsync(
        { uri, headers: token ? { Authorization: `Bearer ${token}` } : {} },
        { shouldPlay: true },
      );
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.didJustFinish) setAudioState(s => ({ ...s, playing: false }));
      });
      setAudioState({ loading: false, sound, playing: true });
    } catch (e) {
      setAudioState(st => ({ ...st, loading: false }));
      Alert.alert('Audio playback failed', 'Please install expo-av to play voice notes.');
    }
  };

  const openDocument = async () => {
    setHasOpenedDoc(true);
    try {
      const SecureStore = await import('expo-secure-store');
      const token = await SecureStore.getItemAsync('aa_auth_token');
      const baseURL = client.defaults.baseURL;
      const url = `${baseURL}/classpulse/student/capsule/${capsuleId}/file`;
      // Try expo-file-system + WebBrowser flow
      try {
        const FS = await import('expo-file-system');
        const target = `${FS.cacheDirectory}capsule_${capsuleId}.pdf`;
        const dl = await FS.downloadAsync(url, target, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        try {
          const WB = await import('expo-web-browser');
          await WB.openBrowserAsync(dl.uri);
        } catch {
          await Linking.openURL(dl.uri);
        }
        return;
      } catch {/* fallback */}
      // Last-resort: open URL directly (will likely fail without auth)
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open document', 'Please install expo-file-system + expo-web-browser, or check your connection.');
    }
  };

  const submitDoubt = async () => {
    if (!doubt.trim() || !data) return;
    setPostingDoubt(true);
    try {
      await client.post(`/classpulse/student/wall/post`, {
        subject_id: data.subject_id,
        content: doubt.trim(),
        capsule_id: capsuleId,
      });
      setDoubt('');
      Alert.alert('Posted', 'Your doubt has been added to the class wall.');
    } catch {
      Alert.alert('Failed', 'Could not post doubt.');
    } finally {
      setPostingDoubt(false);
    }
  };

  if (loading) return <Center><ActivityIndicator color={PRIMARY} /></Center>;
  if (!data)  return <Center><Text>Failed to load capsule.</Text></Center>;

  const keyPoints = data.ai_summary?.key_points || [];
  const hasVoice  = data.has_voice_note;
  const hasFile   = data.file_available;
  const quiz      = data.quiz;

  return (
    <SafeAreaView style={s.root} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 }}>
        {/* AI Summary */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>🤖 AI Summary</Text>
          {keyPoints.length === 0 ? (
            <Text style={s.muted}>No summary available.</Text>
          ) : (
            keyPoints.map((kp, i) => <Text key={i} style={s.bullet}>• {kp}</Text>)
          )}
        </View>

        {/* Voice Note */}
        {hasVoice && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>🎙️ Voice Note</Text>
            <TouchableOpacity onPress={playVoice} style={s.playBtn} disabled={audioState.loading}>
              {audioState.loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.playBtnText}>{audioState.playing ? '⏸ Pause' : '▶ Play voice memo'}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* PDF */}
        {hasFile && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>📄 View Document</Text>
            <TouchableOpacity onPress={openDocument} style={s.docBtn}>
              <Text style={s.docBtnText}>📖 Open Document</Text>
            </TouchableOpacity>
            {!hasOpenedDoc && <Text style={s.muted}>Open the document to unlock the comprehension quiz.</Text>}
          </View>
        )}

        {/* Quiz */}
        {hasOpenedDoc && quiz && Array.isArray(quiz.questions) && quiz.questions.length > 0 && (
          <QuizSection capsuleId={capsuleId} quiz={quiz} alreadyAttempted={data.my_interaction?.quiz_attempted} previousScore={data.my_interaction?.quiz_score} previousPassed={data.my_interaction?.quiz_passed} />
        )}

        {/* Ask Doubt */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>💬 Ask a Doubt</Text>
          <TextInput
            value={doubt}
            onChangeText={setDoubt}
            multiline
            placeholder="Type your doubt about this capsule…"
            style={s.textarea}
          />
          <TouchableOpacity onPress={submitDoubt} disabled={postingDoubt || !doubt.trim()} style={[s.postBtn, (postingDoubt || !doubt.trim()) && { opacity: 0.5 }]}>
            <Text style={s.postBtnText}>{postingDoubt ? 'Posting…' : 'Post Anonymously'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuizSection({ capsuleId, quiz, alreadyAttempted, previousScore, previousPassed }) {
  const questions = quiz.questions || [];
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(alreadyAttempted ? { score: previousScore, passed: previousPassed, prior: true } : null);

  if (result) {
    return (
      <View style={[s.section, { backgroundColor: result.passed ? '#f0fdf4' : '#fef2f2', borderColor: result.passed ? '#bbf7d0' : '#fecaca', borderWidth: 1 }]}>
        <Text style={s.sectionTitle}>📝 Quiz {result.prior ? '(Previous Attempt)' : 'Result'}</Text>
        <Text style={[s.bigScore, { color: result.passed ? '#15803d' : '#b91c1c' }]}>{result.score}%</Text>
        <Text style={[s.bullet, { fontWeight: '700', color: result.passed ? '#15803d' : '#b91c1c' }]}>
          {result.passed ? '🎉 Passed!' : 'Try again later'}
        </Text>
      </View>
    );
  }

  const q = questions[idx];
  const submit = async (finalAnswers) => {
    setSubmitting(true);
    try {
      const r = await client.post(`/classpulse/student/capsule/${capsuleId}/submit-quiz`, {
        answers: finalAnswers,
      });
      setResult({ score: r.data?.score ?? 0, passed: r.data?.passed ?? false });
    } catch {
      Alert.alert('Submit failed', 'Could not submit your quiz.');
    } finally {
      setSubmitting(false);
    }
  };

  const choose = (optionIdx) => {
    const next = { ...answers, [q.id ?? idx]: optionIdx };
    setAnswers(next);
    if (idx < questions.length - 1) {
      setIdx(idx + 1);
    } else {
      submit(next);
    }
  };

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>📝 Comprehension Quiz</Text>
      <Text style={s.muted}>Question {idx + 1} of {questions.length}</Text>
      <Text style={[s.cardTitle, { marginTop: 8 }]}>{q.question || q.text}</Text>
      <View style={{ marginTop: 12, gap: 8 }}>
        {(q.options || []).map((opt, i) => (
          <TouchableOpacity key={i} style={s.optBtn} onPress={() => choose(i)} disabled={submitting}>
            <Text style={s.optText}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {submitting && <ActivityIndicator color={PRIMARY} style={{ marginTop: 12 }} />}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SCREEN 4 — Class Wall
// ═══════════════════════════════════════════════════════════════════════
export function ClassWallMobileScreen({ route, navigation }) {
  const { subjectId, subjectName } = route.params || {};
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newDoubt, setNewDoubt] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => { navigation.setOptions({ title: `💬 ${subjectName || 'Wall'}` }); }, [navigation, subjectName]);

  const load = useCallback(async () => {
    try {
      const r = await client.get(`/classpulse/student/subject/${subjectId}/wall`);
      setPosts(r.data?.posts || []);
    } catch (err) { console.warn("[ClassPulseMobileScreen] fetch error:", err?.message); }
  }, [subjectId]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const toggleResonance = async (post) => {
    // optimistic
    setPosts(p => p.map(x => x.id === post.id
      ? { ...x, resonance_count: (x.resonance_count || 0) + (x.has_resonated ? -1 : 1), has_resonated: !x.has_resonated }
      : x));
    try {
      await client.post(`/classpulse/student/wall/${post.id}/resonate`);
    } catch {
      load();
    }
  };

  const submit = async () => {
    if (!newDoubt.trim()) return;
    setPosting(true);
    try {
      await client.post(`/classpulse/student/wall/post`, { subject_id: subjectId, content: newDoubt.trim() });
      setNewDoubt(''); setShowAdd(false); load();
    } catch {
      Alert.alert('Failed', 'Could not post.');
    } finally { setPosting(false); }
  };

  if (loading) return <Center><ActivityIndicator color={PRIMARY} /></Center>;

  return (
    <SafeAreaView style={s.root} edges={['left', 'right']}>
      <FlatList
        data={posts}
        keyExtractor={p => String(p.id)}
        contentContainerStyle={{ padding: 12, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListEmptyComponent={<Empty text="No posts yet. Be the first to ask!" />}
        renderItem={({ item }) => <WallPost p={item} onResonate={() => toggleResonance(item)} />}
      />

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setShowAdd(true)}>
        <Text style={s.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add doubt sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={s.sheetBackdrop} onPress={() => setShowAdd(false)}>
            <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
              <Text style={s.sheetTitle}>Ask a doubt</Text>
              <TextInput
                value={newDoubt}
                onChangeText={setNewDoubt}
                multiline
                placeholder="What's on your mind?"
                style={s.textarea}
              />
              <TouchableOpacity style={[s.sheetBtn, (!newDoubt.trim() || posting) && { opacity: 0.5 }]} onPress={submit} disabled={posting || !newDoubt.trim()}>
                <Text style={s.sheetBtnText}>{posting ? 'Posting…' : 'Post Anonymously'}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const PALETTE = ['#a78bfa', '#fb7185', '#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c'];
function WallPost({ p, onResonate }) {
  const color = p.is_mine ? PRIMARY : PALETTE[(p.id || 0) % PALETTE.length];
  return (
    <View style={s.post}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[s.avatar, { backgroundColor: color }]}>
          <Text style={s.avatarText}>{p.is_mine ? 'You' : '?'}</Text>
        </View>
        <Text style={s.postMeta}>{new Date(p.created_at).toLocaleString()}</Text>
        {p.is_hot && <Text style={s.hotBadge}>🔥 Hot</Text>}
      </View>
      <Text style={s.postContent}>{p.content}</Text>
      {p.related_capsule_title && (
        <Text style={s.postLink}>📎 {p.related_capsule_title}</Text>
      )}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        <TouchableOpacity onPress={onResonate} style={[s.resonateBtn, p.has_resonated && { backgroundColor: '#ddd6fe' }]}>
          <Text style={[s.resonateText, p.has_resonated && { color: VIOLET, fontWeight: '700' }]}>🤝 {p.resonance_count || 0}</Text>
        </TouchableOpacity>
        <View style={[s.statusPill, { backgroundColor: p.status === 'answered' ? '#dcfce7' : '#fef3c7' }]}>
          <Text style={[s.statusPillText, { color: p.status === 'answered' ? '#166534' : '#b45309' }]}>{p.status}</Text>
        </View>
      </View>
      {p.ai_answer && (
        <View style={s.answerBlock}>
          <Text style={s.answerLabel}>🤖 AI Suggestion</Text>
          <Text style={s.answerText}>{p.ai_answer}</Text>
        </View>
      )}
      {p.teacher_answer && (
        <View style={[s.answerBlock, { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }]}>
          <Text style={[s.answerLabel, { color: '#166534' }]}>👩‍🏫 Teacher's Answer</Text>
          <Text style={s.answerText}>{p.teacher_answer}</Text>
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════
function Center({ children }) { return <View style={s.center}>{children}</View>; }
function Empty({ text }) { return <Text style={s.empty}>{text}</Text>; }
function Tag({ bg, fg, text }) {
  return <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginRight: 6 }}>
    <Text style={{ color: fg, fontSize: 11, fontWeight: '600' }}>{text}</Text>
  </View>;
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  empty:  { textAlign: 'center', color: '#94a3b8', padding: 24 },
  h1:     { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  sub:    { fontSize: 12, color: '#64748b', marginTop: 2 },
  card:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  cardSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  attBadge: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  subjectHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  subjectHeaderTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#0f172a' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '700' },
  wallBtn: { backgroundColor: VIOLET, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  wallBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  capsuleCard: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 10 },
  capsuleTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  accessBanner: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginTop: 8, alignSelf: 'flex-start' },
  accessBannerText: { fontSize: 11, fontWeight: '700' },
  bullet: { fontSize: 13, color: '#475569', marginTop: 4 },
  interactionRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  section: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 6 },
  muted: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  playBtn: { backgroundColor: VIOLET, paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 6 },
  playBtnText: { color: '#fff', fontWeight: '700' },
  docBtn: { backgroundColor: PRIMARY, paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 6 },
  docBtnText: { color: '#fff', fontWeight: '700' },
  textarea: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 10, minHeight: 80, textAlignVertical: 'top', backgroundColor: '#f8fafc', color: '#0f172a' },
  postBtn: { backgroundColor: VIOLET, paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  postBtnText: { color: '#fff', fontWeight: '700' },
  optBtn: { borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', padding: 12, borderRadius: 10 },
  optText: { fontSize: 14, color: '#0f172a' },
  bigScore: { fontSize: 38, fontWeight: '900', textAlign: 'center', marginVertical: 8 },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: VIOLET, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  fabText: { fontSize: 30, color: '#fff', lineHeight: 32 },
  sheetBackdrop: { flex: 1, backgroundColor: '#0f172a55', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 18, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  sheetTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10 },
  sheetText: { fontSize: 14, color: '#0f172a', marginBottom: 6 },
  sheetReason: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  sheetBtn: { backgroundColor: VIOLET, paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  sheetBtnText: { color: '#fff', fontWeight: '700' },
  post: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  postMeta: { fontSize: 11, color: '#94a3b8', flex: 1 },
  hotBadge: { fontSize: 11, fontWeight: '700', color: '#ea580c' },
  postContent: { fontSize: 14, color: '#0f172a', marginTop: 8 },
  postLink: { fontSize: 12, color: VIOLET, marginTop: 4 },
  resonateBtn: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  resonateText: { fontSize: 12, color: '#475569' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  answerBlock: { backgroundColor: '#f1f5f9', padding: 10, borderRadius: 8, marginTop: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  answerLabel: { fontSize: 11, fontWeight: '800', color: '#475569', marginBottom: 4 },
  answerText: { fontSize: 13, color: '#0f172a' },
});

// Default export = home screen for convenience
export default ClassPulseHomeScreen;
