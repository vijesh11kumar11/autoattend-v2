/**
 * Teacher / HOD — Leave Management Screen
 *
 * APIs:
 *   GET  /api/leave/pending
 *   POST /api/leave/{id}/approve  body: { note }
 *   POST /api/leave/{id}/reject   body: { note }
 *
 * Only the assigned tutor of a student (or HOD of the dept) can review.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
import ErrorState from '../../components/ErrorState';

const PRIMARY = '#1a237e';

const TYPE_ICON = {
  medical: 'medkit-outline',
  duty: 'briefcase-outline',
  sports: 'football-outline',
  personal: 'person-outline',
  emergency: 'alert-circle-outline',
  other: 'document-outline',
};

const TYPE_COLOR = {
  medical: '#3b82f6',
  duty: '#0ea5e9',
  sports: '#f59e0b',
  personal: '#8b5cf6',
  emergency: '#ef4444',
  other: '#64748b',
};

export default function LeaveManagementScreen() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const [modalLeave, setModalLeave] = useState(null); // {leave, action}
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchPending = useCallback(async () => {
    setError(false);
    try {
      const { data } = await client.get('/leave/pending');
      setPending(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[LeaveManagementScreen] pending error:', err?.message);
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchPending().finally(() => setLoading(false));
  }, [fetchPending]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPending();
    setRefreshing(false);
  }, [fetchPending]);

  const openModal = (leave, action) => {
    setModalLeave({ leave, action });
    setNote('');
  };

  const closeModal = () => {
    setModalLeave(null);
    setNote('');
  };

  const submitReview = async () => {
    if (!modalLeave) return;
    const { leave, action } = modalLeave;
    if (action === 'reject' && note.trim().length < 3) {
      Alert.alert('Note required', 'Please provide a brief note for rejection.');
      return;
    }
    setSubmitting(true);
    try {
      await client.post(`/leave/${leave.id}/${action}`, { note: note.trim() || null });
      setPending((prev) => prev.filter((l) => l.id !== leave.id));
      closeModal();
      Alert.alert('Done', `Leave ${action === 'approve' ? 'approved' : 'rejected'}.`);
    } catch (err) {
      const detail = err.response?.data?.detail || err?.message || 'Action failed';
      Alert.alert('Failed', String(detail));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.heading}>📥 Leave Requests</Text>
        <Text style={styles.sub}>{pending.length} pending</Text>
      </View>

      {error ? (
        <ErrorState message="Unable to load leave requests." onRetry={fetchPending} />
      ) : (
        <FlatList
          data={pending}
          keyExtractor={(l) => String(l.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="checkmark-circle-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>No pending requests.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const color = TYPE_COLOR[item.leave_type] || '#64748b';
            const icon = TYPE_ICON[item.leave_type] || 'document-outline';
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconCircle, { backgroundColor: `${color}22` }]}>
                    <Ionicons name={icon} size={18} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.studentName}>{item.student_name}</Text>
                    <Text style={styles.metaText}>
                      {item.student_roll} · {(item.leave_type || '').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.daysText}>{item.days}d</Text>
                </View>

                <View style={styles.dateRow}>
                  <Ionicons name="calendar-outline" size={13} color="#64748b" />
                  <Text style={styles.dateText}>
                    {item.from_date} → {item.to_date}
                  </Text>
                </View>

                <Text style={styles.reasonText} numberOfLines={4}>
                  {item.reason}
                </Text>

                {item.document_url ? (
                  <View style={styles.docRow}>
                    <Ionicons name="attach" size={14} color="#3b82f6" />
                    <Text style={styles.docText} numberOfLines={1}>
                      {item.document_url}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn]}
                    onPress={() => openModal(item, 'reject')}
                  >
                    <Ionicons name="close" size={16} color="#ef4444" />
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn]}
                    onPress={() => openModal(item, 'approve')}
                  >
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!modalLeave} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {modalLeave?.action === 'approve' ? 'Approve Leave' : 'Reject Leave'}
            </Text>
            {modalLeave?.leave ? (
              <Text style={styles.modalSub}>
                {modalLeave.leave.student_name} · {modalLeave.leave.from_date} →{' '}
                {modalLeave.leave.to_date}
              </Text>
            ) : null}

            <Text style={styles.label}>
              Note {modalLeave?.action === 'reject' ? '(required)' : '(optional)'}
            </Text>
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              value={note}
              onChangeText={setNote}
              placeholder={
                modalLeave?.action === 'reject' ? 'Why is this being rejected?' : 'Optional comment'
              }
              placeholderTextColor="#94a3b8"
              multiline
            />

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeModal}
                disabled={submitting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSubmit,
                  { backgroundColor: modalLeave?.action === 'approve' ? '#22c55e' : '#ef4444' },
                  submitting && { opacity: 0.6 },
                ]}
                onPress={submitReview}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalSubmitText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  list: { padding: 16 },

  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  studentName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  metaText: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  daysText: { fontSize: 14, fontWeight: '800', color: PRIMARY },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  dateText: { fontSize: 12, color: '#475569', fontWeight: '600' },

  reasonText: { fontSize: 13, color: '#475569', lineHeight: 19 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  docText: { fontSize: 11, color: '#3b82f6', flex: 1 },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
  },
  approveBtn: { backgroundColor: '#22c55e' },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  rejectBtn: { borderWidth: 1, borderColor: '#ef4444', backgroundColor: '#fff' },
  rejectBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 13 },

  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  modalSub: { fontSize: 12, color: '#64748b', marginTop: 4 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1e293b',
  },
  modalActionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
  },
  modalCancelText: { color: '#475569', fontWeight: '700' },
  modalSubmit: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  modalSubmitText: { color: '#fff', fontWeight: '700' },
});
