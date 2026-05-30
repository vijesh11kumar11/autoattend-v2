/**
 * HODDashboard — department stats, teacher list, quick actions, pending approvals
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
import { ListSkeleton, StatsSkeleton } from '../../components/SkeletonLoader';

const PRIMARY = '#1a237e';

export default function HODDashboard({ navigation }) {
  const { user } = useAuth();
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats,      setStats]      = useState({ teachers: 0, students: 0, avg: 0, pending: 0 });
  const [teachers,   setTeachers]   = useState([]);

  const deptName = user?.department_name ?? 'My Department';

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get('/hod/dashboard');
      setStats({
        teachers: data.teacher_count ?? 0,
        students: data.student_count ?? 0,
        avg:      data.avg_percentage ?? 0,
        pending:  data.pending_count ?? 0,
      });
      setTeachers(data.teachers ?? []);
    } catch (err) { console.warn("[HODDashboard] fetch error:", err?.message); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  if (loading) {
    return <SafeAreaView style={styles.root}><StatsSkeleton /><ListSkeleton /></SafeAreaView>;
  }

  const statCards = [
    { icon: 'people-outline',            label: 'Teachers', value: stats.teachers, color: '#3b82f6' },
    { icon: 'school-outline',            label: 'Students', value: stats.students, color: '#8b5cf6' },
    { icon: 'stats-chart-outline',       label: 'Avg %',    value: `${stats.avg.toFixed(1)}%`, color: stats.avg >= 75 ? '#22c55e' : '#f59e0b' },
    { icon: 'hourglass-outline',         label: 'Pending',  value: stats.pending,  color: '#ef4444' },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[PRIMARY]} />}
      >
        {/* Header */}
        <Text style={styles.deptName}>{deptName}</Text>

        {/* Stats row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
          {statCards.map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Ionicons name={s.icon} size={22} color={s.color} />
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </ScrollView>

        {/* My Teachers */}
        <Text style={styles.sectionTitle}>My Teachers</Text>
        {teachers.length === 0 ? (
          <Text style={styles.emptyText}>No teacher data available</Text>
        ) : (
          teachers.map((t, i) => (
            <View key={t.id ?? i} style={styles.teacherCard}>
              <View style={styles.teacherAvatar}>
                <Ionicons name="person-circle-outline" size={36} color="#94a3b8" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.teacherName}>{t.name ?? '—'}</Text>
                <Text style={styles.teacherSub}>
                  {t.active_session ? '🟢 Active session' : 'No active session'}
                  {t.today_classes ? `  •  ${t.today_classes} classes today` : ''}
                </Text>
              </View>
            </View>
          ))
        )}

        {/* Quick actions */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {[
            { icon: 'alert-circle-outline',  label: 'Defaulters',   onPress: () => navigation.navigate('Reports') },
            { icon: 'megaphone-outline',     label: 'Send Alerts',  onPress: () => navigation.navigate('Alerts') },
            { icon: 'document-text-outline', label: 'Approvals',    onPress: () => navigation.navigate('PendingApprovals'), badge: stats.pending },
          ].map((a, i) => (
            <TouchableOpacity key={i} style={styles.actionBtn} onPress={a.onPress} activeOpacity={0.8}>
              <View style={{ position: 'relative' }}>
                <Ionicons name={a.icon} size={24} color={PRIMARY} />
                {a.badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{a.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.actionsGrid, { marginTop: 10 }]}>
          {[
            { icon: 'calendar-outline',  label: 'Semester Progress', onPress: () => navigation.navigate('SemesterProgress') },
            { icon: 'grid-outline',      label: 'Section Analytics', onPress: () => navigation.navigate('SectionAnalytics') },
            { icon: 'pie-chart-outline', label: 'Dept Overview',     onPress: () => navigation.navigate('DeptOverview') },
          ].map((a, i) => (
            <TouchableOpacity key={i} style={styles.actionBtn} onPress={a.onPress} activeOpacity={0.8}>
              <Ionicons name={a.icon} size={24} color={PRIMARY} />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Management</Text>
        <View style={styles.actionsGrid}>
          {[
            { icon: 'layers-outline',   label: 'Sections',  onPress: () => navigation.navigate('Sections') },
            { icon: 'book-outline',     label: 'Subjects',  onPress: () => navigation.navigate('Subjects') },
            { icon: 'calendar-outline', label: 'Timetable', onPress: () => navigation.navigate('HODTimetable') },
            { icon: 'cloud-upload-outline', label: 'Import Students', onPress: () => navigation.navigate('ExcelImport') },
          ].map((a, i) => (
            <TouchableOpacity key={i} style={styles.actionBtn} onPress={a.onPress} activeOpacity={0.8}>
              <Ionicons name={a.icon} size={24} color={PRIMARY} />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.actionsGrid, { marginTop: 10 }]}>
          {[
            { icon: 'people-circle-outline', label: 'Tutors',         onPress: () => navigation.navigate('TutorManagement') },
            { icon: 'document-outline',      label: 'Reports Hub',    onPress: () => navigation.navigate('HODReportsHome') },
            { icon: 'radio-outline',         label: 'Live Sessions',  onPress: () => navigation.navigate('LiveAnalytics') },
          ].map((a, i) => (
            <TouchableOpacity key={i} style={styles.actionBtn} onPress={a.onPress} activeOpacity={0.8}>
              <Ionicons name={a.icon} size={24} color={PRIMARY} />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.actionsGrid, { marginTop: 10 }]}>
          {[
            { icon: 'trending-up-outline', label: 'Performance', onPress: () => navigation.navigate('TeacherPerformance') },
            { icon: 'shield-outline',      label: 'Disputes',    onPress: () => navigation.navigate('HODDisputes') },
            { icon: 'film-outline',        label: 'ClassPulse',  onPress: () => navigation.navigate('HODClassPulse') },
          ].map((a, i) => (
            <TouchableOpacity key={i} style={styles.actionBtn} onPress={a.onPress} activeOpacity={0.8}>
              <Ionicons name={a.icon} size={24} color={PRIMARY} />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f8fafc' },
  centred: { justifyContent: 'center', alignItems: 'center' },
  scroll:  { padding: 20, paddingBottom: 40 },

  deptName:     { fontSize: 22, fontWeight: '800', color: PRIMARY, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 12 },
  emptyText:    { color: '#94a3b8', fontSize: 13, marginBottom: 12 },

  statsRow: { gap: 10, marginBottom: 24 },
  statCard: {
    width: 100, backgroundColor: '#fff', borderRadius: 14, padding: 14,
    alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  statValue: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: 10, color: '#64748b', fontWeight: '700' },

  teacherCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8,
  },
  teacherAvatar: { marginRight: 10 },
  teacherName:   { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  teacherSub:    { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  actionsGrid: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  actionLabel: { fontSize: 11, fontWeight: '700', color: '#475569', textAlign: 'center' },
  badge: {
    position: 'absolute', top: -6, right: -10,
    backgroundColor: '#ef4444', borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
