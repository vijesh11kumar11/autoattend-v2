/**
 * Teacher — My Classes Screen
 * Lists all subjects assigned to the teacher.
 * API: GET /api/faculty/{id}/classes
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl,
  SafeAreaView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const PRIMARY = '#1a237e';

export default function ClassesScreen() {
  const { user } = useAuth();
  const [classes, setClasses]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get(`/faculty/${user?.id}/classes`);
      setClasses(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  }, [user?.id]);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={classes}
        keyExtractor={c => String(c.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
        ListHeaderComponent={<Text style={styles.heading}>📚 My Classes ({classes.length})</Text>}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="book-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No classes assigned yet.</Text>
          </View>
        }
        renderItem={({ item: c }) => (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="book" size={22} color={PRIMARY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.meta}>{c.code} · Semester {c.semester ?? '—'}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  meta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
});
