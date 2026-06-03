/**
 * Teacher — Live Session Dashboard (T7 — full UX)
 *
 *   GET   /api/live/sessions/{id}/details         (poll 10s)
 *   POST  /api/live/sessions/{id}/end
 *   GET   /api/live/sessions/{id}/doubts
 *   POST  /api/live/sessions/{id}/pulse/create
 *   POST  /api/live/sessions/{id}/ai/generate-whiteboard
 *   POST  /api/live/sessions/{id}/breakout/create  / end-all
 *   GET   /api/live/sessions/{id}/breakout/status
 *   GET   /api/live/sessions/{id}/engagement-timeline
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const POLL_MS = 10_000;
const TABS = ['Overview', 'Doubts', 'Pulse', 'Brain', 'Breakout'];

export default function LiveSessionDashboardScreen({ route, navigation }) {
  const { session_id } = route.params || {};
  const [tab, setTab] = useState('Overview');
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
    } catch (err) {
      console.warn('[LiveDashboard] fetch error:', err?.message);
    }
  }, [session_id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    timerRef.current = setInterval(fetchData, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const endSession = () => {
    Alert.alert('End Live Session', 'End this session? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: async () => {
          setEnding(true);
          clearInterval(timerRef.current);
          try {
            await client.post(`/live/sessions/${session_id}/end`);
            Alert.alert('Ended', 'Session ended.', [
              { text: 'OK', onPress: () => navigation.goBack() },
            ]);
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to end session.');
          } finally {
            setEnding(false);
          }
        },
      },
    ]);
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  if (!data)
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Could not load session.</Text>
      </View>
    );

  const isLive = data.status === 'active' || data.status === 'live' || data.is_active;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.statusCard, { backgroundColor: isLive ? '#dcfce7' : '#fee2e2' }]}>
        <Ionicons
          name={isLive ? 'radio-outline' : 'stop-circle-outline'}
          size={24}
          color={isLive ? '#15803d' : '#b91c1c'}
        />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.statusTxt, { color: isLive ? '#15803d' : '#b91c1c' }]}>
            {isLive ? '🔴 LIVE' : 'Ended'}
          </Text>
          <Text style={styles.statusSub} numberOfLines={1}>
            {data.subject_name ?? data.title ?? '—'}
          </Text>
        </View>
        {isLive && (
          <TouchableOpacity style={styles.endBtn} onPress={endSession} disabled={ending}>
            {ending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.endTxt}>End</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabStrip}
        contentContainerStyle={{ paddingHorizontal: 12 }}
      >
        {TABS.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === 'Overview' && (
        <OverviewTab
          data={data}
          refreshing={refreshing}
          onRefresh={onRefresh}
          session_id={session_id}
          navigation={navigation}
        />
      )}
      {tab === 'Doubts' && <DoubtsTab session_id={session_id} />}
      {tab === 'Pulse' && (
        <PulseTab session_id={session_id} pulses={data.pulse_checks ?? []} isLive={isLive} />
      )}
      {tab === 'Brain' && <BrainTab session_id={session_id} isLive={isLive} />}
      {tab === 'Breakout' && (
        <BreakoutTab
          session_id={session_id}
          isLive={isLive}
          participants={data.participants ?? []}
        />
      )}
    </SafeAreaView>
  );
}

/* ─────────────── Overview ─────────────── */
function OverviewTab({ data, refreshing, onRefresh, session_id, navigation }) {
  const participants = data.participants ?? [];
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
      }
    >
      <View style={styles.statsRow}>
        <Stat icon="people-outline" v={participants.length} l="Joined" />
        <Stat icon="hand-right-outline" v={data.doubt_count ?? data.doubts_count ?? 0} l="Doubts" />
        <Stat
          icon="pulse-outline"
          v={data.pulse_count ?? data.pulse_checks?.length ?? 0}
          l="Pulses"
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('PreClassBrief', { session_id })}
        >
          <Ionicons name="book-outline" size={16} color={PRIMARY} />
          <Text style={styles.actionTxt}>Pre-Class Brief</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('SessionHealthReport', { session_id })}
        >
          <Ionicons name="pulse-outline" size={16} color={PRIMARY} />
          <Text style={styles.actionTxt}>Health Report</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Participants ({participants.length})</Text>
      {participants.length === 0 ? (
        <Text style={styles.empty}>No participants yet.</Text>
      ) : (
        participants.slice(0, 80).map((p, i) => (
          <View key={p.id ?? i} style={styles.pRow}>
            <Ionicons name="person-circle-outline" size={20} color="#94a3b8" />
            <Text style={styles.pName}>{p.name ?? p.student_name ?? `User ${p.id}`}</Text>
            <View
              style={[styles.pStatus, { backgroundColor: p.is_active ? '#dcfce7' : '#f1f5f9' }]}
            >
              <Text
                style={{
                  fontSize: 10,
                  color: p.is_active ? '#15803d' : '#64748b',
                  fontWeight: '700',
                }}
              >
                {p.is_active ? 'Active' : 'Idle'}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

/* ─────────────── Doubts ─────────────── */
function DoubtsTab({ session_id }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(null);
  const [answerText, setAnswerText] = useState('');

  const fetchList = useCallback(async () => {
    try {
      const { data } = await client.get(`/live/sessions/${session_id}/doubts`);
      setList(data?.doubts ?? data ?? []);
    } catch (err) {
      console.warn('[Doubts] error:', err?.message);
    }
  }, [session_id]);

  useEffect(() => {
    fetchList().finally(() => setLoading(false));
    const t = setInterval(fetchList, 15000);
    return () => clearInterval(t);
  }, [fetchList]);

  const submitAnswer = async () => {
    if (!answering || !answerText.trim()) return;
    try {
      await client.post(`/live/sessions/${session_id}/ai/teacher-response`, {
        post_id: answering.id,
        response: answerText.trim(),
      });
      Alert.alert('Posted', 'Answer broadcast to class.');
      setAnswering(null);
      setAnswerText('');
      fetchList();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not post answer.');
    }
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={PRIMARY} />
      </View>
    );

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.section}>Class Wall ({list.length})</Text>
      {list.length === 0 ? (
        <Text style={styles.empty}>No doubts yet.</Text>
      ) : (
        list.map((d) => (
          <View key={d.id} style={styles.doubt}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={styles.doubtAuthor}>{d.author_name ?? 'Anonymous'}</Text>
              {d.is_hot && <Text style={styles.hot}>🔥 HOT</Text>}
              <View style={{ flex: 1 }} />
              <View
                style={[
                  styles.statusPill,
                  d.status === 'answered'
                    ? { backgroundColor: '#dcfce7' }
                    : { backgroundColor: '#fef3c7' },
                ]}
              >
                <Text
                  style={[
                    styles.statusPillTxt,
                    d.status === 'answered' ? { color: '#15803d' } : { color: '#92400e' },
                  ]}
                >
                  {d.status}
                </Text>
              </View>
            </View>
            <Text style={styles.doubtQ}>{d.content}</Text>
            {d.ai_suggested_answer ? (
              <View style={styles.aiBox}>
                <Text style={styles.aiLabel}>🤖 AI ({((d.ai_confidence ?? 0) * 100) | 0}%)</Text>
                <Text style={styles.aiTxt}>{d.ai_suggested_answer}</Text>
              </View>
            ) : null}
            {d.teacher_answer ? (
              <View style={styles.tBox}>
                <Text style={styles.aiLabel}>You answered</Text>
                <Text style={styles.aiTxt}>{d.teacher_answer}</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.ansBtn} onPress={() => setAnswering(d)}>
                <Ionicons name="arrow-undo-outline" size={14} color="#fff" />
                <Text style={styles.ansBtnTxt}>Answer</Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}

      <Modal
        visible={!!answering}
        animationType="slide"
        transparent
        onRequestClose={() => setAnswering(null)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Answer Doubt</Text>
            <Text style={styles.doubtQ}>{answering?.content}</Text>
            <TextInput
              style={styles.input}
              value={answerText}
              onChangeText={setAnswerText}
              placeholder="Your answer…"
              placeholderTextColor="#94a3b8"
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#f1f5f9' }]}
                onPress={() => {
                  setAnswering(null);
                  setAnswerText('');
                }}
              >
                <Text style={[styles.btnTxt, { color: '#475569' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: PRIMARY }]}
                onPress={submitAnswer}
              >
                <Text style={styles.btnTxt}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/* ─────────────── Pulse ─────────────── */
function PulseTab({ session_id, pulses, isLive }) {
  const [showCreate, setShowCreate] = useState(false);
  const [autoGen, setAutoGen] = useState(true);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState({ A: '', B: '', C: '', D: '' });
  const [correct, setCorrect] = useState('A');
  const [duration, setDuration] = useState('30');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const body = autoGen
        ? {
            trigger_type: 'manual',
            auto_generate: true,
            duration_seconds: parseInt(duration, 10) || 30,
          }
        : {
            trigger_type: 'manual',
            auto_generate: false,
            question_text: q.trim(),
            option_a: opts.A.trim(),
            option_b: opts.B.trim(),
            option_c: opts.C.trim(),
            option_d: opts.D.trim(),
            correct_answer: correct,
            duration_seconds: parseInt(duration, 10) || 30,
          };
      await client.post(`/live/sessions/${session_id}/pulse/create`, body);
      Alert.alert('Created', 'Pulse check launched.');
      setShowCreate(false);
      setQ('');
      setOpts({ A: '', B: '', C: '', D: '' });
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not create.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.section}>Pulse Checks ({pulses.length})</Text>
        {isLive && (
          <TouchableOpacity style={styles.smallBtn} onPress={() => setShowCreate(true)}>
            <Ionicons name="add-circle-outline" size={14} color="#fff" />
            <Text style={styles.smallBtnTxt}>New</Text>
          </TouchableOpacity>
        )}
      </View>

      {pulses.length === 0 ? (
        <Text style={styles.empty}>No pulses yet.</Text>
      ) : (
        pulses.map((p) => (
          <View key={p.id} style={styles.pulseCard}>
            <Text style={styles.pulseQ}>{p.question ?? p.question_text}</Text>
            <Text style={styles.pulseMeta}>
              {p.response_count ?? 0} responses · {p.closed_at ? 'Closed' : 'Active'}
              {p.correct_answer ? ` · Correct: ${p.correct_answer}` : ''}
            </Text>
            {p.response_distribution && (
              <View style={styles.distRow}>
                {['A', 'B', 'C', 'D'].map((k) => (
                  <View key={k} style={styles.distItem}>
                    <Text style={styles.distKey}>{k}</Text>
                    <Text style={styles.distVal}>{p.response_distribution[k] ?? 0}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))
      )}

      <Modal
        visible={showCreate}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCreate(false)}
      >
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { maxHeight: '90%' }]}>
            <ScrollView>
              <Text style={styles.modalTitle}>Create Pulse Check</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.toggle, autoGen && styles.toggleOn]}
                  onPress={() => setAutoGen(true)}
                >
                  <Text style={[styles.toggleTxt, autoGen && styles.toggleTxtOn]}>🤖 AI Auto</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggle, !autoGen && styles.toggleOn]}
                  onPress={() => setAutoGen(false)}
                >
                  <Text style={[styles.toggleTxt, !autoGen && styles.toggleTxtOn]}>✏️ Manual</Text>
                </TouchableOpacity>
              </View>

              {!autoGen && (
                <>
                  <Text style={styles.label}>Question</Text>
                  <TextInput
                    style={styles.input}
                    value={q}
                    onChangeText={setQ}
                    multiline
                    placeholder="Question…"
                    placeholderTextColor="#94a3b8"
                  />
                  {['A', 'B', 'C', 'D'].map((k) => (
                    <View key={k}>
                      <Text style={styles.label}>Option {k}</Text>
                      <TextInput
                        style={styles.input}
                        value={opts[k]}
                        onChangeText={(t) => setOpts((p) => ({ ...p, [k]: t }))}
                        placeholder={`Option ${k}`}
                        placeholderTextColor="#94a3b8"
                      />
                    </View>
                  ))}
                  <Text style={styles.label}>Correct Answer</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {['A', 'B', 'C', 'D'].map((k) => (
                      <TouchableOpacity
                        key={k}
                        style={[styles.toggle, correct === k && styles.toggleOn]}
                        onPress={() => setCorrect(k)}
                      >
                        <Text style={[styles.toggleTxt, correct === k && styles.toggleTxtOn]}>
                          {k}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.label}>Duration (seconds)</Text>
              <TextInput
                style={styles.input}
                value={duration}
                onChangeText={setDuration}
                keyboardType="number-pad"
              />

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: '#f1f5f9' }]}
                  onPress={() => setShowCreate(false)}
                >
                  <Text style={[styles.btnTxt, { color: '#475569' }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: PRIMARY }, busy && { opacity: 0.6 }]}
                  onPress={create}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnTxt}>Launch</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/* ─────────────── Brain (Whiteboard AI) ─────────────── */
function BrainTab({ session_id, isLive }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const { data } = await client.post(`/live/sessions/${session_id}/ai/generate-whiteboard`, {
        prompt: prompt.trim(),
        context: '',
      });
      setResult(data);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not generate.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.section}>🧠 AI Whiteboard Generator</Text>
      <Text style={styles.sub2}>
        Describe a concept; AI returns a structured explanation to project on the class wall.
      </Text>
      <TextInput
        style={[styles.input, { minHeight: 80 }]}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="e.g. Explain TCP handshake with diagram steps"
        placeholderTextColor="#94a3b8"
        multiline
        editable={isLive}
      />
      <TouchableOpacity
        style={[styles.bigBtn, (!isLive || busy) && { opacity: 0.5 }]}
        onPress={generate}
        disabled={!isLive || busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="sparkles-outline" size={16} color="#fff" />
            <Text style={styles.bigBtnTxt}>Generate & Broadcast</Text>
          </>
        )}
      </TouchableOpacity>
      {result && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Generated</Text>
          <Text selectable style={styles.resultBody}>
            {typeof result === 'string'
              ? result
              : (result.content ?? result.text ?? JSON.stringify(result, null, 2))}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

/* ─────────────── Breakout ─────────────── */
function BreakoutTab({ session_id, isLive, participants }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [numRooms, setNumRooms] = useState('2');

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await client.get(`/live/sessions/${session_id}/breakout/status`);
      setStatus(data);
    } catch (err) {
      /* ignore */
    }
  }, [session_id]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const createRooms = async () => {
    const n = Math.max(1, Math.min(6, parseInt(numRooms, 10) || 2));
    if (!participants.length) return Alert.alert('Empty', 'No participants to assign.');
    const ids = participants.map((p) => p.user_id ?? p.student_id ?? p.id).filter(Boolean);
    const perRoom = Math.ceil(ids.length / n);
    const rooms = Array.from({ length: n }, (_, i) => ({
      name: `Room ${i + 1}`,
      student_ids: ids.slice(i * perRoom, (i + 1) * perRoom),
    }));
    setBusy(true);
    try {
      await client.post(`/live/sessions/${session_id}/breakout/create`, { rooms });
      Alert.alert('Done', `${n} rooms created.`);
      fetchStatus();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed.');
    } finally {
      setBusy(false);
    }
  };

  const endAll = async () => {
    Alert.alert('End Rooms', 'End all breakout rooms?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: async () => {
          try {
            await client.post(`/live/sessions/${session_id}/breakout/end-all`);
            Alert.alert('Done', 'All rooms closed.');
            fetchStatus();
          } catch (err) {
            Alert.alert('Error', 'Failed.');
          }
        },
      },
    ]);
  };

  const activeRooms = status?.rooms?.filter((r) => !r.ended_at) ?? [];

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.section}>🚪 Breakout Rooms</Text>

      {activeRooms.length === 0 ? (
        <>
          <Text style={styles.label}>Number of Rooms (auto-distribute participants)</Text>
          <TextInput
            style={styles.input}
            value={numRooms}
            onChangeText={setNumRooms}
            keyboardType="number-pad"
          />
          <TouchableOpacity
            style={[styles.bigBtn, (!isLive || busy) && { opacity: 0.5 }]}
            onPress={createRooms}
            disabled={!isLive || busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="people-outline" size={16} color="#fff" />
                <Text style={styles.bigBtnTxt}>Create Rooms</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          {activeRooms.map((r) => (
            <View key={r.id} style={styles.roomCard}>
              <Text style={styles.roomName}>{r.room_name}</Text>
              <Text style={styles.pulseMeta}>{(r.participant_ids ?? []).length} members</Text>
            </View>
          ))}
          <TouchableOpacity
            style={[styles.bigBtn, { backgroundColor: '#ef4444' }]}
            onPress={endAll}
          >
            <Ionicons name="stop-circle-outline" size={16} color="#fff" />
            <Text style={styles.bigBtnTxt}>End All Rooms</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

/* ─────────────── Shared ─────────────── */
function Stat({ icon, v, l }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={20} color={PRIMARY} />
      <Text style={styles.statV}>{v}</Text>
      <Text style={styles.statL}>{l}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { color: '#ef4444' },
  statusCard: { padding: 14, flexDirection: 'row', alignItems: 'center' },
  statusTxt: { fontSize: 16, fontWeight: '800' },
  statusSub: { fontSize: 12, color: '#475569', marginTop: 2 },
  endBtn: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  endTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  tabStrip: {
    maxHeight: 50,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: { paddingHorizontal: 16, paddingVertical: 14, marginRight: 4 },
  tabActive: { borderBottomWidth: 3, borderBottomColor: PRIMARY },
  tabTxt: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  tabTxtActive: { color: PRIMARY },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stat: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statV: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  statL: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  actionTxt: { fontSize: 12, color: PRIMARY, fontWeight: '700' },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  sub2: { fontSize: 12, color: '#94a3b8', marginBottom: 10 },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
  },
  pRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pName: { flex: 1, fontSize: 13, color: '#1e293b', fontWeight: '600' },
  pStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  doubt: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  doubtAuthor: { fontSize: 11, color: '#64748b', fontWeight: '700' },
  hot: { fontSize: 10, color: '#ef4444', fontWeight: '800', marginLeft: 6 },
  doubtQ: { fontSize: 13, color: '#1e293b', lineHeight: 18 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusPillTxt: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  aiBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  tBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#f0fdf4',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#22c55e',
  },
  aiLabel: { fontSize: 10, fontWeight: '800', color: '#475569', marginBottom: 2 },
  aiTxt: { fontSize: 12, color: '#1e293b', lineHeight: 17 },
  ansBtn: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    backgroundColor: PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 8,
    gap: 4,
  },
  ansBtnTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  smallBtn: {
    flexDirection: 'row',
    backgroundColor: PRIMARY,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    gap: 4,
  },
  smallBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 11 },
  pulseCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pulseQ: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  pulseMeta: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  distRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  distItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 6,
    borderRadius: 6,
  },
  distKey: { fontSize: 10, color: '#94a3b8', fontWeight: '700' },
  distVal: { fontSize: 14, fontWeight: '900', color: PRIMARY },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: PRIMARY, marginBottom: 10 },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  toggle: {
    flex: 1,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  toggleTxt: { fontSize: 12, color: '#475569', fontWeight: '700' },
  toggleTxtOn: { color: '#fff' },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  bigBtn: {
    flexDirection: 'row',
    backgroundColor: PRIMARY,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  bigBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  resultTitle: { fontSize: 13, fontWeight: '700', color: PRIMARY, marginBottom: 8 },
  resultBody: { fontSize: 12, color: '#1e293b', lineHeight: 18 },
  roomCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  roomName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
});
