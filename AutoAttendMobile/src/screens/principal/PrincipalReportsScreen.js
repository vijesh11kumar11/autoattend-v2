/**
 * Principal — College Reports Screen
 * Download college-wide reports (monthly Excel, defaulters PDF).
 * APIs: GET /api/reports/monthly-excel
 *       GET /api/reports/defaulters-pdf
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { downloadAndShare } from '../../utils/secureDownload';

const PRIMARY = '#1a237e';

const REPORTS = [
  {
    id: 'monthly',
    icon: 'calendar-outline',
    title: 'Monthly Attendance Excel',
    sub: 'Comprehensive monthly report across all departments',
    path: '/api/reports/monthly-excel',
    ext: 'xlsx',
  },
  {
    id: 'defaulters',
    icon: 'alert-circle-outline',
    title: 'Defaulters Report (PDF)',
    sub: 'Students below 75% attendance across the college',
    path: '/api/reports/defaulters-pdf',
    ext: 'pdf',
  },
];

export default function PrincipalReportsScreen() {
  const [downloading, setDownloading] = useState(null);

  const handleDownload = async (report) => {
    setDownloading(report.id);
    try {
      await downloadAndShare({
        path: report.path,
        fileName: `college-${report.id}`,
        fallbackExt: report.ext || 'pdf',
        title: `Save ${report.title}`,
      });
    } catch (err) {
      console.warn('[PrincipalReportsScreen] download error:', err?.message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>📊 College Reports</Text>
        <Text style={styles.sub}>Download attendance reports for the entire college.</Text>

        {REPORTS.map((r) => (
          <TouchableOpacity
            key={r.id}
            style={styles.card}
            onPress={() => handleDownload(r)}
            disabled={downloading === r.id}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={r.icon} size={24} color={PRIMARY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{r.title}</Text>
              <Text style={styles.meta}>{r.sub}</Text>
            </View>
            {downloading === r.id ? (
              <ActivityIndicator size="small" color={PRIMARY} />
            ) : (
              <Ionicons name="download-outline" size={22} color={PRIMARY} />
            )}
          </TouchableOpacity>
        ))}

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={18} color="#3b82f6" />
          <Text style={styles.infoTxt}>
            For per-department or per-class reports, visit the web dashboard where advanced filters
            are available.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY },
  sub: { fontSize: 13, color: '#94a3b8', marginBottom: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  infoCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
  },
  infoTxt: { fontSize: 12, color: '#3b82f6', flex: 1, lineHeight: 18 },
});
