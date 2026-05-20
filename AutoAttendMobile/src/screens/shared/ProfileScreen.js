/**
 * ProfileScreen — shared across all roles.
 *
 * Reads identity from `useAuth().user` (decoded JWT payload).
 * Shows device-binding fingerprint from SecureStore so users can verify
 * which physical device this account is bound to.
 *
 * Sign Out triggers a confirm dialog → `logout()` (also clears SecureStore).
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, SafeAreaView, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons }     from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useAuth }      from '../../context/AuthContext';

const PRIMARY = '#1a237e';
const DEVICE_ID_KEY = 'aa_device_id';

const ROLE_LABEL = {
  student:   'Student',
  teacher:   'Teacher / Faculty',
  hod:       'Head of Department',
  principal: 'Principal',
};

const ROLE_COLOR = {
  student:   '#3b82f6',
  teacher:   '#22c55e',
  hod:       '#f97316',
  principal: '#9333ea',
};

function shortDevId(id) {
  if (!id) return '—';
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [deviceId, setDeviceId] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(DEVICE_ID_KEY)
      .then((d) => setDeviceId(d))
      .catch((err) => console.warn('[ProfileScreen] device-id read error:', err?.message))
      .finally(() => setLoading(false));
  }, []);

  const confirmSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
      ],
    );
  };

  if (!user) {
    return (
      <View style={styles.center}><ActivityIndicator size="large" color={PRIMARY} /></View>
    );
  }

  const role        = user.role || 'student';
  const roleLabel   = ROLE_LABEL[role]  ?? role;
  const accentColor = ROLE_COLOR[role]  ?? PRIMARY;
  const initial     = (user.name || user.sub || '?').trim().charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ── Header card ────────────────────────────────────────── */}
        <View style={styles.headerCard}>
          <View style={[styles.avatar, { backgroundColor: accentColor }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name}>{user.name || 'Unknown user'}</Text>
          <View style={[styles.roleBadge, { backgroundColor: `${accentColor}22`, borderColor: accentColor }]}>
            <Text style={[styles.roleBadgeText, { color: accentColor }]}>{roleLabel}</Text>
          </View>
        </View>

        {/* ── Account info ───────────────────────────────────────── */}
        <Text style={styles.section}>Account</Text>
        <View style={styles.card}>
          <InfoRow icon="at-outline"            label={role === 'student' ? 'Roll Number' : 'Email'} value={user.sub || '—'} />
          <Divider />
          <InfoRow icon="business-outline"      label="College ID"     value={user.college_id ? String(user.college_id) : '—'} />
          {user.department_id != null && (
            <>
              <Divider />
              <InfoRow icon="library-outline"   label="Department ID"  value={String(user.department_id)} />
            </>
          )}
          {'face_enrolled' in user && (
            <>
              <Divider />
              <InfoRow
                icon={user.face_enrolled ? 'checkmark-circle' : 'alert-circle-outline'}
                iconColor={user.face_enrolled ? '#22c55e' : '#f97316'}
                label="Face Enrollment"
                value={user.face_enrolled ? 'Completed' : 'Not enrolled'}
              />
            </>
          )}
        </View>

        {/* ── Device binding ─────────────────────────────────────── */}
        <Text style={styles.section}>Device</Text>
        <View style={styles.card}>
          <InfoRow
            icon="phone-portrait-outline"
            label="Device Fingerprint"
            value={loading ? 'Loading…' : shortDevId(deviceId)}
          />
        </View>
        <Text style={styles.helpText}>
          Your account is bound to this device. To change device, contact your HOD.
        </Text>

        {/* ── Sign out ───────────────────────────────────────────── */}
        <TouchableOpacity style={styles.signOutBtn} onPress={confirmSignOut} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={20} color="#ef4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>AutoAttend AI v2.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, iconColor = PRIMARY, label, value }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={iconColor} style={{ marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16, padding: 24,
    alignItems: 'center',
    borderWidth: 1, borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 30, fontWeight: '700' },
  name:       { fontSize: 18, fontWeight: '700', color: '#1e293b', marginBottom: 8, textAlign: 'center' },
  roleBadge:  { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
  roleBadgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

  section: { fontSize: 13, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginTop: 8, marginBottom: 8, marginLeft: 4 },
  card: {
    backgroundColor: '#ffffff', borderRadius: 14,
    borderWidth: 1, borderColor: '#e2e8f0',
    paddingVertical: 6,
  },
  row:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  rowLabel: { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 },
  rowValue: { fontSize: 14, color: '#1e293b', fontWeight: '600', marginTop: 2 },
  divider:  { height: 1, backgroundColor: '#f1f5f9', marginHorizontal: 14 },

  helpText: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 8, marginBottom: 16, paddingHorizontal: 16 },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca',
    borderRadius: 12, paddingVertical: 14, marginTop: 8,
  },
  signOutText: { color: '#ef4444', fontWeight: '700', fontSize: 15, marginLeft: 8 },

  version: { textAlign: 'center', color: '#cbd5e1', fontSize: 11, marginTop: 20 },
});
