/**
 * HOD — Department Alerts (H10)
 *  GET  /alerts/hod/defaulters/count
 *  POST /alerts/hod/send-bulk     { message }
 *  GET  /reports/hod/students     (picker)
 *  POST /alerts/hod/send-custom   { student_id, message }
 *  GET  /alerts/hod/history?limit
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
const MAX_LEN = 500;
const TABS = ['Bulk', 'Custom', 'History'];

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function HODAlertsScreen() {
  const [tab, setTab] = useState('Bulk');
  const [defCount, setDefCount] = useState(null);
  const [students, setStudents] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [bulkMsg, setBulkMsg] = useState('');
  const [sendingBulk, setSendingBulk] = useState(false);
  const [picked, setPicked] = useState(null);
  const [customMsg, setCustomMsg] = useState('');
  const [sendingCustom, setSendingCustom] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [c, s, h] = await Promise.allSettled([
        client.get('/alerts/hod/defaulters/count'),
        client.get('/reports/hod/students'),
        client.get('/alerts/hod/history', { params: { limit: 100 } }),
      ]);
      if (c.status === 'fulfilled') setDefCount(c.value.data?.count ?? c.value.data);
      if (s.status === 'fulfilled') setStudents(Array.isArray(s.value.data) ? s.value.data : []);
      if (h.status === 'fulfilled') {
        const d = h.value.data;
        setHistory(Array.isArray(d) ? d : (d?.alerts ?? d?.logs ?? []));
      }
    } catch (err) {
      console.warn('[HODAlerts]', err?.message);
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

  const sendBulk = () => {
    const msg = bulkMsg.trim();
    if (!msg) return Alert.alert('Validation', 'Message required.');
    Alert.alert('Confirm', `Send to ALL ${defCount ?? 'defaulter'} students?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          setSendingBulk(true);
          try {
            await client.post('/alerts/hod/send-bulk', { message: msg });
            Alert.alert('Sent', 'Bulk alert dispatched.');
            setBulkMsg('');
            fetchData();
          } catch (err) {
            Alert.alert('Error', err?.response?.data?.detail ?? 'Failed.');
          } finally {
            setSendingBulk(false);
          }
        },
      },
    ]);
  };

  const sendCustom = async () => {
    const msg = customMsg.trim();
    if (!picked) return Alert.alert('Validation', 'Pick a student.');
    if (!msg) return Alert.alert('Validation', 'Message required.');
    setSendingCustom(true);
    try {
      await client.post('/alerts/hod/send-custom', { student_id: picked.id, message: msg });
      Alert.alert('Sent', `Alert sent to ${picked.name}.`);
      setPicked(null);
      setCustomMsg('');
      fetchData();
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Failed.');
    } finally {
      setSendingCustom(false);
    }
  };

  const filteredStudents = useMemo(() => {
    if (!pickerSearch) return students;
    const q = pickerSearch.toLowerCase();
    return students.filter((s) => `${s.name} ${s.roll_number ?? ''}`.toLowerCase().includes(q));
  }, [students, pickerSearch]);

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.heading}>📢 Department Alerts</Text>
      <View style={styles.tabStrip}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
        >
          {tab === 'Bulk' && (
            <View style={styles.card}>
              <Text style={styles.label}>Defaulters in your department</Text>
              <Text style={styles.bigNum}>{defCount ?? '—'}</Text>
              <Text style={styles.label}>Message</Text>
              <TextInput
                style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]}
                value={bulkMsg}
                onChangeText={(t) => setBulkMsg(t.slice(0, MAX_LEN))}
                multiline
                placeholder="Will be sent to all defaulters"
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.cnt}>
                {bulkMsg.length}/{MAX_LEN}
              </Text>
              <TouchableOpacity
                style={[styles.bigBtn, sendingBulk && { opacity: 0.5 }]}
                onPress={sendBulk}
                disabled={sendingBulk}
              >
                {sendingBulk ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="megaphone-outline" size={16} color="#fff" />
                    <Text style={styles.bigBtnTxt}>Send Bulk Alert</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {tab === 'Custom' && (
            <View style={styles.card}>
              <Text style={styles.label}>Student</Text>
              <TouchableOpacity style={styles.input} onPress={() => setPickerOpen(true)}>
                <Text style={{ color: picked ? '#1e293b' : '#94a3b8' }}>
                  {picked ? `${picked.name} (${picked.roll_number ?? ''})` : 'Select a student…'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.label}>Message</Text>
              <TextInput
                style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]}
                value={customMsg}
                onChangeText={(t) => setCustomMsg(t.slice(0, MAX_LEN))}
                multiline
                placeholder="Personal message"
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.cnt}>
                {customMsg.length}/{MAX_LEN}
              </Text>

              <TouchableOpacity
                style={[styles.bigBtn, sendingCustom && { opacity: 0.5 }]}
                onPress={sendCustom}
                disabled={sendingCustom}
              >
                {sendingCustom ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="send-outline" size={16} color="#fff" />
                    <Text style={styles.bigBtnTxt}>Send Custom Alert</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {tab === 'History' && (
            <>
              <Text style={styles.cnt}>{history.length} entries</Text>
              {history.length === 0 ? (
                <Text style={styles.empty}>No history.</Text>
              ) : (
                history.map((a, i) => (
                  <View key={a.id ?? i} style={styles.histCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.histType}>{a.alert_type ?? a.type ?? 'Alert'}</Text>
                      <Text style={styles.histMsg}>{a.message ?? a.body}</Text>
                      <Text style={styles.histMeta}>
                        {a.recipient_name ?? a.student_name ?? 'Bulk'} ·{' '}
                        {timeAgo(a.created_at ?? a.sent_at)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        { backgroundColor: a.status === 'sent' ? '#dcfce7' : '#fef3c7' },
                      ]}
                    >
                      <Text style={styles.statusTxt}>{a.status ?? 'sent'}</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]}>
            <Text style={styles.modalTitle}>Select Student</Text>
            <TextInput
              style={styles.input}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder="Search…"
              placeholderTextColor="#94a3b8"
              autoFocus
            />
            <ScrollView style={{ marginTop: 8 }}>
              {filteredStudents.slice(0, 200).map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.pickRow}
                  onPress={() => {
                    setPicked(s);
                    setPickerOpen(false);
                    setPickerSearch('');
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickName}>{s.name}</Text>
                    <Text style={styles.histMeta}>{s.roll_number}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              onPress={() => setPickerOpen(false)}
              style={{ marginTop: 8, alignItems: 'center' }}
            >
              <Text style={{ color: '#64748b' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '800', color: PRIMARY, padding: 16, paddingBottom: 8 },
  tabStrip: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: PRIMARY },
  tabTxt: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  tabTxtActive: { color: PRIMARY },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 10, marginBottom: 4 },
  bigNum: {
    fontSize: 36,
    fontWeight: '800',
    color: '#ef4444',
    textAlign: 'center',
    paddingVertical: 8,
  },
  input: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cnt: { fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4 },
  bigBtn: {
    flexDirection: 'row',
    backgroundColor: PRIMARY,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  bigBtnTxt: { color: '#fff', fontWeight: '700' },
  histCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  histType: { fontSize: 11, fontWeight: '800', color: PRIMARY, textTransform: 'uppercase' },
  histMsg: { fontSize: 13, color: '#1e293b', marginTop: 3 },
  histMeta: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: 6 },
  statusTxt: { fontSize: 10, fontWeight: '700', color: '#1e293b' },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 30,
  },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: PRIMARY, marginBottom: 8 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pickName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
});
