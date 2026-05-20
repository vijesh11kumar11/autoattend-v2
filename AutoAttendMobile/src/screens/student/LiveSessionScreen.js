/**
 * Student — Live Session Screen (S7 — full UX)
 * ------------------------------------------------
 * Tabs: Overview · Doubts · Pulse · Warmup · Low-BW
 *
 *   GET   /api/live/sessions/{id}/details              (poll 10s)
 *   GET   /api/live/sessions/{id}/doubts               list
 *   POST  /api/live/sessions/{id}/doubts               { question_text }
 *   POST  /api/live/sessions/{id}/pulse/{pid}/respond  { answer: 'A|B|C|D' }
 *   GET   /api/live/sessions/{id}/pulse/{pid}/results
 *   GET   /api/live/sessions/{id}/my-warmup
 *   GET   /api/live/sessions/{id}/live-text-summary    (low-bandwidth mode)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const POLL_MS = 10_000;
const TABS = ['Overview', 'Doubts', 'Pulse', 'Warmup', 'Low-BW'];

export default function LiveSessionScreen({ route }) {
  const { session_id } = route.params || {};
  const [tab, setTab]           = useState('Overview');
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
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

  const isLive = data.status === 'active' || data.status === 'live' || data.is_active;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      {/* Status banner */}
      <View style={[styles.statusCard, { backgroundColor: isLive ? '#dcfce7' : '#fee2e2' }]}>
        <Ionicons name={isLive ? 'radio-outline' : 'stop-circle-outline'} size={24} color={isLive ? '#15803d' : '#b91c1c'} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.statusTxt, { color: isLive ? '#15803d' : '#b91c1c' }]}>
            {isLive ? '🔴 LIVE' : 'Ended'}
          </Text>
          <Text style={styles.statusSub} numberOfLines={1}>{data.subject_name ?? data.subject ?? data.title ?? ''}</Text>
        </View>
      </View>

      {/* Tab strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabStrip}
        contentContainerStyle={{ paddingHorizontal: 12 }}>
        {TABS.map(t => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === 'Overview' && <OverviewTab data={data} refreshing={refreshing} onRefresh={onRefresh} />}
      {tab === 'Doubts'   && <DoubtsTab session_id={session_id} isLive={isLive} />}
      {tab === 'Pulse'    && <PulseTab session_id={session_id} pulses={data.pulse_checks ?? []} />}
      {tab === 'Warmup'   && <WarmupTab session_id={session_id} />}
      {tab === 'Low-BW'   && <LowBwTab session_id={session_id} />}
    </SafeAreaView>
  );
}

/* ──────────────────────── Overview ──────────────────────── */
function OverviewTab({ data, refreshing, onRefresh }) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
      <Text style={styles.section}>Session Info</Text>
      <View style={styles.infoCard}>
        <InfoRow icon="person-outline" label="Teacher" value={data.teacher_name ?? data.host_name ?? '—'} />
        <InfoRow icon="time-outline" label="Started" value={(data.started_at ?? '').replace('T', ' ').slice(0, 16) || '—'} />
        <InfoRow icon="people-outline" label="Joined" value={data.participant_count ?? data.participants?.length ?? 0} />
        {data.topic ? <InfoRow icon="bookmark-outline" label="Topic" value={data.topic} /> : null}
        {data.title ? <InfoRow icon="text-outline" label="Title" value={data.title} /> : null}
      </View>
      <Text style={styles.hint}>Auto-refreshes every 10 seconds.</Text>
    </ScrollView>
  );
}

/* ──────────────────────── Doubts ──────────────────────── */
function DoubtsTab({ session_id, isLive }) {
  const [list, setList]     = useState([]);
  const [text, setText]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchList = useCallback(async () => {
    try {
      const { data } = await client.get(`/live/sessions/${session_id}/doubts`);
      setList(data?.doubts ?? data ?? []);
    } catch (err) { console.warn('[Doubts] fetch error:', err?.message); }
  }, [session_id]);

  useEffect(() => { fetchList().finally(() => setLoading(false)); }, [fetchList]);

  const submit = async () => {
    const t = text.trim();
    if (t.length < 3) return Alert.alert('Required', 'Type at least 3 characters.');
    if (!isLive) return Alert.alert('Closed', 'Session is no longer live.');
    setBusy(true);
    try {
      const { data } = await client.post(`/live/sessions/${session_id}/doubts`, { question_text: t });
      setText('');
      if (data?.ai_suggestion) {
        Alert.alert('Doubt Posted', `AI suggestion (confidence ${(data.confidence * 100 | 0)}%):\n\n${data.ai_suggestion}`);
      } else {
        Alert.alert('Posted', 'Your doubt was added to the wall.');
      }
      fetchList();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not post doubt.');
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Ask a Doubt</Text>
        <View style={styles.composer}>
          <TextInput style={styles.composerInput} value={text} onChangeText={setText}
            placeholder="Posted anonymously to the class wall…" placeholderTextColor="#94a3b8" multiline maxLength={1000} />
          <TouchableOpacity style={[styles.composerBtn, (busy || !isLive) && { opacity: 0.5 }]}
            onPress={submit} disabled={busy || !isLive}>
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        <Text style={[styles.section, { marginTop: 18 }]}>Class Wall ({list.length})</Text>
        {loading ? <ActivityIndicator color={PRIMARY} style={{ marginTop: 14 }} /> :
          list.length === 0 ? <Text style={styles.empty}>No doubts yet — be the first to ask.</Text> :
          list.map(d => (
            <View key={d.id} style={styles.doubt}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Ionicons name="help-circle-outline" size={16} color={PRIMARY} />
                <Text style={styles.doubtMeta}>
                  {d.is_hot ? '🔥 Hot · ' : ''}{d.resonance_count ?? 0} similar
                </Text>
                <View style={{ flex: 1 }} />
                <View style={[styles.statusPill,
                  d.status === 'answered' ? { backgroundColor: '#dcfce7' } : { backgroundColor: '#fef3c7' }]}>
                  <Text style={[styles.statusPillTxt,
                    d.status === 'answered' ? { color: '#15803d' } : { color: '#92400e' }]}>
                    {d.status ?? 'open'}
                  </Text>
                </View>
              </View>
              <Text style={styles.doubtQ}>{d.content}</Text>
              {d.teacher_answer ? (
                <View style={styles.ans}><Text style={styles.ansLabel}>Teacher:</Text><Text style={styles.ansTxt}>{d.teacher_answer}</Text></View>
              ) : d.ai_suggested_answer ? (
                <View style={styles.aiAns}><Text style={styles.ansLabel}>AI ({((d.ai_confidence ?? 0) * 100 | 0)}%):</Text><Text style={styles.ansTxt}>{d.ai_suggested_answer}</Text></View>
              ) : null}
            </View>
          ))
        }
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ──────────────────────── Pulse ──────────────────────── */
function PulseTab({ session_id, pulses }) {
  const open = useMemo(() => pulses.filter(p => !p.closed_at && p.is_active !== false), [pulses]);
  const [answered, setAnswered] = useState({});
  const [busy, setBusy]         = useState(null);

  const respond = async (pulse_id, answer) => {
    setBusy(pulse_id);
    try {
      await client.post(`/live/sessions/${session_id}/pulse/${pulse_id}/respond`, { answer });
      setAnswered(prev => ({ ...prev, [pulse_id]: answer }));
      Alert.alert('Submitted', `Your answer (${answer}) was recorded.`);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not submit answer.');
    } finally { setBusy(null); }
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.section}>Active Pulse Checks ({open.length})</Text>
      {open.length === 0 ? <Text style={styles.empty}>No pulse checks right now.</Text> :
        open.map(p => {
          const opts = p.options ?? { A: p.option_a, B: p.option_b, C: p.option_c, D: p.option_d };
          const my = answered[p.id];
          return (
            <View key={p.id} style={styles.pulseCard}>
              <Text style={styles.pulseQ}>{p.question ?? p.question_text}</Text>
              {['A', 'B', 'C', 'D'].map(k => {
                if (!opts[k]) return null;
                const sel = my === k;
                return (
                  <TouchableOpacity key={k}
                    style={[styles.optBtn, sel && styles.optBtnActive, busy === p.id && { opacity: 0.6 }]}
                    onPress={() => !my && respond(p.id, k)} disabled={!!my || busy === p.id}>
                    <Text style={[styles.optKey, sel && { color: '#fff' }]}>{k}</Text>
                    <Text style={[styles.optTxt, sel && { color: '#fff' }]}>{opts[k]}</Text>
                  </TouchableOpacity>
                );
              })}
              {my && <Text style={styles.pulseDone}>✓ Submitted</Text>}
            </View>
          );
        })}

      {pulses.filter(p => p.closed_at).length > 0 && (
        <>
          <Text style={[styles.section, { marginTop: 16 }]}>Closed</Text>
          {pulses.filter(p => p.closed_at).map(p => (
            <View key={p.id} style={[styles.pulseCard, { opacity: 0.7 }]}>
              <Text style={styles.pulseQ}>{p.question ?? p.question_text}</Text>
              <Text style={styles.pulseMeta}>{p.response_count ?? 0} responses</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

/* ──────────────────────── Warmup ──────────────────────── */
function WarmupTab({ session_id }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await client.get(`/live/sessions/${session_id}/my-warmup`);
        setData(data);
      } catch (err) {
        if (err?.response?.status !== 404) console.warn('[Warmup] error:', err?.message);
      } finally { setLoading(false); }
    })();
  }, [session_id]);
  if (loading) return <View style={styles.center}><ActivityIndicator color={PRIMARY} /></View>;

  const questions = data?.questions ?? data?.warmup_questions ?? [];
  if (!questions.length && !data?.summary) {
    return (
      <View style={styles.empty2}>
        <Ionicons name="flame-outline" size={40} color="#cbd5e1" />
        <Text style={styles.emptyTxt}>No warm-up generated yet.</Text>
        <Text style={styles.emptySub}>Your teacher hasn't generated personalised questions for you.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.section}>🔥 Personalised Warm-up</Text>
      {data?.summary ? <Text style={styles.summary}>{data.summary}</Text> : null}
      {questions.map((q, i) => (
        <View key={i} style={styles.qCard}>
          <Text style={styles.qNum}>Q{i + 1}</Text>
          <Text style={styles.qText}>{typeof q === 'string' ? q : (q.question ?? q.text ?? JSON.stringify(q))}</Text>
          {q?.hint ? <Text style={styles.qHint}>💡 {q.hint}</Text> : null}
          {q?.answer ? <Text style={styles.qAns}>Answer: {q.answer}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

/* ──────────────────────── Low-BW ──────────────────────── */
function LowBwTab({ session_id }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await client.get(`/live/sessions/${session_id}/live-text-summary`);
      setText(data?.summary ?? data?.text ?? JSON.stringify(data));
    } catch (err) { console.warn('[LowBW] error:', err?.message); }
  }, [session_id]);

  useEffect(() => { fetchSummary().finally(() => setLoading(false)); }, [fetchSummary]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchSummary(); setRefreshing(false); }, [fetchSummary]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={PRIMARY} /></View>;
  return (
    <ScrollView contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
      <View style={styles.bwHeader}>
        <Ionicons name="cellular-outline" size={20} color={PRIMARY} />
        <Text style={styles.section}>Low-Bandwidth Mode</Text>
      </View>
      <Text style={styles.sub}>Text-only AI summary of the live session — friendly to slow networks.</Text>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTxt}>{text || 'No summary yet — try refreshing in a few seconds.'}</Text>
      </View>
    </ScrollView>
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
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  err: { fontSize: 14, color: '#ef4444' },
  statusCard: { borderRadius: 0, padding: 14, flexDirection: 'row', alignItems: 'center' },
  statusTxt: { fontSize: 16, fontWeight: '800' },
  statusSub: { fontSize: 12, color: '#475569', marginTop: 2 },
  tabStrip: { maxHeight: 50, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tab: { paddingHorizontal: 16, paddingVertical: 14, marginRight: 4 },
  tabActive: { borderBottomWidth: 3, borderBottomColor: PRIMARY },
  tabTxt: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  tabTxtActive: { color: PRIMARY },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  infoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  infoLabel: { fontSize: 12, color: '#94a3b8', width: 90 },
  infoVal: { fontSize: 13, color: '#1e293b', fontWeight: '600', flex: 1 },
  hint: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 24, fontStyle: 'italic' },
  empty: { fontSize: 12, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 16 },
  empty2: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyTxt: { fontSize: 14, color: '#64748b', fontWeight: '600', marginTop: 10 },
  emptySub: { fontSize: 11, color: '#94a3b8', marginTop: 4, textAlign: 'center' },
  composer: { backgroundColor: '#fff', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  composerInput: { flex: 1, fontSize: 13, color: '#1e293b', minHeight: 60, maxHeight: 120 },
  composerBtn: { backgroundColor: PRIMARY, borderRadius: 10, padding: 12 },
  doubt: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  doubtMeta: { fontSize: 11, color: '#64748b', marginLeft: 6, fontWeight: '600' },
  doubtQ: { fontSize: 13, color: '#1e293b', fontWeight: '500', lineHeight: 18 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusPillTxt: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  ans: { marginTop: 8, padding: 8, backgroundColor: '#f0fdf4', borderRadius: 6, borderLeftWidth: 3, borderLeftColor: '#22c55e' },
  aiAns: { marginTop: 8, padding: 8, backgroundColor: '#eff6ff', borderRadius: 6, borderLeftWidth: 3, borderLeftColor: '#3b82f6' },
  ansLabel: { fontSize: 10, fontWeight: '800', color: '#475569', marginBottom: 2 },
  ansTxt: { fontSize: 12, color: '#1e293b', lineHeight: 17 },
  pulseCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  pulseQ: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  pulseMeta: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  pulseDone: { fontSize: 12, color: '#22c55e', fontWeight: '700', marginTop: 6, textAlign: 'right' },
  optBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 10, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  optBtnActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  optKey: { fontSize: 12, fontWeight: '800', color: PRIMARY, width: 22 },
  optTxt: { flex: 1, fontSize: 13, color: '#1e293b' },
  qCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0', borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  qNum: { fontSize: 11, fontWeight: '800', color: '#f59e0b', marginBottom: 4 },
  qText: { fontSize: 13, color: '#1e293b', lineHeight: 18 },
  qHint: { fontSize: 11, color: '#64748b', marginTop: 6, fontStyle: 'italic' },
  qAns: { fontSize: 11, color: '#22c55e', marginTop: 6, fontWeight: '700' },
  summary: { fontSize: 12, color: '#475569', lineHeight: 18, marginBottom: 12 },
  bwHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', minHeight: 200 },
  summaryTxt: { fontSize: 13, color: '#1e293b', lineHeight: 19 },
});
