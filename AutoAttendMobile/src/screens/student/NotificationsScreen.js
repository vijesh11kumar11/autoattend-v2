/**
 * Student — Notifications Screen
 *
 * Source: GET /api/alerts/student
 *
 * Read-state is tracked client-side (server has no read column on AlertsLog).
 * Storage: AsyncStorage key `aa_read_alert_ids` — JSON array of ids.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import ErrorState from '../../components/ErrorState';

const PRIMARY = '#1a237e';
const READ_KEY = 'aa_read_alert_ids';

const TYPE_ICON = {
  low_attendance: 'trending-down-outline',
  defaulter: 'alert-circle-outline',
  warning: 'warning-outline',
  custom: 'chatbubble-ellipses-outline',
  leave_review: 'document-text-outline',
  default: 'notifications-outline',
};

const CHANNEL_LABEL = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  in_app: 'In-app',
  push: 'Push',
};

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

async function loadReadSet() {
  try {
    const raw = await AsyncStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function persistReadSet(set) {
  try {
    await AsyncStorage.setItem(READ_KEY, JSON.stringify(Array.from(set)));
  } catch (err) {
    console.warn('[NotificationsScreen] persist read set failed:', err?.message);
  }
}

export default function NotificationsScreen() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readIds, setReadIds] = useState(new Set());
  const [error, setError] = useState(false);

  const fetchAlerts = useCallback(async () => {
    setError(false);
    try {
      const { data } = await client.get('/alerts/student?limit=100');
      setAlerts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[NotificationsScreen] fetch error:', err?.message);
      setError(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setReadIds(await loadReadSet());
      await fetchAlerts();
      setLoading(false);
    })();
  }, [fetchAlerts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAlerts();
    setRefreshing(false);
  }, [fetchAlerts]);

  const markRead = useCallback(async (id) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      persistReadSet(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(async () => {
    const next = new Set(readIds);
    alerts.forEach((a) => next.add(a.id));
    setReadIds(next);
    await persistReadSet(next);
  }, [alerts, readIds]);

  const unreadCount = alerts.filter((a) => !readIds.has(a.id)).length;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <FlatList
        data={alerts}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heading}>🔔 Notifications</Text>
              <Text style={styles.sub}>
                {unreadCount > 0
                  ? `${unreadCount} unread alert${unreadCount === 1 ? '' : 's'}`
                  : 'You are all caught up.'}
              </Text>
            </View>
            {unreadCount > 0 && (
              <TouchableOpacity
                style={styles.markAllBtn}
                onPress={markAllRead}
                activeOpacity={0.85}
              >
                <Text style={styles.markAllText}>Mark all read</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        ListEmptyComponent={
          error ? (
            <ErrorState message="Unable to load your notifications." onRetry={fetchAlerts} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={56} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>No notifications yet.</Text>
            </View>
          )
        }
        renderItem={({ item: a }) => {
          const unread = !readIds.has(a.id);
          const iconName = TYPE_ICON[a.alert_type] || TYPE_ICON.default;
          return (
            <TouchableOpacity
              style={[styles.card, unread && styles.cardUnread]}
              onPress={() => markRead(a.id)}
              activeOpacity={0.85}
            >
              <View style={[styles.iconWrap, unread && { backgroundColor: '#eef2ff' }]}>
                <Ionicons name={iconName} size={22} color={unread ? PRIMARY : '#94a3b8'} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.cardHeader}>
                  <Text style={[styles.type, unread && { color: PRIMARY }]} numberOfLines={1}>
                    {(a.alert_type || 'alert').replace(/_/g, ' ').toUpperCase()}
                  </Text>
                  <Text style={styles.time}>{fmtWhen(a.sent_at)}</Text>
                </View>
                <Text style={styles.message} numberOfLines={4}>
                  {a.message}
                </Text>
                {a.channel && (
                  <Text style={styles.channel}>via {CHANNEL_LABEL[a.channel] || a.channel}</Text>
                )}
              </View>
              {unread && <View style={styles.dot} />}
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  sub: { fontSize: 13, color: '#94a3b8' },

  markAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  markAllText: { fontSize: 12, color: PRIMARY, fontWeight: '700' },

  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  cardUnread: { borderColor: '#c7d2fe', backgroundColor: '#fafbff' },

  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  type: { fontSize: 11, fontWeight: '700', color: '#64748b', letterSpacing: 0.4, flex: 1 },
  time: { fontSize: 11, color: '#94a3b8', marginLeft: 8 },
  message: { fontSize: 14, color: '#1e293b', lineHeight: 20 },
  channel: { fontSize: 11, color: '#94a3b8', marginTop: 6 },

  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6', marginTop: 6 },

  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
});
