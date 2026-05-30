/**
 * Teacher — Reports Screen
 * Lets teacher download class session PDF for any of their subjects.
 * API: GET /api/reports/class-session-pdf?subject_id={id}
 *      GET /api/faculty/{id}/classes (for subject list)
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { downloadAndShare } from '../../utils/secureDownload';

const PRIMARY = '#1a237e';

export default function TeacherReportsScreen() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get(`/faculty/${user?.id}/classes`);
      setClasses(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[TeacherReportsScreen] classes fetch error:', err?.message);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleDownload = async (subjectId, name) => {
    setDownloading(subjectId);
    try {
      await downloadAndShare({
        path: `/api/reports/class-session-pdf?subject_id=${subjectId}`,
        fileName: `attendance-${name}-${subjectId}`,
        fallbackExt: 'pdf',
        title: `Save ${name} report`,
      });
    } catch (err) {
      // downloadAndShare already shows an alert; just log
      console.warn('[TeacherReportsScreen] download error:', err?.message);
    } finally {
      setDownloading(null);
    }
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={classes}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.heading}>📋 My Reports</Text>
            <Text style={styles.sub}>Download session attendance reports for your classes.</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No classes to generate reports for.</Text>
          </View>
        }
        renderItem={({ item: c }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.meta}>
                {c.code} · Sem {c.semester ?? '—'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.dlBtn}
              onPress={() => handleDownload(c.id, c.name)}
              disabled={downloading === c.id}
            >
              {downloading === c.id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="download-outline" size={18} color="#fff" />
              )}
            </TouchableOpacity>
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
  heading: { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 4 },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  name: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  meta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  dlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
});
