/**
 * HOD — Teachers Screen
 * Shows all teachers in the department with today's session status.
 * API: GET  /api/hod/dashboard  → teachers[]
 *      POST /api/hod/add-teacher {name, email, phone?}  (requires recent auth)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function TeachersScreen({ navigation }) {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/hod/dashboard');
      setTeachers(data?.teachers ?? []);
    } catch (err) {
      console.warn('[TeachersScreen] fetch error:', err?.message);
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

  const openAdd = () => {
    setForm({ name: '', email: '', phone: '' });
    setAdding(true);
  };

  const saveTeacher = async () => {
    if (form.name.trim().length < 2)
      return Alert.alert('Validation', 'Name must be at least 2 characters.');
    if (!EMAIL_RE.test(form.email.trim()))
      return Alert.alert('Validation', 'Enter a valid email address.');
    setBusy(true);
    try {
      const payload = { name: form.name.trim(), email: form.email.trim().toLowerCase() };
      if (form.phone.trim()) payload.phone = form.phone.trim();
      const { data } = await client.post('/hod/add-teacher', payload);
      setAdding(false);
      await fetchData();
      Alert.alert(
        'Teacher Added',
        data?.message ?? `${payload.name} was added. Default password: password123`
      );
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.detail ?? 'Could not add teacher.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return teachers;
    return teachers.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        (t.subject_names || []).some((s) => s.toLowerCase().includes(q))
    );
  }, [teachers, search]);

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={filtered}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.heading}>👩‍🏫 Teachers ({teachers.length})</Text>
              <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
                <Ionicons name="person-add-outline" size={15} color="#fff" />
                <Text style={styles.addTxt}>Add</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.search}
              placeholder="Search name, email, subject…"
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
            />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No teachers found.</Text>
          </View>
        }
        renderItem={({ item: t }) => {
          const sess = t.today_session;
          const hasSession = !!sess;
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.7}
              onPress={() =>
                navigation?.navigate('TeacherDetail', { teacher_id: t.id, teacher_name: t.name })
              }
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{(t.name || '?')[0].toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{t.name}</Text>
                <Text style={styles.email}>{t.email}</Text>
                <View style={styles.chipRow}>
                  {(t.subject_names || []).map((s, i) => (
                    <View key={i} style={styles.chip}>
                      <Text style={styles.chipTxt}>{s}</Text>
                    </View>
                  ))}
                  {(t.subject_names || []).length === 0 && (
                    <Text style={styles.noSub}>No subjects</Text>
                  )}
                </View>
              </View>
              {hasSession ? (
                <View
                  style={[
                    styles.sessBadge,
                    { backgroundColor: sess.status === 'active' ? '#dcfce7' : '#f1f5f9' },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      color: sess.status === 'active' ? '#16a34a' : '#64748b',
                      fontWeight: '700',
                    }}
                  >
                    {sess.status === 'active' ? '🟢 Live' : sess.status}
                  </Text>
                  <Text style={{ fontSize: 10, color: '#64748b' }}>
                    {sess.present_count}/{sess.total_students}
                  </Text>
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
              )}
            </TouchableOpacity>
          );
        }}
      />

      {/* Add Teacher modal */}
      <Modal
        visible={adding}
        animationType="slide"
        transparent
        onRequestClose={() => setAdding(false)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Teacher</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              placeholder="Full name"
              placeholderTextColor="#94a3b8"
              onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
            />
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={form.email}
              placeholder="teacher@college.edu"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={(t) => setForm((f) => ({ ...f, email: t }))}
            />
            <Text style={styles.label}>Phone (optional)</Text>
            <TextInput
              style={styles.input}
              value={form.phone}
              placeholder="10-digit number"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              onChangeText={(t) => setForm((f) => ({ ...f, phone: t }))}
            />
            <Text style={styles.hint}>
              New teacher joins your department with default password “password123”.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#f1f5f9' }]}
                onPress={() => setAdding(false)}
              >
                <Text style={[styles.btnTxt, { color: '#475569' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: PRIMARY }]}
                onPress={saveTeacher}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Add</Text>}
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
  list: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', color: PRIMARY, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: {
    flexDirection: 'row',
    backgroundColor: PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 4,
    alignItems: 'center',
    marginBottom: 12,
  },
  addTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },
  search: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: PRIMARY },
  name: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  email: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  chip: { backgroundColor: '#eef2ff', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  chipTxt: { fontSize: 10, color: PRIMARY, fontWeight: '600' },
  noSub: { fontSize: 10, color: '#cbd5e1', fontStyle: 'italic' },
  sessBadge: { borderRadius: 8, padding: 6, alignItems: 'center', gap: 2 },
  noSess: { fontSize: 10, color: '#cbd5e1', fontStyle: 'italic' },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 10 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: PRIMARY, marginBottom: 6 },
  label: { fontSize: 12, color: '#475569', fontWeight: '700', marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  hint: { fontSize: 11, color: '#94a3b8', fontStyle: 'italic', marginTop: 10 },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '700' },
});
