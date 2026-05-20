/**
 * StudentDashboard — greeting, today's classes, subject attendance cards
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons }     from '@expo/vector-icons';
import client           from '../../api/client';
import { useAuth }      from '../../context/AuthContext';
import { CardSkeleton, StatsSkeleton } from '../../components/SkeletonLoader';

const PRIMARY = '#1a237e';
const THRESHOLDS = { SAFE: 75, WARNING: 65, CRITICAL: 50 };

function greetingText() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function statusInfo(pct) {
  if (pct >= THRESHOLDS.SAFE)    return { label: 'SAFE',     color: '#22c55e', bg: '#f0fdf4' };
  if (pct >= THRESHOLDS.WARNING) return { label: 'WARNING',  color: '#f59e0b', bg: '#fffbeb' };
  if (pct >= THRESHOLDS.CRITICAL) return { label: 'CRITICAL', color: '#ef4444', bg: '#fef2f2' };
  return { label: 'DETAINED', color: '#dc2626', bg: '#fef2f2' };
}

export default function StudentDashboard({ navigation }) {
  const { user } = useAuth();
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overall,    setOverall]    = useState(0);
  const [subjects,   setSubjects]   = useState([]);
  const [todayClasses, setTodayClasses] = useState([]);
  const [criticalCount, setCriticalCount] = useState(0);

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'short',
  });
  const firstName = (user?.name ?? user?.sub ?? 'Student').split(' ')[0];

  const fetchData = useCallback(async () => {
    try {
      const [dashRes, classesRes] = await Promise.all([
        client.get('/students/dashboard'),
        client.get('/students/today-classes'),
      ]);
      const d = dashRes.data;
      setOverall(d.overall_percentage ?? 0);
      setSubjects(d.subjects ?? []);
      setCriticalCount(
        (d.subjects ?? []).filter((s) => (s.percentage ?? 0) < THRESHOLDS.SAFE).length,
      );
      setTodayClasses(Array.isArray(classesRes.data) ? classesRes.data : (classesRes.data.classes ?? []));
    } catch (err) { console.warn("[StudentDashboard] fetch error:", err?.message); }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <StatsSkeleton count={3} />
        <CardSkeleton count={3} />
      </SafeAreaView>
    );
  }

  const overallStatus = statusInfo(overall);

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{greetingText()}, {firstName}! 👋</Text>
            <Text style={styles.date}>{todayStr}</Text>
          </View>
          <View style={[styles.overallChip, { backgroundColor: overallStatus.bg }]}>
            <Text style={[styles.overallPct, { color: overallStatus.color }]}>
              {overall.toFixed(1)}%
            </Text>
            <Text style={[styles.overallLabel, { color: overallStatus.color }]}>Overall</Text>
          </View>
        </View>

        {/* ── Critical warning ────────────────────────────────────── */}
        {criticalCount > 0 && (
          <TouchableOpacity style={styles.warningCard} activeOpacity={0.85}
            onPress={() => navigation.navigate('Attendance')}
          >
            <Ionicons name="warning-outline" size={20} color="#fff" />
            <Text style={styles.warningText}>
              ⚠️ {criticalCount} subject{criticalCount > 1 ? 's' : ''} below 75%! Tap to view details
            </Text>
          </TouchableOpacity>
        )}

        {/* ── Today's classes ─────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Today's Classes</Text>
        {todayClasses.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color="#cbd5e1" />
            <Text style={styles.emptyText}>No classes scheduled today</Text>
          </View>
        ) : (
          todayClasses.map((c, i) => {
            const hasSession = !!c.session_active;
            return (
              <View key={c.id ?? i} style={styles.classCard}>
                <View style={styles.classTime}>
                  <Text style={styles.classTimeText}>{c.time ?? '—'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.className}>{c.subject_name ?? c.name ?? '—'}</Text>
                  <Text style={styles.classTeacher}>{c.teacher_name ?? ''}</Text>
                </View>
                {hasSession ? (
                  <TouchableOpacity
                    style={styles.markBtn}
                    onPress={() => navigation.navigate('ScanQR')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.markBtnText}>Mark →</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.noSession}>No session</Text>
                )}
              </View>
            );
          })
        )}

        {/* ── Subject cards (horizontal) ──────────────────────────── */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>My Subjects</Text>
        <FlatList
          data={subjects}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(s) => String(s.id ?? s.subject_id)}
          contentContainerStyle={{ paddingRight: 20, gap: 12 }}
          renderItem={({ item }) => {
            const pct = item.percentage ?? 0;
            const st = statusInfo(pct);
            return (
              <View style={[styles.subjectCard, { borderTopColor: st.color }]}>
                <Text style={styles.subCode}>{item.code ?? ''}</Text>
                <Text style={styles.subName} numberOfLines={1}>{item.name ?? '—'}</Text>
                <View style={styles.subBar}>
                  <View style={[styles.subBarFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: st.color }]} />
                </View>
                <Text style={styles.subPct}>{pct.toFixed(0)}%</Text>
                <Text style={styles.subCount}>{item.present ?? 0} / {item.total ?? 0}</Text>
                <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                  <Text style={[styles.statusLabel, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>
            );
          }}
        />

        {/* ── Bottom button ───────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.bottomBtn}
          onPress={() => navigation.navigate('Attendance')}
          activeOpacity={0.85}
        >
          <Ionicons name="bar-chart-outline" size={18} color="#fff" />
          <Text style={styles.bottomBtnText}>View Full Attendance</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomBtn, { backgroundColor: '#0ea5e9', marginTop: 10 }]}
          onPress={() => navigation.navigate('LeaveRequest')}
          activeOpacity={0.85}
        >
          <Ionicons name="document-text-outline" size={18} color="#fff" />
          <Text style={styles.bottomBtnText}>My Leave Requests</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f8fafc' },
  centred: { justifyContent: 'center', alignItems: 'center' },
  scroll:  { padding: 20, paddingBottom: 40 },

  header:     { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  greeting:   { fontSize: 20, fontWeight: '800', color: '#1e293b' },
  date:       { fontSize: 13, color: '#64748b', marginTop: 3 },
  overallChip: {
    alignItems: 'center', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  overallPct:   { fontSize: 18, fontWeight: '900' },
  overallLabel: { fontSize: 10, fontWeight: '700', marginTop: 1 },

  warningCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#ef4444', borderRadius: 12, padding: 14, marginBottom: 18,
  },
  warningText: { color: '#fff', fontWeight: '700', fontSize: 13, flex: 1 },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 12 },

  emptyCard: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyText: { color: '#94a3b8', fontSize: 13 },

  classCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10,
  },
  classTime:     { backgroundColor: '#e8eaf6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginRight: 12 },
  classTimeText: { fontSize: 12, fontWeight: '700', color: PRIMARY },
  className:     { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  classTeacher:  { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  markBtn:       { backgroundColor: PRIMARY, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  markBtnText:   { color: '#fff', fontWeight: '700', fontSize: 12 },
  noSession:     { fontSize: 11, color: '#94a3b8', fontStyle: 'italic' },

  subjectCard: {
    width: 150, backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0', borderTopWidth: 3, gap: 4,
  },
  subCode:  { fontSize: 11, color: '#94a3b8', fontWeight: '700' },
  subName:  { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  subBar:   { height: 6, backgroundColor: '#e2e8f0', borderRadius: 3, marginTop: 4, overflow: 'hidden' },
  subBarFill: { height: '100%', borderRadius: 3 },
  subPct:   { fontSize: 18, fontWeight: '900', color: '#1e293b' },
  subCount: { fontSize: 11, color: '#64748b' },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  statusLabel: { fontSize: 10, fontWeight: '800' },

  bottomBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: PRIMARY, borderRadius: 14, height: 52, marginTop: 24,
    elevation: 3, shadowColor: PRIMARY, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4,
  },
  bottomBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
