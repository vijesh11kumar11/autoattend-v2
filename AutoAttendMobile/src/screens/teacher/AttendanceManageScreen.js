/**
 * Teacher — Attendance Management Screen
 *
 * Flow:
 *   1. Receive `subject_id` (+ optional `subject_name`) via route params.
 *   2. GET /api/faculty/my-sessions   → filter by subject_id, last 14 days.
 *   3. Tap a session → GET /api/attendance/session/{id} → list students with toggles.
 *   4. Toggle P/A/L → POST /api/attendance/manual-override per student.
 *
 * Backend rule: manual override allowed within 24 hours of session end.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import ErrorState from '../../components/ErrorState';

const PRIMARY = '#1a237e';

const STATUS_COLORS = {
  present: '#22c55e',
  absent: '#ef4444',
  late: '#f59e0b',
};

export default function AttendanceManageScreen({ route }) {
  const subjectId = route?.params?.subject_id;
  const subjectName = route?.params?.subject_name;

  const [sessions, setSessions] = useState([]);
  const [loadingSess, setLoadingSess] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const [selectedSession, setSelectedSession] = useState(null);
  const [studentList, setStudentList] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const fetchSessions = useCallback(async () => {
    setError(false);
    try {
      const { data } = await client.get('/faculty/my-sessions');
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      const filtered = (Array.isArray(data) ? data : []).filter((s) => {
        if (subjectId && s.subject_id !== subjectId && s.subject_code !== subjectId) {
          // my-sessions doesn't include subject_id directly; fallback on subject_name match
          if (subjectName && s.subject_name !== subjectName) return false;
        }
        const sd = s.date ? new Date(s.date) : null;
        return sd && sd >= cutoff;
      });
      setSessions(filtered);
    } catch (err) {
      console.warn('[AttendanceManageScreen] my-sessions error:', err?.message);
      setError(true);
    }
  }, [subjectId, subjectName]);

  useEffect(() => {
    fetchSessions().finally(() => setLoadingSess(false));
  }, [fetchSessions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSessions();
    setRefreshing(false);
  }, [fetchSessions]);

  const openSession = async (sess) => {
    setSelectedSession(sess);
    setLoadingDetail(true);
    try {
      const { data } = await client.get(`/attendance/session/${sess.id}`);
      setStudentList(Array.isArray(data?.students) ? data.students : []);
    } catch (err) {
      console.warn('[AttendanceManageScreen] session detail error:', err?.message);
      Alert.alert('Error', 'Could not load session details.');
      setSelectedSession(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const updateStatus = async (student, newStatus) => {
    if (!selectedSession) return;
    if (student.status === newStatus) return;
    setUpdatingId(student.student_id);
    try {
      await client.post('/attendance/manual-override', {
        session_id: selectedSession.id,
        student_id: student.student_id,
        status: newStatus,
        reason: 'Manual update from mobile teacher app',
      });
      setStudentList((prev) =>
        prev.map((s) => (s.student_id === student.student_id ? { ...s, status: newStatus } : s))
      );
    } catch (err) {
      const detail = err.response?.data?.detail || err?.message || 'Update failed';
      Alert.alert('Override Failed', String(detail));
    } finally {
      setUpdatingId(null);
    }
  };

  const stats = useMemo(() => {
    const present = studentList.filter((s) => s.status === 'present').length;
    const absent = studentList.filter((s) => s.status === 'absent').length;
    const late = studentList.filter((s) => s.status === 'late').length;
    return { present, absent, late, total: studentList.length };
  }, [studentList]);

  // ── DETAIL VIEW ────────────────────────────────────────────────────
  if (selectedSession) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.detailHeader}>
          <TouchableOpacity
            onPress={() => {
              setSelectedSession(null);
              setStudentList([]);
            }}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={20} color="#fff" />
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.detailTitle} numberOfLines={1}>
            {selectedSession.subject_name} · {selectedSession.date}
          </Text>
          <Text style={styles.warnText}>⚠ Overrides allowed within 24 hrs of session end.</Text>
          <View style={styles.statRow}>
            <View style={[styles.statPill, { backgroundColor: '#dcfce7' }]}>
              <Text style={[styles.statPillText, { color: '#16a34a' }]}>P {stats.present}</Text>
            </View>
            <View style={[styles.statPill, { backgroundColor: '#fee2e2' }]}>
              <Text style={[styles.statPillText, { color: '#dc2626' }]}>A {stats.absent}</Text>
            </View>
            <View style={[styles.statPill, { backgroundColor: '#fef3c7' }]}>
              <Text style={[styles.statPillText, { color: '#d97706' }]}>L {stats.late}</Text>
            </View>
            <View style={[styles.statPill, { backgroundColor: '#e2e8f0' }]}>
              <Text style={[styles.statPillText, { color: '#475569' }]}>Total {stats.total}</Text>
            </View>
          </View>
        </View>

        {loadingDetail ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={PRIMARY} />
          </View>
        ) : (
          <FlatList
            data={studentList}
            keyExtractor={(s) => String(s.student_id)}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyTxt}>No students enrolled.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isUpdating = updatingId === item.student_id;
              return (
                <View style={styles.studentCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.studentName}>{item.name}</Text>
                    {item.roll_number ? (
                      <Text style={styles.studentRoll}>{item.roll_number}</Text>
                    ) : null}
                  </View>
                  <View style={styles.toggleRow}>
                    {['present', 'absent', 'late'].map((st) => {
                      const active = item.status === st;
                      return (
                        <TouchableOpacity
                          key={st}
                          disabled={isUpdating}
                          onPress={() => updateStatus(item, st)}
                          style={[
                            styles.toggleBtn,
                            active && {
                              backgroundColor: STATUS_COLORS[st],
                              borderColor: STATUS_COLORS[st],
                            },
                          ]}
                        >
                          <Text style={[styles.toggleBtnText, active && { color: '#fff' }]}>
                            {st[0].toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    {isUpdating && (
                      <ActivityIndicator size="small" color={PRIMARY} style={{ marginLeft: 6 }} />
                    )}
                  </View>
                </View>
              );
            }}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── SESSION LIST VIEW ──────────────────────────────────────────────
  if (loadingSess) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Text style={styles.heading}>📋 Manage Attendance</Text>
        <Text style={styles.sub}>
          {subjectName ? `Sessions for ${subjectName}` : 'Your recent sessions'} · last 14 days
        </Text>
      </ScrollView>

      {error ? (
        <ErrorState message="Unable to load your sessions." onRetry={fetchSessions} />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="calendar-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>No sessions in the last 14 days.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.sessCard} onPress={() => openSession(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sessSubject}>{item.subject_name}</Text>
                <Text style={styles.sessMeta}>
                  {item.subject_code} · {item.date}
                </Text>
                <Text style={styles.sessMeta}>
                  {item.present_count}/{item.total_students} present
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  list: { padding: 16 },

  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginTop: 4, marginBottom: 12 },

  sessCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 10,
  },
  sessSubject: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  sessMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },

  detailHeader: { backgroundColor: PRIMARY, padding: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 8 },
  backBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  detailTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  warnText: { color: '#fde68a', fontSize: 11, marginTop: 6 },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statPillText: { fontSize: 12, fontWeight: '700' },

  studentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
  },
  studentName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  studentRoll: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleBtn: {
    minWidth: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  toggleBtnText: { fontSize: 12, fontWeight: '700', color: '#475569' },

  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
});
