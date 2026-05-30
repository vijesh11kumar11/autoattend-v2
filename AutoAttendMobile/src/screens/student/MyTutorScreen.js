/**
 * Student — My Tutor (S3)
 * GET /api/student/portal/my-tutor
 * Shows assigned tutor's name, phone, email with quick-call/email actions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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

const PRIMARY = '#1a237e';

export default function MyTutorScreen() {
  const [tutor, setTutor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/student/portal/my-tutor');
      setTutor(data?.tutor ?? data ?? null);
    } catch (err) {
      console.warn('[MyTutor] fetch error:', err?.message);
      setTutor(null);
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
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        <Text style={styles.heading}>👨‍🏫 My Tutor</Text>
        <Text style={styles.sub}>Your assigned mentor for academic guidance.</Text>

        {!tutor || !(tutor.name || tutor.tutor_name) ? (
          <View style={styles.emptyCard}>
            <Ionicons name="person-outline" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTxt}>No tutor assigned yet.</Text>
            <Text style={styles.emptySub}>Contact your HOD if this is an error.</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>
                  {(tutor.name ?? tutor.tutor_name ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.name}>{tutor.name ?? tutor.tutor_name}</Text>
              {tutor.designation && <Text style={styles.role}>{tutor.designation}</Text>}
              {tutor.department && <Text style={styles.role}>{tutor.department}</Text>}
            </View>

            {tutor.phone && (
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => Linking.openURL(`tel:${tutor.phone}`)}
              >
                <Ionicons name="call-outline" size={20} color="#22c55e" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.actLabel}>Phone</Text>
                  <Text style={styles.actValue}>{tutor.phone}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
              </TouchableOpacity>
            )}
            {tutor.email && (
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => Linking.openURL(`mailto:${tutor.email}`)}
              >
                <Ionicons name="mail-outline" size={20} color="#3b82f6" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.actLabel}>Email</Text>
                  <Text style={styles.actValue}>{tutor.email}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
              </TouchableOpacity>
            )}
            {tutor.whatsapp && (
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() =>
                  Linking.openURL(`https://wa.me/${tutor.whatsapp.replace(/\D/g, '')}`)
                }
              >
                <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.actLabel}>WhatsApp</Text>
                  <Text style={styles.actValue}>{tutor.whatsapp}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarTxt: { color: '#fff', fontSize: 28, fontWeight: '800' },
  name: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  role: { fontSize: 12, color: '#64748b', marginTop: 4 },
  actionRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  actLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '700' },
  actValue: { fontSize: 14, color: '#1e293b', fontWeight: '600', marginTop: 2 },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyTxt: { fontSize: 14, color: '#64748b', fontWeight: '600', marginTop: 10 },
  emptySub: { fontSize: 11, color: '#94a3b8', marginTop: 4, textAlign: 'center' },
});
