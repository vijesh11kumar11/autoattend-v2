/**
 * HOD — Send Department Alerts Screen
 * POST /api/alerts/hod/send-custom { message }
 * GET  /api/alerts/hod/history
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Platform, RefreshControl, SafeAreaView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
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

export default function HODAlertsScreen() {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await client.get('/alerts/hod/history');
      setHistory(Array.isArray(data) ? data : (data?.alerts ?? data?.logs ?? []));
    } catch (err) { console.warn('[HODAlerts] fetch error:', err?.message); }
  }, []);

  useEffect(() => { fetchHistory().finally(() => setLoading(false)); }, [fetchHistory]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchHistory(); setRefreshing(false); }, [fetchHistory]);

  const send = () => {
    const msg = message.trim();
    if (!msg) return;
    Alert.alert('Send Alert', `Send to all students/teachers in your department?\n\n"${msg}"`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        setSending(true);
        try {
          await client.post('/alerts/hod/send-custom', { message: msg });
          Alert.alert('Sent', 'Alert delivered to your department.');
          setMessage('');
          await fetchHistory();
        } catch (err) {
          Alert.alert('Error', err?.response?.data?.detail ?? 'Failed to send alert.');
        } finally { setSending(false); }
      }},
    ]);
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
              <Text style={styles.heading}>📣 Department Alerts</Text>
              <View style={styles.sendCard}>
                <Text style={styles.label}>Send Department Alert</Text>
                <TextInput
                  style={styles.textarea}
                  placeholder="Type your message…"
                  placeholderTextColor="#94a3b8"
                  value={message}
                  onChangeText={t => setMessage(t.slice(0, MAX_LEN))}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                <View style={styles.sendRow}>
                  <Text style={styles.counter}>{message.length}/{MAX_LEN}</Text>
                  <TouchableOpacity
                    style={[styles.sendBtn, !message.trim() && styles.disabled]}
                    onPress={send}
                    disabled={sending || !message.trim()}>
                    {sending
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <><Ionicons name="send" size={14} color="#fff" /><Text style={styles.sendTxt}> Send</Text></>}
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.section}>Alert History</Text>
              {loading && <ActivityIndicator size="small" color={PRIMARY} />}
            </View>
          }
          ListEmptyComponent={!loading && (
            <View style={styles.empty}>
              <Ionicons name="megaphone-outline" size={40} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>No alerts sent yet.</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.histCard}>
              <Ionicons name="megaphone-outline" size={16} color={PRIMARY} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.histMsg} numberOfLines={3}>{item.message ?? item.content ?? '(empty)'}</Text>
                <Text style={styles.histMeta}>{timeAgo(item.created_at ?? item.sent_at ?? item.timestamp)} · {item.recipient_count ?? item.recipients ?? ''}</Text>
              </View>
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
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY, marginBottom: 16 },
  sendCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  label: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 8 },
  textarea: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 14, color: '#1e293b', minHeight: 80, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8 },
  sendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  counter: { fontSize: 11, color: '#94a3b8' },
  sendBtn: { backgroundColor: PRIMARY, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center' },
  disabled: { opacity: 0.5 },
  sendTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  section: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  histCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderColor: '#e2e8f0' },
  histMsg: { fontSize: 13, color: '#1e293b' },
  histMeta: { fontSize: 10, color: '#94a3b8', marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 30 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
