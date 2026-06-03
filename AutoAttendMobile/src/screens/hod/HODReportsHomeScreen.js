/**
 * HOD — Department Reports (H5)
 *  GET /reports/hod/sessions?subject_id=...
 *  Plus quick PDF download buttons:
 *    /api/reports/hod/defaulters/pdf
 *    /api/reports/student/{id}/pdf?date_from&date_to
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { downloadAndShare } from '../../utils/secureDownload';

const PRIMARY = '#1a237e';

export default function HODReportsHomeScreen() {
  const [sessions, setSessions] = useState([]);
  const [students, setStudents] = useState([]);
  const [subjectId, setSubjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [sub, stu] = await Promise.allSettled([
        client.get('/reports/hod/sessions', { params: subjectId ? { subject_id: subjectId } : {} }),
        client.get('/reports/hod/students'),
      ]);
      if (sub.status === 'fulfilled')
        setSessions(Array.isArray(sub.value.data) ? sub.value.data : []);
      if (stu.status === 'fulfilled')
        setStudents(Array.isArray(stu.value.data) ? stu.value.data : []);
    } catch (err) {
      console.warn('[HODReports] err:', err?.message);
    }
  }, [subjectId]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const dlDefaultersPdf = () =>
    downloadAndShare({
      path: '/api/reports/hod/defaulters/pdf',
      fileName: `defaulters_${new Date().toISOString().slice(0, 10)}.pdf`,
      fallbackExt: 'pdf',
      title: 'Defaulters Report',
    });
  const dlSessionPdf = (sid) =>
    downloadAndShare({
      path: `/api/reports/class/${sid}/pdf`,
      fileName: `session_${sid}.pdf`,
      fallbackExt: 'pdf',
      title: `Session ${sid}`,
    });
  const dlStudentPdf = (stu) =>
    downloadAndShare({
      path: `/api/reports/student/${stu.id}/pdf`,
      fileName: `${stu.roll_number ?? stu.id}.pdf`,
      fallbackExt: 'pdf',
      title: stu.name,
    });

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <Text style={styles.heading}>📊 Department Reports</Text>

        <TouchableOpacity style={styles.bigBtn} onPress={dlDefaultersPdf}>
          <Ionicons name="warning-outline" size={18} color="#fff" />
          <Text style={styles.bigBtnTxt}>Download Defaulters PDF</Text>
        </TouchableOpacity>

        <Text style={styles.section}>Recent Sessions ({sessions.length})</Text>
        <TextInput
          style={styles.input}
          value={subjectId}
          onChangeText={setSubjectId}
          placeholder="Filter by subject ID"
          placeholderTextColor="#94a3b8"
          keyboardType="number-pad"
          onSubmitEditing={fetchData}
        />

        {sessions.length === 0 ? (
          <Text style={styles.empty}>No sessions.</Text>
        ) : (
          sessions.slice(0, 100).map((s) => (
            <View key={s.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{s.subject_name ?? `Session ${s.id}`}</Text>
                <Text style={styles.meta}>
                  {s.date} · {s.present ?? 0}/{s.total ?? 0} present
                </Text>
              </View>
              <TouchableOpacity style={styles.dlBtn} onPress={() => dlSessionPdf(s.id)}>
                <Ionicons name="download-outline" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          ))
        )}

        <Text style={styles.section}>Students ({students.length})</Text>
        {students.slice(0, 100).map((st) => (
          <View key={st.id} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{st.name}</Text>
              <Text style={styles.meta}>{st.roll_number}</Text>
            </View>
            <TouchableOpacity style={styles.dlBtn} onPress={() => dlStudentPdf(st)}>
              <Ionicons name="download-outline" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        {students.length > 100 && (
          <Text style={styles.note}>Showing 100 of {students.length}…</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY, marginBottom: 14 },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 18, marginBottom: 10 },
  bigBtn: {
    flexDirection: 'row',
    backgroundColor: '#ef4444',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  bigBtnTxt: { color: '#fff', fontWeight: '800' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 10,
    fontSize: 13,
    color: '#1e293b',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  dlBtn: { backgroundColor: PRIMARY, padding: 8, borderRadius: 8 },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },
  note: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
});
