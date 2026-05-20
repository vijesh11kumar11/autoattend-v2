/**
 * HOD — Department Reports Screen
 * Shows defaulter count + button to download defaulters PDF.
 * APIs: GET /api/alerts/hod/defaulters/count
 *       GET /api/reports/defaulters-pdf?department_id={id}
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { downloadAndShare } from '../../utils/secureDownload';

const PRIMARY = '#1a237e';

export default function HODReportsScreen() {
  const { user } = useAuth();
  const [defaulterCount, setDefaulterCount] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dlLoading, setDlLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/alerts/hod/defaulters/count');
      setDefaulterCount(data?.count ?? 0);
    } catch (err) {
      console.warn('[HODReportsScreen] defaulters count error:', err?.message);
    }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const downloadDefaulters = async () => {
    if (!user?.department_id) {
      Alert.alert('Error', 'Your department is not set on your account.');
      return;
    }
    setDlLoading(true);
    try {
      await downloadAndShare({
        path:        `/api/reports/defaulters-pdf?department_id=${user.department_id}`,
        fileName:    `defaulters-dept-${user.department_id}`,
        fallbackExt: 'pdf',
        title:       'Save defaulters report',
      });
    } catch (err) {
      console.warn('[HODReportsScreen] download error:', err?.message);
    } finally { setDlLoading(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>

        <Text style={styles.heading}>📈 Department Reports</Text>
        <Text style={styles.sub}>View and download attendance reports for your department.</Text>

        {/* Defaulters Summary */}
        <View style={[styles.card, defaulterCount > 0 ? styles.dangerCard : {}]}>
          <Ionicons name="warning-outline" size={32} color={defaulterCount > 0 ? '#ef4444' : '#22c55e'} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.cardTitle}>Low Attendance Students</Text>
            <Text style={[styles.countTxt, { color: defaulterCount > 0 ? '#ef4444' : '#22c55e' }]}>
              {defaulterCount ?? 0} student{defaulterCount !== 1 ? 's' : ''} below 75%
            </Text>
          </View>
        </View>

        {/* Download Actions */}
        <Text style={styles.section}>Download Reports</Text>

        <TouchableOpacity style={styles.actionCard} onPress={downloadDefaulters} disabled={dlLoading}>
          <Ionicons name="document-text-outline" size={24} color={PRIMARY} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.actionTitle}>Defaulters PDF</Text>
            <Text style={styles.actionSub}>List of students with attendance below 75%</Text>
          </View>
          {dlLoading
            ? <ActivityIndicator size="small" color={PRIMARY} />
            : <Ionicons name="download-outline" size={22} color={PRIMARY} />}
        </TouchableOpacity>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={18} color="#3b82f6" />
          <Text style={styles.infoTxt}>
            More detailed reports (monthly Excel, class sessions) are available on the web dashboard.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 20 },
  section: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginTop: 24, marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  dangerCard: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  countTxt: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  actionCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10 },
  actionTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  actionSub: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  infoCard: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16 },
  infoTxt: { fontSize: 12, color: '#3b82f6', flex: 1, lineHeight: 18 },
});
