/**
 * Student — Suggestion Box Screen
 * POST /api/suggestions/submit { message, is_anonymous, category? }
 * GET  /api/suggestions/my-submissions
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Platform, RefreshControl, SafeAreaView, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const MAX_LEN = 500;

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SuggestionBoxScreen() {
  const [message, setMessage] = useState('');
  const [anon, setAnon] = useState(false);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await client.get('/suggestions/my-submissions');
      setHistory(Array.isArray(data) ? data : (data?.suggestions ?? data?.submissions ?? []));
    } catch (err) { console.warn('[Suggestions] fetch error:', err?.message); }
  }, []);

  useEffect(() => { fetchHistory().finally(() => setLoading(false)); }, [fetchHistory]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchHistory(); setRefreshing(false); }, [fetchHistory]);

  const submit = async () => {
    const msg = message.trim();
    if (!msg) return;
    setSending(true);
    try {
      await client.post('/suggestions/submit', { message: msg, is_anonymous: anon });
      Alert.alert('Submitted', anon ? 'Anonymous suggestion sent.' : 'Suggestion sent.');
      setMessage('');
      await fetchHistory();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to submit.');
    } finally { setSending(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={history}
          keyExtractor={(item, i) => String(item.id ?? i)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
          ListHeaderComponent={
            <View>
              <Text style={styles.heading}>💡 Suggestion Box</Text>
              <Text style={styles.sub}>Share feedback with your department.</Text>

              <View style={styles.card}>
                <TextInput
                  style={styles.textarea}
                  placeholder="Type your suggestion…"
                  placeholderTextColor="#94a3b8"
                  value={message}
                  onChangeText={t => setMessage(t.slice(0, MAX_LEN))}
                  multiline
                  textAlignVertical="top"
                />
                <View style={styles.toolbar}>
                  <View style={styles.anonRow}>
                    <Text style={styles.anonLabel}>Anonymous</Text>
                    <Switch value={anon} onValueChange={setAnon}
                      trackColor={{ false: '#cbd5e1', true: PRIMARY }} />
                  </View>
                  <Text style={styles.counter}>{message.length}/{MAX_LEN}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.submitBtn, !message.trim() && styles.disabled]}
                  onPress={submit}
                  disabled={sending || !message.trim()}>
                  {sending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Ionicons name="send" size={14} color="#fff" /><Text style={styles.submitTxt}> Submit</Text></>}
                </TouchableOpacity>
              </View>

              <Text style={styles.section}>My Submissions</Text>
              {loading && <ActivityIndicator size="small" color={PRIMARY} />}
            </View>
          }
          ListEmptyComponent={!loading && (
            <View style={styles.empty}>
              <Ionicons name="bulb-outline" size={40} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>No submissions yet.</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.histCard}>
              <View style={styles.histTop}>
                {item.is_anonymous
                  ? <View style={styles.anonChip}><Text style={styles.anonChipTxt}>ANON</Text></View>
                  : null}
                <Text style={styles.histTime}>{timeAgo(item.created_at ?? item.submitted_at)}</Text>
              </View>
              <Text style={styles.histMsg}>{item.message ?? item.content}</Text>
              {item.response ? (
                <View style={styles.responseBox}>
                  <Text style={styles.responseLabel}>Response:</Text>
                  <Text style={styles.responseTxt}>{item.response}</Text>
                </View>
              ) : null}
            </View>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  textarea: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 14, color: '#1e293b', minHeight: 100, borderWidth: 1, borderColor: '#e2e8f0' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  anonLabel: { fontSize: 12, color: '#475569', fontWeight: '600' },
  counter: { fontSize: 11, color: '#94a3b8' },
  submitBtn: { backgroundColor: PRIMARY, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  disabled: { opacity: 0.5 },
  submitTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  section: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  histCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  histTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  anonChip: { backgroundColor: '#fef3c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  anonChipTxt: { fontSize: 9, fontWeight: '800', color: '#b45309' },
  histTime: { fontSize: 10, color: '#94a3b8', marginLeft: 'auto' },
  histMsg: { fontSize: 13, color: '#1e293b' },
  responseBox: { marginTop: 8, padding: 10, backgroundColor: '#eef2ff', borderRadius: 8 },
  responseLabel: { fontSize: 10, fontWeight: '700', color: PRIMARY, marginBottom: 2 },
  responseTxt: { fontSize: 12, color: '#1e293b' },
  empty: { alignItems: 'center', paddingTop: 30 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
