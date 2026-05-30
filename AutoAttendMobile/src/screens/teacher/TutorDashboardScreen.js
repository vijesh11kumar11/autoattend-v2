/**
 * Teacher — Tutor Dashboard (T2)
 *
 *  GET /api/tutor/my-ward-students
 *  GET /api/tutor/my-defaulters
 *  GET /api/tutor/ward-student/{student_id}/full-report
 *  POST /api/tutor/notify-ward { student_id, message }
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
const pctColor = (p) => (p >= 75 ? '#22c55e' : p >= 65 ? '#f59e0b' : '#ef4444');

export default function TutorDashboardScreen() {
  const [wards, setWards] = useState([]);
  const [defaulters, setDefaulters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('Wards');

  // Detail modal
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Notify modal
  const [notifyTarget, setNotifyTarget] = useState(null);
  const [notifyMsg, setNotifyMsg] = useState('');
  const [notifyBusy, setNotifyBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [a, b] = await Promise.allSettled([
        client.get('/tutor/my-ward-students'),
        client.get('/tutor/my-defaulters'),
      ]);
      if (a.status === 'fulfilled')
        setWards(Array.isArray(a.value.data) ? a.value.data : (a.value.data?.students ?? []));
      if (b.status === 'fulfilled')
        setDefaulters(
          Array.isArray(b.value.data) ? b.value.data : (b.value.data?.defaulters ?? [])
        );
    } catch (err) {
      console.warn('[TutorDash] fetch error:', err?.message);
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

  const openDetail = async (s) => {
    setDetailLoading(true);
    setDetail({ student_id: s.student_id ?? s.id, name: s.name });
    try {
      const { data } = await client.get(`/tutor/ward-student/${s.student_id ?? s.id}/full-report`);
      setDetail({ ...data, student_id: s.student_id ?? s.id, name: s.name });
    } catch (err) {
      Alert.alert('Error', 'Could not load report.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const sendNotify = async () => {
    if (!notifyTarget || !notifyMsg.trim()) return;
    setNotifyBusy(true);
    try {
      await client.post('/tutor/notify-ward', {
        student_id: notifyTarget.student_id ?? notifyTarget.id,
        message: notifyMsg.trim(),
      });
      Alert.alert('Sent', 'Notification dispatched to ward.');
      setNotifyTarget(null);
      setNotifyMsg('');
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not send.');
    } finally {
      setNotifyBusy(false);
    }
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  const list = tab === 'Defaulters' ? defaulters : wards;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.tabBar}>
        {['Wards', 'Defaulters'].map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {t} ({t === 'Wards' ? wards.length : defaulters.length})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        {list.length === 0 ? (
          <View style={styles.empty2}>
            <Ionicons name="people-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>
              {tab === 'Defaulters'
                ? 'No defaulters — all wards on track!'
                : 'No ward students assigned.'}
            </Text>
          </View>
        ) : (
          list.map((s, i) => {
            const pct = s.overall_pct ?? s.percentage ?? 0;
            return (
              <View
                key={s.student_id ?? s.id ?? i}
                style={[styles.row, { borderLeftColor: pctColor(pct) }]}
              >
                <TouchableOpacity style={{ flex: 1 }} onPress={() => openDetail(s)}>
                  <Text style={styles.name}>{s.name ?? '—'}</Text>
                  <Text style={styles.meta}>
                    {s.roll_number ?? ''}
                    {s.section ? ` · ${s.section}` : ''}
                  </Text>
                  <Text style={[styles.pct, { color: pctColor(pct) }]}>{pct.toFixed(1)}%</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setNotifyTarget(s)} style={styles.notifyBtn}>
                  <Ionicons name="notifications-outline" size={18} color={PRIMARY} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openDetail(s)}>
                  <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Detail modal */}
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.modalHead}>
            <TouchableOpacity onPress={() => setDetail(null)}>
              <Ionicons name="close" size={26} color={PRIMARY} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{detail?.name ?? 'Ward'}</Text>
            <View style={{ width: 26 }} />
          </View>
          {detailLoading ? (
            <ActivityIndicator color={PRIMARY} style={{ marginTop: 30 }} />
          ) : (
            <ScrollView contentContainerStyle={styles.scroll}>
              {detail?.overall_pct != null && (
                <View style={styles.overallBox}>
                  <Text style={styles.overallLabel}>Overall Attendance</Text>
                  <Text style={[styles.overallVal, { color: pctColor(detail.overall_pct) }]}>
                    {Number(detail.overall_pct).toFixed(1)}%
                  </Text>
                </View>
              )}
              {detail?.subjects?.length > 0 && (
                <>
                  <Text style={styles.section}>By Subject</Text>
                  {detail.subjects.map((sb, i) => (
                    <View key={i} style={styles.subjBox}>
                      <Text style={styles.name}>{sb.subject_name}</Text>
                      <Text style={styles.meta}>
                        {sb.subject_code} · {sb.present}/{sb.total}
                      </Text>
                      <Text style={[styles.pct, { color: pctColor(sb.pct ?? 0) }]}>
                        {(sb.pct ?? 0).toFixed(1)}%
                      </Text>
                    </View>
                  ))}
                </>
              )}
              {detail?.contacts && (
                <>
                  <Text style={styles.section}>Contacts</Text>
                  <View style={styles.subjBox}>
                    {detail.contacts.father_name ? (
                      <Text style={styles.meta}>
                        Father: {detail.contacts.father_name} ({detail.contacts.father_phone ?? '—'}
                        )
                      </Text>
                    ) : null}
                    {detail.contacts.mother_name ? (
                      <Text style={styles.meta}>
                        Mother: {detail.contacts.mother_name} ({detail.contacts.mother_phone ?? '—'}
                        )
                      </Text>
                    ) : null}
                    {detail.contacts.guardian_email ? (
                      <Text style={styles.meta}>Email: {detail.contacts.guardian_email}</Text>
                    ) : null}
                  </View>
                </>
              )}
              {!detail?.subjects?.length && !detail?.contacts && (
                <Text selectable style={{ fontSize: 11, color: '#64748b' }}>
                  {JSON.stringify(detail, null, 2)}
                </Text>
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Notify modal */}
      <Modal
        visible={!!notifyTarget}
        animationType="slide"
        transparent
        onRequestClose={() => setNotifyTarget(null)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle2}>Notify Ward</Text>
            <Text style={styles.meta}>{notifyTarget?.name}</Text>
            <TextInput
              style={styles.input}
              multiline
              placeholder="Message to parents/guardian…"
              placeholderTextColor="#94a3b8"
              value={notifyMsg}
              onChangeText={setNotifyMsg}
              maxLength={500}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#f1f5f9' }]}
                onPress={() => {
                  setNotifyTarget(null);
                  setNotifyMsg('');
                }}
              >
                <Text style={[styles.btnTxt, { color: '#475569' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: PRIMARY }, notifyBusy && { opacity: 0.6 }]}
                onPress={sendNotify}
                disabled={notifyBusy}
              >
                {notifyBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnTxt}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
  row: {
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
  name: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  pct: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  notifyBtn: { padding: 8, marginRight: 4 },
  empty2: { alignItems: 'center', paddingTop: 60 },
  emptyTxt: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: '#1e293b', textAlign: 'center' },
  overallBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
  },
  overallLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '700' },
  overallVal: { fontSize: 28, fontWeight: '900', marginTop: 4 },
  section: { fontSize: 14, fontWeight: '700', color: '#1e293b', marginBottom: 10, marginTop: 6 },
  subjBox: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle2: { fontSize: 16, fontWeight: '800', color: PRIMARY, marginBottom: 4 },
  input: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    minHeight: 80,
    marginTop: 12,
    color: '#1e293b',
  },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
