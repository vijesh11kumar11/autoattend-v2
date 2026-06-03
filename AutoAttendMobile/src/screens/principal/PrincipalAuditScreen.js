/**
 * Principal — Audit Log Screen
 * GET /api/principal/audit
 * Searchable, paginated audit/activity log.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function PrincipalAuditScreen() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(50);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/principal/audit');
      setLogs(data?.logs ?? (Array.isArray(data) ? data : []));
    } catch (err) {
      console.warn('[PrincipalAudit] fetch error:', err?.message);
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(50);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        String(l.action ?? l.event ?? '')
          .toLowerCase()
          .includes(q) ||
        String(l.performed_by ?? l.user ?? '')
          .toLowerCase()
          .includes(q) ||
        String(l.details ?? '')
          .toLowerCase()
          .includes(q)
    );
  }, [logs, search]);

  const slice = filtered.slice(0, page);

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={slice}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (slice.length < filtered.length) setPage((p) => p + 50);
        }}
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>🕒 Audit Log</Text>
            <Text style={styles.sub}>{filtered.length} entries</Text>
            <TextInput
              style={styles.search}
              placeholder="Search actions, users…"
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
            />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No audit entries.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Ionicons name="time-outline" size={16} color="#94a3b8" />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.action}>{item.action ?? item.event ?? 'Activity'}</Text>
              {item.details ? (
                <Text style={styles.details} numberOfLines={2}>
                  {item.details}
                </Text>
              ) : null}
              <Text style={styles.meta}>
                {item.performed_by ?? item.user ?? 'system'} ·{' '}
                {timeAgo(item.created_at ?? item.timestamp)}
              </Text>
            </View>
          </View>
        )}
        ListFooterComponent={
          slice.length < filtered.length ? (
            <ActivityIndicator size="small" color={PRIMARY} style={{ marginTop: 12 }} />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  search: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  action: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  details: { fontSize: 11, color: '#475569', marginTop: 2 },
  meta: { fontSize: 10, color: '#94a3b8', marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 30 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
