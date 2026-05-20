/**
 * Student — Leave Request Screen
 *
 * APIs:
 *   POST   /api/leave/apply        body: { leave_type, from_date, to_date, reason, document_url? }
 *   GET    /api/leave/my-requests
 *   DELETE /api/leave/{id}/cancel
 *
 * Leave types accepted by backend: medical | duty | personal | emergency | sports | other
 * Documents are required server-side for: medical, duty, sports (we expose a free-text
 * "document URL" field for now — file uploads are a future enhancement).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform,
  RefreshControl, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client       from '../../api/client';
import ErrorState   from '../../components/ErrorState';

const PRIMARY = '#1a237e';

const LEAVE_TYPES = [
  { value: 'medical',   label: 'Medical',    icon: 'medkit-outline',        needsDoc: true  },
  { value: 'duty',      label: 'Duty',       icon: 'briefcase-outline',     needsDoc: true  },
  { value: 'sports',    label: 'Sports',     icon: 'football-outline',      needsDoc: true  },
  { value: 'personal',  label: 'Personal',   icon: 'person-outline',        needsDoc: false },
  { value: 'emergency', label: 'Emergency',  icon: 'alert-circle-outline',  needsDoc: false },
  { value: 'other',     label: 'Other',      icon: 'ellipsis-horizontal',   needsDoc: false },
];

const STATUS_COLOR = {
  pending:   '#f97316',
  approved:  '#22c55e',
  rejected:  '#ef4444',
  cancelled: '#94a3b8',
};

// Format YYYY-MM-DD (UTC-stable for date-only fields)
function fmtDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO()    { return fmtDateISO(new Date()); }
function tomorrowISO() { const t = new Date(); t.setDate(t.getDate() + 1); return fmtDateISO(t); }

export default function LeaveRequestScreen() {
  const [requests, setRequests]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(false);

  // Form state
  const [modalOpen, setModalOpen]   = useState(false);
  const [leaveType, setLeaveType]   = useState('personal');
  const [fromDate, setFromDate]     = useState(todayISO());
  const [toDate, setToDate]         = useState(tomorrowISO());
  const [reason, setReason]         = useState('');
  const [docUrl, setDocUrl]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr]       = useState('');

  const fetchRequests = useCallback(async () => {
    setError(false);
    try {
      const { data } = await client.get('/leave/my-requests');
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[LeaveRequestScreen] my-requests error:', err?.message);
      setError(true);
    }
  }, []);

  useEffect(() => { fetchRequests().finally(() => setLoading(false)); }, [fetchRequests]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRequests();
    setRefreshing(false);
  }, [fetchRequests]);

  const resetForm = useCallback(() => {
    setLeaveType('personal');
    setFromDate(todayISO());
    setToDate(tomorrowISO());
    setReason('');
    setDocUrl('');
    setFormErr('');
  }, []);

  const selectedType = useMemo(
    () => LEAVE_TYPES.find((t) => t.value === leaveType),
    [leaveType],
  );

  const validateForm = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) { setFormErr('From date must be YYYY-MM-DD.'); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate))   { setFormErr('To date must be YYYY-MM-DD.');   return false; }
    if (new Date(toDate) < new Date(fromDate)) { setFormErr('"To" date cannot be before "From" date.'); return false; }
    if (reason.trim().length < 3)              { setFormErr('Please describe your reason (at least 3 characters).'); return false; }
    if (selectedType?.needsDoc && !docUrl.trim()) {
      setFormErr(`A document URL is required for "${selectedType.label}" leave.`);
      return false;
    }
    setFormErr('');
    return true;
  };

  const submitLeave = async () => {
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      await client.post('/leave/apply', {
        leave_type:   leaveType,
        from_date:    fromDate,
        to_date:      toDate,
        reason:       reason.trim(),
        document_url: docUrl.trim() || undefined,
      });
      Alert.alert('Submitted', 'Your leave request has been submitted for approval.');
      setModalOpen(false);
      resetForm();
      await fetchRequests();
    } catch (err) {
      const detail = err.response?.data?.detail || err?.message || 'Could not submit leave request.';
      Alert.alert('Submission Failed', String(detail));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelLeave = (lr) => {
    Alert.alert(
      'Cancel Leave',
      `Cancel the ${lr.leave_type} leave from ${lr.from_date} to ${lr.to_date}?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await client.delete(`/leave/${lr.id}/cancel`);
              await fetchRequests();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.detail || 'Could not cancel this request.');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <FlatList
        data={requests}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>📝 My Leave Requests</Text>
            <Text style={styles.sub}>Submit and track your leave applications.</Text>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => { resetForm(); setModalOpen(true); }}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={styles.applyBtnText}>Apply for Leave</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          error
            ? <ErrorState message="Unable to load your leave requests." onRetry={fetchRequests} />
            : (
              <View style={styles.empty}>
                <Ionicons name="document-text-outline" size={48} color="#cbd5e1" />
                <Text style={styles.emptyTxt}>No leave requests yet.</Text>
              </View>
            )
        }
        renderItem={({ item: lr }) => {
          const color = STATUS_COLOR[lr.status] || '#94a3b8';
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeBadgeText}>{lr.leave_type?.toUpperCase()}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: `${color}22`, borderColor: color }]}>
                  <Text style={[styles.statusBadgeText, { color }]}>{(lr.status || '').toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.range}>{lr.from_date} → {lr.to_date}</Text>
              <Text style={styles.reason} numberOfLines={3}>{lr.reason}</Text>
              {lr.review_note ? (
                <Text style={styles.reviewNote}>
                  <Text style={{ fontWeight: '700' }}>Reviewer note: </Text>{lr.review_note}
                </Text>
              ) : null}
              {lr.status === 'pending' && (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => cancelLeave(lr)}>
                  <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
                  <Text style={styles.cancelBtnText}>Cancel Request</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      {/* ── Apply for Leave modal ───────────────────────────────────────── */}
      <Modal
        visible={modalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Apply for Leave</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: '85%' }} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Leave Type</Text>
              <View style={styles.typeGrid}>
                {LEAVE_TYPES.map((t) => {
                  const selected = leaveType === t.value;
                  return (
                    <TouchableOpacity
                      key={t.value}
                      style={[styles.typeChip, selected && styles.typeChipSelected]}
                      onPress={() => setLeaveType(t.value)}
                    >
                      <Ionicons name={t.icon} size={16} color={selected ? '#fff' : PRIMARY} />
                      <Text style={[styles.typeChipText, selected && { color: '#fff' }]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>From (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={fromDate}
                onChangeText={setFromDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.label}>To (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                value={toDate}
                onChangeText={setToDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.label}>Reason</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={reason}
                onChangeText={setReason}
                placeholder="Explain why you need leave…"
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={4}
              />

              {selectedType?.needsDoc && (
                <>
                  <Text style={styles.label}>Document URL (required)</Text>
                  <TextInput
                    style={styles.input}
                    value={docUrl}
                    onChangeText={setDocUrl}
                    placeholder="https://… link to medical certificate, etc."
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
                  />
                </>
              )}

              {formErr ? <Text style={styles.formErr}>{formErr}</Text> : null}

              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={submitLeave}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.submitBtnText}>Submit Request</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#f8fafc' },
  list:   { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  sub:     { fontSize: 13, color: '#94a3b8', marginBottom: 16 },

  applyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14,
    marginBottom: 20, gap: 8,
  },
  applyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typeBadge:  { backgroundColor: '#eef2ff', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  typeBadgeText: { fontSize: 11, fontWeight: '700', color: PRIMARY, letterSpacing: 0.4 },
  statusBadge:    { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText:{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  range:    { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 6 },
  reason:   { fontSize: 13, color: '#475569', lineHeight: 19 },
  reviewNote: { fontSize: 12, color: '#64748b', marginTop: 8, fontStyle: 'italic' },
  cancelBtn:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2', gap: 6,
  },
  cancelBtnText: { color: '#ef4444', fontWeight: '600', fontSize: 13 },

  empty:    { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },

  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle:{ fontSize: 18, fontWeight: '700', color: '#1e293b' },

  label: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginTop: 12, marginBottom: 6, letterSpacing: 0.4 },
  input: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#1e293b',
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, borderColor: PRIMARY,
    backgroundColor: '#fff',
  },
  typeChipSelected: { backgroundColor: PRIMARY },
  typeChipText:     { color: PRIMARY, fontWeight: '600', fontSize: 13 },

  formErr: { color: '#ef4444', fontSize: 13, marginTop: 12 },

  submitBtn: {
    backgroundColor: PRIMARY, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 18,
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
