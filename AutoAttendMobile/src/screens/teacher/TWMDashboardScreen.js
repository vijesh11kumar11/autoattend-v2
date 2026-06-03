/**
 * Teacher — TWM (Tutor With Mentor) Dashboard (T1)
 *
 *  GET   /api/twm/dashboard
 *  POST  /api/twm/start          { date, notes?, academic_year }
 *  PUT   /api/twm/{id}/mark-student   { student_id, status, note? }
 *  POST  /api/twm/{id}/mark-all-present
 *  POST  /api/twm/{id}/end
 *  GET   /api/twm/history
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const ATT_STATES = ['present', 'late', 'absent'];
const stColor = (s) => (s === 'present' ? '#22c55e' : s === 'late' ? '#f59e0b' : '#ef4444');

export default function TWMDashboardScreen() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('Wards');
  const [activeSession, setActiveSession] = useState(null); // { session_id, ward_students, date }
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [d, h] = await Promise.allSettled([
        client.get('/twm/dashboard'),
        client.get('/twm/history'),
      ]);
      if (d.status === 'fulfilled') setData(d.value.data);
      if (h.status === 'fulfilled')
        setHistory(Array.isArray(h.value.data) ? h.value.data : (h.value.data?.sessions ?? []));
    } catch (err) {
      console.warn('[TWM] fetch error:', err?.message);
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

  const startTWM = async () => {
    const ay = data?.academic_year;
    if (!ay) return Alert.alert('Missing', 'Academic year not detected — assign wards first.');
    setStarting(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: r } = await client.post('/twm/start', { date: today, academic_year: ay });
      setActiveSession(r);
      setTab('Active');
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not start TWM.');
    } finally {
      setStarting(false);
    }
  };

  const markStudent = async (student_id, status) => {
    if (!activeSession) return;
    try {
      await client.put(`/twm/${activeSession.session_id}/mark-student`, { student_id, status });
      setActiveSession((prev) => ({
        ...prev,
        ward_students: prev.ward_students.map((s) =>
          s.student_id === student_id ? { ...s, status } : s
        ),
      }));
    } catch (err) {
      Alert.alert('Error', 'Mark failed.');
    }
  };

  const markAllPresent = async () => {
    if (!activeSession) return;
    try {
      await client.post(`/twm/${activeSession.session_id}/mark-all-present`);
      setActiveSession((prev) => ({
        ...prev,
        ward_students: prev.ward_students.map((s) => ({ ...s, status: 'present' })),
      }));
    } catch (err) {
      Alert.alert('Error', 'Failed.');
    }
  };

  const endSession = () => {
    if (!activeSession) return;
    Alert.alert('End TWM', 'Submit and end this session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: async () => {
          try {
            await client.post(`/twm/${activeSession.session_id}/end`);
            Alert.alert('Done', 'TWM session ended.');
            setActiveSession(null);
            setTab('Wards');
            fetchData();
          } catch (err) {
            Alert.alert('Error', 'Could not end.');
          }
        },
      },
    ]);
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  const summary = data?.summary ?? {};
  const wards = data?.ward_students ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.tabBar}>
        {['Wards', 'Active', 'History'].map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'Wards' && (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
        >
          <Text style={styles.heading}>👥 Ward Students</Text>
          <Text style={styles.sub}>
            {data?.academic_year
              ? `Academic Year ${data.academic_year}`
              : 'Tutor-with-Mentor program'}
          </Text>

          <View style={styles.statsRow}>
            <Stat label="Total" value={summary.total_ward ?? 0} color={PRIMARY} />
            <Stat label="Safe" value={summary.safe ?? 0} color="#22c55e" />
            <Stat label="Warning" value={summary.warning ?? 0} color="#f59e0b" />
            <Stat
              label="Critical"
              value={(summary.critical ?? 0) + (summary.detained ?? 0)}
              color="#ef4444"
            />
          </View>

          {!activeSession && (
            <TouchableOpacity
              style={[styles.startBtn, starting && { opacity: 0.6 }]}
              onPress={startTWM}
              disabled={starting}
            >
              {starting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="play-circle-outline" size={18} color="#fff" />
                  <Text style={styles.startBtnTxt}>Start TWM Session (Today)</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <Text style={styles.section}>Wards ({wards.length})</Text>
          {wards.length === 0 ? (
            <Text style={styles.empty}>No ward students assigned.</Text>
          ) : (
            wards.map((s) => (
              <View
                key={s.student_id}
                style={[
                  styles.wardRow,
                  {
                    borderLeftColor: stColor(
                      s.attendance_status === 'safe'
                        ? 'present'
                        : s.attendance_status === 'warning'
                          ? 'late'
                          : 'absent'
                    ),
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.wardName}>{s.name}</Text>
                  <Text style={styles.wardMeta}>
                    {s.roll_number ?? ''}
                    {s.section ? ` · ${s.section}` : ''}
                  </Text>
                </View>
                <View>
                  <Text
                    style={[
                      styles.wardPct,
                      {
                        color: stColor(
                          s.attendance_status === 'safe'
                            ? 'present'
                            : s.attendance_status === 'warning'
                              ? 'late'
                              : 'absent'
                        ),
                      },
                    ]}
                  >
                    {s.overall_pct?.toFixed(0) ?? 0}%
                  </Text>
                  {s.needs_attention && <Text style={styles.flag}>⚠ Attention</Text>}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {tab === 'Active' && (
        <ScrollView contentContainerStyle={styles.scroll}>
          {!activeSession ? (
            <View style={styles.empty2}>
              <Ionicons name="play-circle-outline" size={40} color="#cbd5e1" />
              <Text style={styles.emptyTxt}>No active TWM session.</Text>
              <Text style={styles.emptySub}>Start one from the Wards tab.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.heading}>📍 Active Session</Text>
              <Text style={styles.sub}>
                {activeSession.date} ·{' '}
                {activeSession.total ?? activeSession.ward_students?.length ?? 0} students
              </Text>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.bulkBtn, { backgroundColor: '#22c55e' }]}
                  onPress={markAllPresent}
                >
                  <Ionicons name="checkmark-done-outline" size={16} color="#fff" />
                  <Text style={styles.bulkBtnTxt}>All Present</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bulkBtn, { backgroundColor: '#ef4444' }]}
                  onPress={endSession}
                >
                  <Ionicons name="stop-circle-outline" size={16} color="#fff" />
                  <Text style={styles.bulkBtnTxt}>End Session</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.section}>Mark Attendance</Text>
              {(activeSession.ward_students ?? []).map((s) => (
                <View key={s.student_id} style={styles.markRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wardName}>{s.name}</Text>
                    <Text style={styles.wardMeta}>{s.roll_number ?? ''}</Text>
                  </View>
                  <View style={styles.markBtns}>
                    {ATT_STATES.map((st) => (
                      <TouchableOpacity
                        key={st}
                        style={[
                          styles.markBtn,
                          s.status === st && {
                            backgroundColor: stColor(st),
                            borderColor: stColor(st),
                          },
                        ]}
                        onPress={() => markStudent(s.student_id, st)}
                      >
                        <Text style={[styles.markBtnTxt, s.status === st && { color: '#fff' }]}>
                          {st.charAt(0).toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {tab === 'History' && (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
          }
        >
          <Text style={styles.heading}>📋 TWM History</Text>
          {history.length === 0 ? (
            <Text style={styles.empty}>No past sessions.</Text>
          ) : (
            history.map((h) => (
              <View key={h.id ?? h.session_id} style={styles.histRow}>
                <Ionicons name="calendar-outline" size={20} color={PRIMARY} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.wardName}>{h.date}</Text>
                  <Text style={styles.wardMeta}>
                    {h.present_count ?? 0}/{h.total ?? 0} present · {h.status ?? 'ended'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value, color }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statV, { color }]}>{value}</Text>
      <Text style={styles.statL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: PRIMARY },
  tabTxt: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  tabTxtActive: { color: PRIMARY },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 12, color: '#94a3b8', marginBottom: 14 },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 18, marginBottom: 10 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stat: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statV: { fontSize: 22, fontWeight: '900' },
  statL: { fontSize: 10, color: '#94a3b8', fontWeight: '700', marginTop: 2 },
  startBtn: {
    flexDirection: 'row',
    backgroundColor: PRIMARY,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  startBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  bulkBtn: {
    flex: 1,
    flexDirection: 'row',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bulkBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },
  wardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 4,
  },
  wardName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  wardMeta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  wardPct: { fontSize: 16, fontWeight: '900', textAlign: 'right' },
  flag: { fontSize: 9, color: '#ef4444', fontWeight: '700', textAlign: 'right' },
  markRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  markBtns: { flexDirection: 'row', gap: 4 },
  markBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markBtnTxt: { fontSize: 12, fontWeight: '800', color: '#475569' },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  empty: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
  },
  empty2: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: { fontSize: 14, color: '#64748b', fontWeight: '600', marginTop: 10 },
  emptySub: { fontSize: 11, color: '#94a3b8', marginTop: 4, textAlign: 'center' },
});
