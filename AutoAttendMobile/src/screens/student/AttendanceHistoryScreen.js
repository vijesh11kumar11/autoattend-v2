/**
 * AttendanceHistoryScreen — subject filter tabs, month picker, session list, monthly summary
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons }     from '@expo/vector-icons';
import client           from '../../api/client';

const PRIMARY = '#1a237e';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const STATUS_MAP = {
  present: { short: 'P', color: '#22c55e', bg: '#f0fdf4' },
  late:    { short: 'L', color: '#f59e0b', bg: '#fffbeb' },
  medical: { short: 'M', color: '#3b82f6', bg: '#eff6ff' },
  absent:  { short: 'A', color: '#ef4444', bg: '#fef2f2' },
};

export default function AttendanceHistoryScreen() {
  const [subjects,        setSubjects]        = useState([]);
  const [selectedSubject, setSelectedSubject] = useState(null); // null = All
  const [selectedMonth,   setSelectedMonth]   = useState(new Date().getMonth());
  const [records,         setRecords]         = useState([]);
  const [loading,         setLoading]         = useState(true);

  // Load subjects
  useEffect(() => {
    client.get('/students/subjects').then(({ data }) => {
      setSubjects(Array.isArray(data) ? data : (data.subjects ?? []));
    }).catch(() => {});
  }, []);

  // Load attendance records
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = { month: selectedMonth + 1 };
      if (selectedSubject) params.subject_id = selectedSubject.id;
      const { data } = await client.get('/students/attendance-history', { params });
      setRecords(Array.isArray(data) ? data : (data.records ?? []));
    } catch { setRecords([]); }
    setLoading(false);
  }, [selectedSubject, selectedMonth]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Summary counts
  const summary = records.reduce(
    (acc, r) => {
      const s = (r.status ?? '').toLowerCase();
      if (s === 'present') acc.p++;
      else if (s === 'late') acc.l++;
      else if (s === 'absent') acc.a++;
      return acc;
    },
    { p: 0, a: 0, l: 0 },
  );
  const totalSess = summary.p + summary.a + summary.l;
  const monthPct  = totalSess ? Math.round(((summary.p + summary.l) / totalSess) * 100) : 0;

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      {/* ── Subject filter tabs ──────────────────────────────────── */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
      >
        <TouchableOpacity
          style={[styles.tab, !selectedSubject && styles.tabActive]}
          onPress={() => setSelectedSubject(null)}
        >
          <Text style={[styles.tabText, !selectedSubject && styles.tabTextActive]}>All</Text>
        </TouchableOpacity>
        {subjects.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.tab, selectedSubject?.id === s.id && styles.tabActive]}
            onPress={() => setSelectedSubject(s)}
          >
            <Text style={[styles.tabText, selectedSubject?.id === s.id && styles.tabTextActive]}>
              {s.code ?? s.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Month picker ─────────────────────────────────────────── */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.monthRow}
      >
        {MONTHS.map((m, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.monthChip, selectedMonth === i && styles.monthChipActive]}
            onPress={() => setSelectedMonth(i)}
          >
            <Text style={[styles.monthText, selectedMonth === i && styles.monthTextActive]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Records list ──────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.centred}><ActivityIndicator size="large" color={PRIMARY} /></View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(r, i) => String(r.id ?? i)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centred}>
              <Ionicons name="calendar-outline" size={40} color="#cbd5e1" />
              <Text style={styles.emptyText}>No records this month</Text>
            </View>
          }
          renderItem={({ item }) => {
            const s = STATUS_MAP[(item.status ?? '').toLowerCase()] ?? STATUS_MAP.absent;
            const d = item.date ? new Date(item.date) : null;
            return (
              <View style={styles.row}>
                <View style={styles.dateCol}>
                  <Text style={styles.dateDay}>
                    {d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                  </Text>
                  <Text style={styles.dateWeekday}>
                    {d ? d.toLocaleDateString('en-IN', { weekday: 'short' }) : ''}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.rowSubject}>{item.subject_name ?? '—'}</Text>
                  {item.marked_via && (
                    <Text style={styles.rowVia}>via {item.marked_via}</Text>
                  )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: s.bg }]}>
                  <Text style={[styles.statusText, { color: s.color }]}>{s.short}</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ── Monthly summary ───────────────────────────────────────── */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          This month: <Text style={{ color: '#22c55e' }}>{summary.p}P</Text>
          {' '}<Text style={{ color: '#ef4444' }}>{summary.a}A</Text>
          {' '}<Text style={{ color: '#f59e0b' }}>{summary.l}L</Text>
          {' = '}
          <Text style={{ fontWeight: '900' }}>{monthPct}%</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#f8fafc' },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },

  tabRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tab: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#f1f5f9',
  },
  tabActive:     { backgroundColor: PRIMARY },
  tabText:       { fontSize: 13, fontWeight: '700', color: '#64748b' },
  tabTextActive: { color: '#fff' },

  monthRow: { paddingHorizontal: 16, gap: 6, marginBottom: 8 },
  monthChip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 16, backgroundColor: '#f1f5f9',
  },
  monthChipActive: { backgroundColor: '#dbeafe' },
  monthText:       { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  monthTextActive: { color: '#1d4ed8' },

  list:      { paddingHorizontal: 16, paddingBottom: 12 },
  emptyText: { color: '#94a3b8', fontSize: 13, marginTop: 8 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8,
  },
  dateCol:     { alignItems: 'center', width: 52 },
  dateDay:     { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  dateWeekday: { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  rowSubject:  { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  rowVia:      { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  statusText:  { fontSize: 14, fontWeight: '900' },

  summaryBar: {
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0',
    paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center',
  },
  summaryText: { fontSize: 14, fontWeight: '700', color: '#475569' },
});
