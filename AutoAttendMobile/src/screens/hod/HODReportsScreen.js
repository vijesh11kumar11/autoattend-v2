/**
 * HOD — Department Reports Screen (P21 — card grid)
 * APIs (corrected):
 *   GET /api/alerts/hod/defaulters/count
 *   GET /api/reports/defaulters/pdf?department_id={id}
 *   GET /api/reports/monthly/{subject_id}/excel?year=&month=
 *   GET /api/reports/class/{session_id}/pdf
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { downloadAndShare } from '../../utils/secureDownload';

const PRIMARY = '#1a237e';

export default function HODReportsScreen() {
  const { user } = useAuth();
  const [defaulterCount, setDefaulterCount] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);

  const [showMonthly, setShowMonthly] = useState(false);
  const [showClass, setShowClass]     = useState(false);
  const [subjectId, setSubjectId]     = useState('');
  const [monthYear, setMonthYear]     = useState({ year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1) });
  const [sessionId, setSessionId]     = useState('');

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/alerts/hod/defaulters/count');
      setDefaulterCount(data?.count ?? 0);
    } catch (err) { console.warn('[HODReports] count error:', err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }, [fetchData]);

  const dlDefaulters = async () => {
    if (!user?.department_id) return Alert.alert('Error', 'Your department is not set.');
    setBusy('defaulters');
    try {
      await downloadAndShare({
        path: `/api/reports/defaulters/pdf?department_id=${user.department_id}`,
        fileName: `defaulters-dept-${user.department_id}`,
        fallbackExt: 'pdf',
        title: 'Save defaulters report',
      });
    } catch (err) { Alert.alert('Error', 'Download failed.'); }
    finally { setBusy(null); }
  };

  const dlMonthly = async () => {
    const sid = parseInt(subjectId, 10);
    const y = parseInt(monthYear.year, 10);
    const m = parseInt(monthYear.month, 10);
    if (!sid || !y || !m) return Alert.alert('Required', 'Enter subject ID, year, and month.');
    setShowMonthly(false); setBusy('monthly');
    try {
      await downloadAndShare({
        path: `/api/reports/monthly/${sid}/excel?year=${y}&month=${m}`,
        fileName: `subject-${sid}-${y}-${String(m).padStart(2, '0')}`,
        fallbackExt: 'xlsx',
        title: 'Save monthly report',
      });
    } catch (err) { Alert.alert('Error', 'Download failed.'); }
    finally { setBusy(null); }
  };

  const dlClass = async () => {
    const sid = parseInt(sessionId, 10);
    if (!sid) return Alert.alert('Required', 'Enter a session ID.');
    setShowClass(false); setBusy('class');
    try {
      await downloadAndShare({
        path: `/api/reports/class/${sid}/pdf`,
        fileName: `class-${sid}`,
        fallbackExt: 'pdf',
        title: 'Save class report',
      });
    } catch (err) { Alert.alert('Error', 'Download failed.'); }
    finally { setBusy(null); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>;

  const CARDS = [
    { key: 'defaulters', icon: 'warning-outline',       title: 'Defaulters PDF',    sub: 'Students below 75%',     color: '#ef4444', onPress: dlDefaulters },
    { key: 'monthly',    icon: 'calendar-outline',      title: 'Monthly Excel',     sub: 'Per-subject monthly',    color: '#22c55e', onPress: () => setShowMonthly(true) },
    { key: 'class',      icon: 'document-text-outline', title: 'Class Session PDF', sub: 'Single session report',  color: '#3b82f6', onPress: () => setShowClass(true) },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}>
        <Text style={styles.heading}>📈 Department Reports</Text>
        <Text style={styles.sub}>Generate and download attendance reports.</Text>

        <View style={[styles.summary, defaulterCount > 0 && styles.danger]}>
          <Ionicons name="warning-outline" size={28} color={defaulterCount > 0 ? '#ef4444' : '#22c55e'} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.sumTitle}>Low Attendance Students</Text>
            <Text style={[styles.sumVal, { color: defaulterCount > 0 ? '#ef4444' : '#22c55e' }]}>
              {defaulterCount} student{defaulterCount !== 1 ? 's' : ''} below 75%
            </Text>
          </View>
        </View>

        <Text style={styles.section}>Download Reports</Text>
        <View style={styles.grid}>
          {CARDS.map(c => (
            <TouchableOpacity key={c.key} style={styles.card} onPress={c.onPress} disabled={busy != null} activeOpacity={0.8}>
              <View style={[styles.iconWrap, { backgroundColor: c.color + '22' }]}>
                {busy === c.key
                  ? <ActivityIndicator color={c.color} />
                  : <Ionicons name={c.icon} size={24} color={c.color} />}
              </View>
              <Text style={styles.cardTitle}>{c.title}</Text>
              <Text style={styles.cardSub}>{c.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <Modal visible={showMonthly} transparent animationType="fade" onRequestClose={() => setShowMonthly(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Monthly Excel Report</Text>
            <TextInput style={styles.input} placeholder="Subject ID" placeholderTextColor="#94a3b8"
              keyboardType="number-pad" value={subjectId} onChangeText={setSubjectId} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Year" placeholderTextColor="#94a3b8"
                keyboardType="number-pad" value={monthYear.year} onChangeText={v => setMonthYear(p => ({ ...p, year: v }))} />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Month 1-12" placeholderTextColor="#94a3b8"
                keyboardType="number-pad" value={monthYear.month} onChangeText={v => setMonthYear(p => ({ ...p, month: v }))} />
            </View>
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowMonthly(false)}><Text style={styles.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.okBtn} onPress={dlMonthly}><Text style={styles.okTxt}>Download</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showClass} transparent animationType="fade" onRequestClose={() => setShowClass(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Class Session Report</Text>
            <TextInput style={styles.input} placeholder="Session ID" placeholderTextColor="#94a3b8"
              keyboardType="number-pad" value={sessionId} onChangeText={setSessionId} />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowClass(false)}><Text style={styles.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.okBtn} onPress={dlClass}><Text style={styles.okTxt}>Download</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 20 },
  section: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginTop: 18, marginBottom: 12 },
  summary: { backgroundColor: '#fff', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  danger: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  sumTitle: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  sumVal: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '48%', backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  cardSub: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: PRIMARY, marginBottom: 14 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12, fontSize: 14, color: '#1e293b', borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  cancelTxt: { color: '#64748b', fontWeight: '700' },
  okBtn: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 10, backgroundColor: PRIMARY },
  okTxt: { color: '#fff', fontWeight: '700' },
});
