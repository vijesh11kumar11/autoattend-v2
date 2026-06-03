/**
 * Student — Feed Screen
 * GET /api/feed
 * GET /api/feed/article/{id}
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
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

export default function FeedScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/feed');
      setItems(Array.isArray(data) ? data : (data?.articles ?? data?.items ?? data?.feed ?? []));
    } catch (err) {
      console.warn('[Feed] fetch error:', err?.message);
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

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={items}
        keyExtractor={(item, i) => String(item.id ?? i)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
        ListHeaderComponent={<Text style={styles.heading}>📰 Career & News Feed</Text>}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="newspaper-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No articles yet.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const url = item.url ?? item.link;
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => url && Linking.openURL(url).catch(() => {})}
              activeOpacity={url ? 0.7 : 1}
            >
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.img} />
              ) : null}
              <View style={styles.body}>
                {item.category ? (
                  <Text style={styles.cat}>{String(item.category).toUpperCase()}</Text>
                ) : null}
                <Text style={styles.title} numberOfLines={2}>
                  {item.title ?? item.headline ?? '—'}
                </Text>
                {item.summary ? (
                  <Text style={styles.summary} numberOfLines={3}>
                    {item.summary}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>{item.source ?? item.author ?? ''}</Text>
                  <Text style={styles.meta}>· {timeAgo(item.published_at ?? item.created_at)}</Text>
                </View>
              </View>
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
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY, marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  img: { width: '100%', height: 160, backgroundColor: '#e2e8f0' },
  body: { padding: 14 },
  cat: { fontSize: 10, fontWeight: '800', color: PRIMARY, letterSpacing: 0.6, marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  summary: { fontSize: 12, color: '#475569', marginTop: 6, lineHeight: 17 },
  metaRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
  meta: { fontSize: 10, color: '#94a3b8' },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
});
