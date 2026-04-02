/**
 * PendingApprovalsScreen — device-change request cards with approve / reject
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons }     from '@expo/vector-icons';
import client           from '../../api/client';

const PRIMARY = '#1a237e';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function PendingApprovalsScreen({ navigation }) {
  const [requests,   setRequests]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting,     setActing]     = useState(null); // id being acted on

  const fetchRequests = useCallback(async () => {
    try {
      const { data } = await client.get('/hod/pending-approvals');
      setRequests(Array.isArray(data) ? data : (data.requests ?? []));
    } catch { setRequests([]); }
  }, []);

  useEffect(() => { fetchRequests().finally(() => setLoading(false)); }, [fetchRequests]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRequests();
    setRefreshing(false);
  }, [fetchRequests]);

  const handleAction = useCallback(async (id, action) => {
    const verb = action === 'approve' ? 'Approve' : 'Reject';
    Alert.alert(
      `${verb} request?`,
      `Are you sure you want to ${action} this device change request?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb,
          style: action === 'reject' ? 'destructive' : 'default',
          onPress: async () => {
            setActing(id);
            try {
              await client.post(`/hod/${action}`, { request_id: id });
              setRequests((prev) => prev.filter((r) => r.id !== id));
            } catch (err) {
              Alert.alert('Error', err.response?.data?.detail ?? 'Action failed');
            }
            setActing(null);
          },
        },
      ],
    );
  }, []);

  const renderItem = useCallback(({ item }) => {
    const isActing = acting === item.id;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconCircle}>
            <Ionicons name="phone-portrait-outline" size={20} color={PRIMARY} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.cardType}>{item.type ?? 'Device Change'}</Text>
            <Text style={styles.cardName}>{item.student_name ?? '—'}{item.roll_no ? ` (${item.roll_no})` : ''}</Text>
          </View>
          <Text style={styles.cardTime}>{timeAgo(item.created_at ?? item.timestamp)}</Text>
        </View>

        {item.reason ? (
          <Text style={styles.cardReason} numberOfLines={3}>{item.reason}</Text>
        ) : null}

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.rejectBtn, isActing && styles.btnDisabled]}
            onPress={() => handleAction(item.id, 'reject')}
            disabled={isActing}
            activeOpacity={0.8}
          >
            {isActing ? <ActivityIndicator size="small" color="#ef4444" /> : (
              <>
                <Ionicons name="close-circle-outline" size={18} color="#ef4444" />
                <Text style={styles.rejectText}>Reject</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.approveBtn, isActing && styles.btnDisabled]}
            onPress={() => handleAction(item.id, 'approve')}
            disabled={isActing}
            activeOpacity={0.8}
          >
            {isActing ? <ActivityIndicator size="small" color="#fff" /> : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.approveText}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [acting, handleAction]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.centred]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <View style={styles.titleRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.title}>Pending Approvals</Text>
        <Text style={styles.count}>{requests.length}</Text>
      </View>

      <FlatList
        data={requests}
        keyExtractor={(r) => String(r.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListEmptyComponent={
          <View style={styles.centred}>
            <Ionicons name="checkmark-done-circle-outline" size={56} color="#cbd5e1" />
            <Text style={styles.emptyText}>No pending requests</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f8fafc' },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },

  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  title: { fontSize: 18, fontWeight: '800', color: PRIMARY, flex: 1 },
  count: {
    backgroundColor: '#e8eaf6', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 3,
    fontSize: 13, fontWeight: '800', color: PRIMARY, overflow: 'hidden',
  },

  list:      { padding: 16, paddingBottom: 40 },
  emptyText: { color: '#94a3b8', fontSize: 14, marginTop: 12 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#e8eaf6', alignItems: 'center', justifyContent: 'center',
  },
  cardType:  { fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' },
  cardName:  { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 1 },
  cardTime:  { fontSize: 11, color: '#94a3b8' },
  cardReason: {
    fontSize: 13, color: '#475569', lineHeight: 18,
    marginTop: 10, paddingLeft: 52,
  },

  cardActions: {
    flexDirection: 'row', gap: 10, marginTop: 14, paddingLeft: 52,
  },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#fecaca', height: 42,
    backgroundColor: '#fef2f2',
  },
  approveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 10, height: 42, backgroundColor: '#22c55e',
  },
  rejectText:  { fontSize: 13, fontWeight: '700', color: '#ef4444' },
  approveText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.5 },
});
