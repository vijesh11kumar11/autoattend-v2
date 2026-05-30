/**
 * Principal — Alerts Screen
 * Send college-wide alerts and view alert history.
 * API: POST /api/principal/send-alert  { message }
 *      GET  /api/principal/audit       (recent activity)
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
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

export default function PrincipalAlertsScreen() {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAudits = useCallback(async () => {
    try {
      const { data } = await client.get('/principal/audit');
      setAudits(data?.logs ?? data ?? []);
    } catch (err) {
      console.warn('[PrincipalAlertsScreen] fetch error:', err?.message);
    }
  }, []);

  useEffect(() => {
    fetchAudits().finally(() => setLoading(false));
  }, [fetchAudits]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAudits();
    setRefreshing(false);
  }, [fetchAudits]);

  const sendAlert = async () => {
    if (!message.trim()) return;
    Alert.alert('Send Alert', `Send this alert to the entire college?\n\n"${message.trim()}"`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        style: 'destructive',
        onPress: async () => {
          setSending(true);
          try {
            await client.post('/principal/send-alert', { message: message.trim() });
            Alert.alert('Success', 'Alert sent to all department HODs.');
            setMessage('');
            await fetchAudits();
          } catch (e) {
            Alert.alert('Error', e.response?.data?.detail || 'Failed to send alert.');
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={audits}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
          ListHeaderComponent={
            <View>
              <Text style={styles.heading}>🔔 Alerts</Text>

              {/* Send Alert Card */}
              <View style={styles.sendCard}>
                <Text style={styles.sendLabel}>Send College Alert</Text>
                <TextInput
                  style={styles.textarea}
                  placeholder="Type your alert message…"
                  placeholderTextColor="#94a3b8"
                  value={message}
                  onChangeText={(t) => setMessage(t.slice(0, MAX_LEN))}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                <View style={styles.sendRow}>
                  <Text style={styles.charCount}>
                    {message.length}/{MAX_LEN}
                  </Text>
                  <TouchableOpacity
                    style={[styles.sendBtn, !message.trim() && styles.sendBtnDisabled]}
                    onPress={sendAlert}
                    disabled={sending || !message.trim()}
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="send" size={16} color="#fff" />
                        <Text style={styles.sendBtnTxt}> Send</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.section}>Recent Activity</Text>
              {loading && <ActivityIndicator size="small" color={PRIMARY} />}
            </View>
          }
          ListEmptyComponent={
            !loading && (
              <View style={styles.empty}>
                <Ionicons name="time-outline" size={40} color="#cbd5e1" />
                <Text style={styles.emptyTxt}>No audit logs yet.</Text>
              </View>
            )
          }
          renderItem={({ item: log }) => (
            <View style={styles.logCard}>
              <Ionicons name="time-outline" size={16} color="#94a3b8" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.logAction}>{log.action ?? log.event ?? 'Activity'}</Text>
                <Text style={styles.logMeta}>
                  {log.performed_by ?? log.user ?? ''} · {timeAgo(log.created_at ?? log.timestamp)}
                </Text>
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
  sendCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sendLabel: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 8 },
  textarea: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#1e293b',
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
  },
  sendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  charCount: { fontSize: 11, color: '#94a3b8' },
  sendBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  section: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  logCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  logAction: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  logMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 30 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
