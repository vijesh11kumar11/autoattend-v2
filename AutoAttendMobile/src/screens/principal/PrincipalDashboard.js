/**
 * PrincipalDashboard — college-wide stats, department attendance bars, alert button
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { CardSkeleton, StatsSkeleton } from '../../components/SkeletonLoader';

const PRIMARY = '#1a237e';

function pctColor(p) {
  if (p >= 75) return '#22c55e';
  if (p >= 65) return '#f59e0b';
  return '#ef4444';
}

export default function PrincipalDashboard({ navigation }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [college, setCollege] = useState({});
  const [stats, setStats] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [alertText, setAlertText] = useState('');
  const [sending, setSending] = useState(false);

  const principalName = user?.name ?? user?.sub ?? 'Principal';

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/principal/dashboard');
      setCollege(data.college ?? {});
      setStats(data.stats ?? []);
      setDepartments(data.departments ?? []);
    } catch (err) {
      console.warn('[PrincipalDashboard] fetch error:', err?.message);
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

  const sendAlert = useCallback(async () => {
    if (!alertText.trim()) return;
    setSending(true);
    try {
      await client.post('/alerts/college', { message: alertText.trim() });
      Alert.alert('Sent', 'College-wide alert sent successfully.');
      setAlertText('');
    } catch (err) {
      Alert.alert('Error', err.response?.data?.detail ?? 'Could not send alert.');
    }
    setSending(false);
  }, [alertText]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <StatsSkeleton count={5} />
        <CardSkeleton count={4} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />
        }
      >
        {/* Header */}
        <Text style={styles.collegeName}>{college.name ?? 'College'}</Text>
        <Text style={styles.principalSub}>Welcome, {principalName}</Text>

        {/* Stat cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsRow}
        >
          {(stats.length
            ? stats
            : [
                {
                  label: 'Departments',
                  value: departments.length,
                  icon: 'business-outline',
                  color: '#3b82f6',
                },
                {
                  label: 'Students',
                  value: college.student_count ?? 0,
                  icon: 'school-outline',
                  color: '#8b5cf6',
                },
                {
                  label: 'Teachers',
                  value: college.teacher_count ?? 0,
                  icon: 'people-outline',
                  color: '#06b6d4',
                },
                {
                  label: 'Avg %',
                  value: `${(college.avg_percentage ?? 0).toFixed(1)}%`,
                  icon: 'stats-chart-outline',
                  color: pctColor(college.avg_percentage ?? 0),
                },
                {
                  label: 'Alerts',
                  value: college.alert_count ?? 0,
                  icon: 'notifications-outline',
                  color: '#ef4444',
                },
              ]
          ).map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Ionicons name={s.icon} size={22} color={s.color} />
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Overview shortcut */}
        <TouchableOpacity
          style={styles.overviewBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Overview')}
        >
          <Ionicons name="stats-chart-outline" size={18} color={PRIMARY} />
          <Text style={styles.overviewTxt}>View Full College Overview</Text>
          <Ionicons name="chevron-forward" size={18} color={PRIMARY} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.overviewBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('PrincipalClassPulse')}
        >
          <Ionicons name="film-outline" size={18} color={PRIMARY} />
          <Text style={styles.overviewTxt}>ClassPulse — All Departments</Text>
          <Ionicons name="chevron-forward" size={18} color={PRIMARY} />
        </TouchableOpacity>

        {/* Departments */}
        <Text style={styles.sectionTitle}>Departments</Text>
        {departments.map((dept, i) => {
          const pct = dept.avg_percentage ?? dept.percentage ?? 0;
          const color = pctColor(pct);
          return (
            <TouchableOpacity
              key={dept.id ?? i}
              style={styles.deptCard}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Departments', { department: dept })}
            >
              <View style={styles.deptHeader}>
                <Text style={styles.deptName}>{dept.name ?? '—'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.deptPct, { color }]}>{pct.toFixed(0)}%</Text>
                  {pct < 65 && <Ionicons name="warning" size={14} color="#ef4444" />}
                </View>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${Math.min(pct, 100)}%`, backgroundColor: color },
                  ]}
                />
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Send alert */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>College-wide Alert</Text>
        <View style={styles.alertCard}>
          <TextInput
            style={styles.alertInput}
            placeholder="Type alert message…"
            placeholderTextColor="#94a3b8"
            value={alertText}
            onChangeText={setAlertText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.alertBtn, (!alertText.trim() || sending) && { opacity: 0.5 }]}
            onPress={sendAlert}
            disabled={!alertText.trim() || sending}
            activeOpacity={0.85}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="megaphone-outline" size={18} color="#fff" />
                <Text style={styles.alertBtnText}>Send Alert</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  centred: { justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 20, paddingBottom: 40 },

  collegeName: { fontSize: 22, fontWeight: '800', color: PRIMARY },
  principalSub: { fontSize: 13, color: '#64748b', marginBottom: 18 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 12 },

  statsRow: { gap: 10, marginBottom: 24 },
  statCard: {
    width: 100,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statValue: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: 10, color: '#64748b', fontWeight: '700' },

  deptCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 10,
  },
  deptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  deptName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  deptPct: { fontSize: 16, fontWeight: '900' },
  barTrack: { height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },

  alertCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  overviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    marginBottom: 18,
  },
  overviewTxt: { flex: 1, fontSize: 14, fontWeight: '700', color: PRIMARY },
  alertInput: {
    fontSize: 14,
    color: '#1e293b',
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 12,
    lineHeight: 20,
  },
  alertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: PRIMARY,
    borderRadius: 12,
    height: 46,
  },
  alertBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
