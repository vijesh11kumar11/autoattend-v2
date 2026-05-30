/**
 * Student — Dispute Attendance Screen
 *
 * APIs:
 *   POST /api/student/portal/dispute-attendance  body: { session_id, reason, proof_note? }
 *   GET  /api/student/portal/my-disputes
 *
 * Backend constraints:
 *   • Only `absent` records can be disputed
 *   • Only sessions in the last 7 days
 *   • One pending dispute per session
 *
 * Navigation:
 *   navigate('Dispute', { session_id, subject_name, date }) prefills the form.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client       from '../../api/client';
import { addToQueue } from '../../utils/offlineQueue';
import ErrorState   from '../../components/ErrorState';

const PRIMARY = '#1a237e';

const STATUS_COLOR = {
  pending:  '#f97316',
  approved: '#22c55e',
  rejected: '#ef4444',
};

export default function DisputeScreen({ route, navigation }) {
  const prefill = route?.params || {};

  const [disputes, setDisputes]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(false);

  const [sessionId, setSessionId]   = useState(prefill.session_id ? String(prefill.session_id) : '');
  const [reason, setReason]         = useState('');
  const [proofNote, setProofNote]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr]       = useState('');

  const fetchDisputes = useCallback(async () => {
    setError(false);
    try {
      const { data } = await client.get('/student/portal/my-disputes');
      setDisputes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[DisputeScreen] my-disputes error:', err?.message);
      setError(true);
    }
  }, []);

  useEffect(() => { fetchDisputes().finally(() => setLoading(false)); }, [fetchDisputes]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDisputes();
    setRefreshing(false);
  }, [fetchDisputes]);

  const submitDispute = async () => {
    const sidNum = Number(sessionId);
    if (!sidNum || Number.isNaN(sidNum) || sidNum <= 0) {
      setFormErr('Please enter a valid session ID.');
      return;
    }
    if (reason.trim().length < 5) {
      setFormErr('Reason must be at least 5 characters.');
      return;
    }
    setFormErr('');
    setSubmitting(true);
    const disputePayload = {
      session_id: sidNum,
      reason:     reason.trim(),
      proof_note: proofNote.trim() || undefined,
    };
    try {
      const { data } = await client.post('/student/portal/dispute-attendance', disputePayload);
      Alert.alert('Dispute Filed', data?.message || 'Your dispute has been submitted.');
      setReason('');
      setProofNote('');
      setSessionId('');
      await fetchDisputes();
    } catch (err) {
      // Offline path (issues #88/#121): queue on network failure, sync later.
      if (!err?.response) {
        try {
          await addToQueue('dispute', '/student/portal/dispute-attendance', 'post', disputePayload);
          Alert.alert(
            'Saved Offline',
            'You are offline. Your dispute will be submitted automatically when you reconnect.',
          );
          setReason('');
          setProofNote('');
          setSessionId('');
          return;
        } catch {
          // Fall through to the normal error UI if queueing itself fails.
        }
      }
      const detail =
        err.response?.data?.message ||
        err.response?.data?.detail ||
        err?.message ||
        'Could not file dispute.';
      Alert.alert('Submission Failed', String(detail));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <FlatList
        data={disputes}
        keyExtractor={(d) => String(d.dispute_id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListHeaderComponent={
          <ScrollView keyboardShouldPersistTaps="handled" scrollEnabled={false}>
            <Text style={styles.heading}>⚖️ Raise an Attendance Dispute</Text>
            <Text style={styles.sub}>
              You can dispute an absent mark for any session in the past 7 days.
            </Text>

            <View style={styles.formCard}>
              {prefill.subject_name ? (
                <View style={styles.prefillBanner}>
                  <Ionicons name="information-circle-outline" size={16} color="#3b82f6" />
                  <Text style={styles.prefillText}>
                    {prefill.subject_name}{prefill.date ? ` · ${prefill.date}` : ''}
                  </Text>
                </View>
              ) : null}

              <Text style={styles.label}>Session ID</Text>
              <TextInput
                style={styles.input}
                value={sessionId}
                onChangeText={setSessionId}
                placeholder="e.g. 4231"
                placeholderTextColor="#94a3b8"
                keyboardType="number-pad"
                editable={!prefill.session_id}
              />

              <Text style={styles.label}>Reason</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={reason}
                onChangeText={setReason}
                placeholder="Why do you believe the absent mark is incorrect?"
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={4}
              />

              <Text style={styles.label}>Proof / Note (optional)</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={proofNote}
                onChangeText={setProofNote}
                placeholder="Any supporting context (witness, document URL, etc.)"
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={3}
              />

              {formErr ? <Text style={styles.formErr}>{formErr}</Text> : null}

              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={submitDispute}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.submitBtnText}>File Dispute</Text>}
              </TouchableOpacity>
            </View>

            <Text style={styles.section}>My Disputes</Text>
          </ScrollView>
        }
        ListEmptyComponent={
          error
            ? <ErrorState message="Unable to load your disputes." onRetry={fetchDisputes} />
            : (
              <View style={styles.empty}>
                <Ionicons name="folder-open-outline" size={48} color="#cbd5e1" />
                <Text style={styles.emptyTxt}>You haven&apos;t filed any disputes yet.</Text>
              </View>
            )
        }
        renderItem={({ item: d }) => {
          const color = STATUS_COLOR[d.status] || '#94a3b8';
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subject}>{d.subject_name}</Text>
                  <Text style={styles.metaText}>{d.subject_code} · {d.date}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: `${color}22`, borderColor: color }]}>
                  <Text style={[styles.statusBadgeText, { color }]}>{(d.status || '').toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.reasonText} numberOfLines={4}>{d.reason}</Text>
              {d.resolution_note ? (
                <Text style={styles.resolutionNote}>
                  <Text style={{ fontWeight: '700' }}>Teacher: </Text>{d.resolution_note}
                </Text>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#f8fafc' },
  list:   { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  sub:     { fontSize: 13, color: '#94a3b8', marginBottom: 16 },

  formCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 18,
  },
  prefillBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#eff6ff', borderRadius: 8, padding: 8, marginBottom: 10,
  },
  prefillText: { fontSize: 12, color: '#3b82f6', flex: 1 },

  label: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginTop: 12, marginBottom: 6, letterSpacing: 0.4 },
  input: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#1e293b',
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  formErr: { color: '#ef4444', fontSize: 13, marginTop: 12 },
  submitBtn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 16,
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  section: { fontSize: 13, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10,
  },
  cardHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  subject:     { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  metaText:    { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  statusBadge: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  reasonText: { fontSize: 13, color: '#475569', lineHeight: 19 },
  resolutionNote: { fontSize: 12, color: '#64748b', marginTop: 8, fontStyle: 'italic' },

  empty:    { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
});
