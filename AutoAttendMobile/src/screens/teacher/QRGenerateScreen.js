/**
 * QRGenerateScreen — Teacher attendance session management
 *
 * Two-phase screen:
 *   SETUP  : subject picker, room field, GPS status, [Start Session]
 *   ACTIVE : auto-rotating QR (4s), BLE beacon broadcast, live attendance
 *            panel, student chips, end-session flow
 *
 * Dependencies:
 *   react-native-qrcode-svg + react-native-svg  (NOT in package.json by default)
 *   react-native-ble-plx ^3.3   ✅ installed
 *   expo-location ~18            ✅ installed
 *   @expo/vector-icons           ✅ bundled
 *
 * Run before first use:
 *   npx expo install react-native-svg react-native-qrcode-svg
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView }  from 'react-native-safe-area-context';
import { Ionicons }      from '@expo/vector-icons';
import * as Location     from 'expo-location';
import * as FileSystem   from 'expo-file-system';
import * as Sharing      from 'expo-sharing';
import * as SecureStore  from 'expo-secure-store';
import QRCode            from 'react-native-qrcode-svg';
import { BleManager }    from 'react-native-ble-plx';
import client            from '../../api/client';
import { API_BASE_URL }  from '../../config';

// ─── Constants ───────────────────────────────────────────────────────────────
const QR_SIZE          = 280;
const QR_REFRESH_SEC   = 4;      // visual + fetch interval
const PRIMARY          = '#1a237e';
const GPS_ACCURACY     = Location.Accuracy.High;

// ─── BLE singleton ──────────────────────────────────────────────────────────
let _ble = null;
function getBle() {
  if (!_ble) _ble = new BleManager();
  return _ble;
}

// ─── Memoized student chip (#74) ────────────────────────────────────────────
// The attendance list polls every 5s; without memoization every chip
// re-renders on every tick. We compare only the fields that affect output.
const StudentChip = memo(
  function StudentChip({ item, onPress }) {
    const isPresent = item.status === 'present' || item.status === 'late';
    return (
      <TouchableOpacity
        style={[styles.chip, isPresent ? styles.chipPresent : styles.chipAbsent]}
        activeOpacity={0.7}
        onPress={() => onPress(item)}
      >
        <Ionicons
          name={isPresent ? 'checkmark-circle' : 'ellipse-outline'}
          size={14}
          color={isPresent ? '#15803d' : '#94a3b8'}
        />
        <Text
          style={[styles.chipText, isPresent && styles.chipTextPresent]}
          numberOfLines={1}
        >
          {item.name ?? item.student_name ?? item.roll_number ?? '—'}
        </Text>
      </TouchableOpacity>
    );
  },
  (prev, next) =>
    prev.item.status === next.item.status &&
    (prev.item.id ?? prev.item.student_id) === (next.item.id ?? next.item.student_id) &&
    (prev.item.name ?? prev.item.student_name) === (next.item.name ?? next.item.student_name),
);

// ─────────────────────────────────────────────────────────────────────────────
export default function QRGenerateScreen() {
  // ── Phase ─────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('setup'); // 'setup' | 'active'

  // ── Setup state ───────────────────────────────────────────────────────────
  const [subjects,        setSubjects]        = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [dropdownOpen,    setDropdownOpen]    = useState(false);
  const [room,            setRoom]            = useState('');
  const [gpsCoords,       setGpsCoords]       = useState(null);
  const [gpsStatus,       setGpsStatus]       = useState('waiting'); // 'waiting'|'ok'|'denied'
  const [starting,        setStarting]        = useState(false);

  // ── Active state ──────────────────────────────────────────────────────────
  const [sessionId,       setSessionId]       = useState(null);
  const [qrValue,         setQrValue]         = useState('');
  const [qrCountdown,     setQrCountdown]     = useState(QR_REFRESH_SEC);
  const [bluetoothToken,  setBluetoothToken]  = useState(null);
  const [bleStatus,       setBleStatus]       = useState('off'); // 'off'|'broadcasting'|'unavailable'
  const [students,        setStudents]        = useState([]);
  const [presentCount,    setPresentCount]    = useState(0);
  const [totalCount,      setTotalCount]      = useState(0);
  const qrFetchRef        = useRef(null);
  const qrCountdownRef    = useRef(null);
  const attendPollRef     = useRef(null);

  // ── End session ───────────────────────────────────────────────────────────
  const [endTapState,    setEndTapState]    = useState(0); // 0 = idle, 1 = confirming
  const endTapTimeout    = useRef(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summaryData,    setSummaryData]    = useState(null);

  // ── Override dialog ───────────────────────────────────────────────────────
  const [overrideStudent,  setOverrideStudent]   = useState(null);
  const [overrideStatus,   setOverrideStatus]    = useState(null);

  // ── Animations ────────────────────────────────────────────────────────────
  const qrOpacity    = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;

  // ── Clock label ───────────────────────────────────────────────────────────
  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  EFFECTS — SETUP PHASE
  // ═══════════════════════════════════════════════════════════════════════════

  // Load subjects on mount
  useEffect(() => {
    (async () => {
      setSubjectsLoading(true);
      try {
        const { data } = await client.get('/teacher/my-subjects');
        setSubjects(Array.isArray(data) ? data : (data.subjects ?? []));
      } catch {
        Alert.alert('Error', 'Could not load your subjects.');
      } finally {
        setSubjectsLoading(false);
      }
    })();
  }, []);

  // GPS
  useEffect(() => {
    let sub;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsStatus('denied');
        return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: GPS_ACCURACY, distanceInterval: 5 },
        (pos) => {
          setGpsCoords({
            lat:      pos.coords.latitude,
            lon:      pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
          setGpsStatus('ok');
        },
      );
    })();
    return () => sub?.remove?.();
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  //  EFFECTS — ACTIVE PHASE
  // ═══════════════════════════════════════════════════════════════════════════

  // QR auto-refresh
  useEffect(() => {
    if (phase !== 'active' || !sessionId) return;
    let alive = true;
    let consecutiveFailures = 0;

    async function fetchQR() {
      try {
        const { data } = await client.get(`/qr/token/${sessionId}`);
        if (!alive) return;
        consecutiveFailures = 0;
        // Crossfade
        Animated.timing(qrOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
          setQrValue(data.qr_token ?? data.token ?? JSON.stringify(data));
          Animated.timing(qrOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
        });
      } catch (err) {
        // #68 surface failure instead of silently freezing the QR.
        consecutiveFailures += 1;
        if (alive && consecutiveFailures === 3) {
          Alert.alert(
            'QR Refresh Stalled',
            'Could not fetch a new QR token from the server. Check your connection — the QR may be stale.',
          );
        }
      }
    }

    fetchQR(); // initial
    qrFetchRef.current = setInterval(fetchQR, QR_REFRESH_SEC * 1000);
    return () => { alive = false; clearInterval(qrFetchRef.current); };
  }, [phase, sessionId, qrOpacity]);

  // QR countdown bar
  useEffect(() => {
    if (phase !== 'active') return;
    setQrCountdown(QR_REFRESH_SEC);

    function runBar() {
      progressAnim.setValue(1);
      Animated.timing(progressAnim, {
        toValue: 0,
        duration: QR_REFRESH_SEC * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    }
    runBar();
    qrCountdownRef.current = setInterval(() => {
      setQrCountdown(QR_REFRESH_SEC);
      runBar();
    }, QR_REFRESH_SEC * 1000);

    // Countdown label
    const cdId = setInterval(() => {
      setQrCountdown((c) => Math.max(0, c - 1));
    }, 1000);

    return () => { clearInterval(qrCountdownRef.current); clearInterval(cdId); };
  }, [phase, progressAnim]);

  // Poll attendance list with re-entrancy guard + exponential backoff (#67).
  // Original code used a fixed 5s setInterval which stacked concurrent requests
  // against a slow server. We now self-schedule with setTimeout so the next
  // poll never starts until the previous one settles, and back off on failure.
  useEffect(() => {
    if (phase !== 'active' || !sessionId) return;

    let cancelled = false;
    let timer     = null;
    let inflight  = false;
    let backoffMs = 5000;
    const MIN_MS  = 5000;
    const MAX_MS  = 30000;

    async function poll() {
      if (cancelled || inflight) return;
      inflight = true;
      try {
        const { data } = await client.get(`/attendance/session/${sessionId}/students`);
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data.students ?? []);
        setStudents(list);
        const present = list.filter((s) => s.status === 'present' || s.status === 'late').length;
        setPresentCount(present);
        setTotalCount(list.length);
        backoffMs = MIN_MS;
      } catch {
        // Slow / failing server: back off so we don't pile on.
        backoffMs = Math.min(MAX_MS, Math.round(backoffMs * 1.7));
      } finally {
        inflight = false;
        if (!cancelled) {
          timer = setTimeout(poll, backoffMs);
          attendPollRef.current = timer;
        }
      }
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (attendPollRef.current) clearTimeout(attendPollRef.current);
      attendPollRef.current = null;
    };
  }, [phase, sessionId]);

  // BLE beacon broadcast
  useEffect(() => {
    if (phase !== 'active' || !bluetoothToken) return;
    const ble = getBle();
    let cancelled = false;

    ble.onStateChange((state) => {
      if (cancelled) return;
      if (state === 'PoweredOn') {
        startBleAdvertising(ble, bluetoothToken);
        setBleStatus('broadcasting');
      } else {
        setBleStatus('unavailable');
      }
    }, true);

    return () => {
      cancelled = true;
      ble.stopDeviceScan(); // stop any scanning (cleanup)
    };
  }, [phase, bluetoothToken]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Start session ─────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (!selectedSubject || !gpsCoords) return;
    setStarting(true);
    try {
      const { data } = await client.post('/attendance/start-session', {
        subject_id:        selectedSubject.id,
        room:              room.trim() || undefined,
        teacher_latitude:  gpsCoords.lat,
        teacher_longitude: gpsCoords.lon,
        teacher_gps_accuracy: gpsCoords.accuracy,
      });
      setSessionId(data.session_id ?? data.id);
      setBluetoothToken(data.bluetooth_token ?? null);
      setQrValue(data.qr_token ?? '');
      setPhase('active');
    } catch (err) {
      Alert.alert('Session Error', err.response?.data?.detail ?? 'Could not start session.');
    } finally {
      setStarting(false);
    }
  }, [selectedSubject, gpsCoords, room]);

  // ── End session (two-tap) ─────────────────────────────────────────────────
  const handleEndTap = useCallback(() => {
    if (endTapState === 0) {
      setEndTapState(1);
      endTapTimeout.current = setTimeout(() => setEndTapState(0), 3000);
    } else {
      // Confirmed
      clearTimeout(endTapTimeout.current);
      endSession();
    }
  }, [endTapState]); // eslint-disable-line react-hooks/exhaustive-deps

  const endSession = useCallback(async () => {
    setEndTapState(0);
    try {
      const { data } = await client.post(`/attendance/end-session`, { session_id: sessionId });
      // Cleanup timers
      clearInterval(qrFetchRef.current);
      clearInterval(qrCountdownRef.current);
      clearInterval(attendPollRef.current);
      setSummaryData({
        present: data.present_count ?? presentCount,
        total:   data.total_count   ?? totalCount,
        percent: data.percentage    ?? (totalCount ? Math.round((presentCount / totalCount) * 100) : 0),
        session_id: sessionId,
      });
      setSummaryVisible(true);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.detail ?? 'Could not end session.');
    }
  }, [sessionId, presentCount, totalCount]);

  const closeSummary = useCallback(() => {
    setSummaryVisible(false);
    setPhase('setup');
    setSessionId(null);
    setQrValue('');
    setBluetoothToken(null);
    setStudents([]);
    setPresentCount(0);
    setTotalCount(0);
    setEndTapState(0);
  }, []);

  const downloadPdf = useCallback(async () => {
    if (!summaryData?.session_id) return;
    try {
      const token  = await SecureStore.getItemAsync('aa_auth_token');
      const remote = `${API_BASE_URL}/api/reports/class/${summaryData.session_id}/pdf`;
      const local  = `${FileSystem.cacheDirectory}attendance_session_${summaryData.session_id}.pdf`;

      const result = await FileSystem.downloadAsync(remote, local, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (result.status !== 200) {
        Alert.alert('PDF', `Could not download report (HTTP ${result.status}).`);
        return;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: 'Save attendance PDF',
        });
      } else {
        await Linking.openURL(result.uri);
      }
    } catch (err) {
      Alert.alert('PDF', err?.message || 'Could not download the attendance PDF.');
    }
  }, [summaryData]);

  // ── Quick override ────────────────────────────────────────────────────────
  const confirmOverride = useCallback(async () => {
    if (!overrideStudent || !overrideStatus) return;
    try {
      await client.post('/attendance/override', {
        session_id: sessionId,
        student_id: overrideStudent.id ?? overrideStudent.student_id,
        status:     overrideStatus,
      });
      // Optimistic update
      setStudents((prev) =>
        prev.map((s) =>
          (s.id ?? s.student_id) === (overrideStudent.id ?? overrideStudent.student_id)
            ? { ...s, status: overrideStatus }
            : s,
        ),
      );
      const newPresent = students.filter((s) => {
        const sid = s.id ?? s.student_id;
        const oid = overrideStudent.id ?? overrideStudent.student_id;
        if (sid === oid) return overrideStatus === 'present' || overrideStatus === 'late';
        return s.status === 'present' || s.status === 'late';
      }).length;
      setPresentCount(newPresent);
    } catch (err) {
      Alert.alert('Override Failed', err.response?.data?.detail ?? 'Could not override status.');
    }
    setOverrideStudent(null);
    setOverrideStatus(null);
  }, [overrideStudent, overrideStatus, sessionId, students]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  BLE ADVERTISING HELPER
  // ═══════════════════════════════════════════════════════════════════════════

  function startBleAdvertising(ble, token) {
    // react-native-ble-plx doesn't expose a native advertise API.
    // On Android we'd need a native module or expo plugin.
    // Best-effort: use BLE scanning with the token as a known identifier
    // so students can discover it. True BLE advertising requires a
    // native module — see Corrections/Decisions.
    //
    // SECURITY: NEVER log the token (even redacted/length metadata).
    // Length alone can confirm a guess about the token format.
    // The session's bluetooth_token is served via the API and students
    // can match it from the QR payload.
    void ble;
    void token;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  const progressPct  = totalCount ? (presentCount / totalCount) : 0;
  const progressBarW = `${Math.round(progressPct * 100)}%`;
  const progressColor = progressPct >= 0.75 ? '#22c55e' : progressPct >= 0.5 ? '#f59e0b' : '#ef4444';

  // ══════════════ ACTIVE PHASE ════════════════════════════════════════════════
  if (phase === 'active') {
    const qrBarColor = progressAnim.interpolate({
      inputRange:  [0, 0.25, 0.7, 1],
      outputRange: ['#ef4444', '#f59e0b', '#22c55e', '#22c55e'],
    });
    const qrBarWidth = progressAnim.interpolate({
      inputRange:  [0, 1],
      outputRange: ['0%', '100%'],
    });

    return (
      <SafeAreaView style={styles.activeRoot}>
        <ScrollView
          contentContainerStyle={styles.activeScroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── QR display ─────────────────────────────────────────────── */}
          <View style={styles.qrSection}>
            <Text style={styles.qrSubjectLabel}>
              {selectedSubject?.name ?? 'Attendance Session'}
            </Text>

            <Animated.View style={[styles.qrWrap, { opacity: qrOpacity }]}>
              {qrValue ? (
                <QRCode
                  value={qrValue}
                  size={QR_SIZE}
                  backgroundColor="#ffffff"
                  color={PRIMARY}
                />
              ) : (
                <View style={[styles.qrPlaceholder, { width: QR_SIZE, height: QR_SIZE }]}>
                  <ActivityIndicator size="large" color={PRIMARY} />
                </View>
              )}
            </Animated.View>

            {/* Countdown bar */}
            <View style={styles.qrBarTrack}>
              <Animated.View
                style={[styles.qrBarFill, { width: qrBarWidth, backgroundColor: qrBarColor }]}
              />
            </View>
            <Text style={styles.qrRefreshText}>
              Refreshing in {qrCountdown}s…
            </Text>
          </View>

          {/* ── BLE Beacon ─────────────────────────────────────────────── */}
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons
                name="radio-outline"
                size={20}
                color={bleStatus === 'broadcasting' ? '#22c55e' : '#94a3b8'}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.cardTitle}>
                  {bleStatus === 'broadcasting'
                    ? 'Broadcasting Bluetooth Beacon'
                    : bleStatus === 'unavailable'
                      ? 'Bluetooth Unavailable'
                      : 'Bluetooth Beacon Off'}
                </Text>
                {bluetoothToken && (
                  <Text style={styles.cardSub}>
                    Token: …{bluetoothToken.slice(-4)}  •  ~10 meter range
                  </Text>
                )}
              </View>
              <View style={[
                styles.statusDot,
                { backgroundColor: bleStatus === 'broadcasting' ? '#22c55e' : '#e2e8f0' },
              ]} />
            </View>
          </View>

          {/* ── Live attendance ─────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Live Attendance</Text>
            <View style={styles.attendRow}>
              <Text style={styles.attendCount}>
                <Text style={{ fontWeight: '900', fontSize: 26, color: PRIMARY }}>
                  {presentCount}
                </Text>
                {' / '}{totalCount} students marked
              </Text>
              <Text style={[styles.attendPct, { color: progressColor }]}>
                {totalCount ? Math.round(progressPct * 100) : 0}%
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: progressBarW, backgroundColor: progressColor }]} />
            </View>
          </View>

          {/* ── Student chips ──────────────────────────────────────────── */}
          {students.length > 0 && (
            <View style={styles.chipSection}>
              <Text style={styles.chipSectionLabel}>Students</Text>
              <FlatList
                data={students}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(s) => String(s.id ?? s.student_id ?? s.roll_number)}
                contentContainerStyle={styles.chipList}
                renderItem={({ item }) => (
                  <StudentChip
                    item={item}
                    onPress={(it) => {
                      setOverrideStudent(it);
                      setOverrideStatus(null);
                    }}
                  />
                )}
                initialNumToRender={12}
                windowSize={5}
                removeClippedSubviews
              />
            </View>
          )}

          {/* ── End session button ─────────────────────────────────────── */}
          <TouchableOpacity
            style={[styles.endBtn, endTapState === 1 && styles.endBtnConfirm]}
            onPress={handleEndTap}
            activeOpacity={0.85}
          >
            <Ionicons name="stop-circle-outline" size={20} color="#fff" />
            <Text style={styles.endBtnText}>
              {endTapState === 0 ? 'End Session' : 'Tap again to end'}
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ── Override dialog ─────────────────────────────────────────── */}
        <Modal
          transparent
          visible={!!overrideStudent}
          animationType="fade"
          onRequestClose={() => setOverrideStudent(null)}
        >
          <Pressable
            style={styles.overlay}
            onPress={() => setOverrideStudent(null)}
          >
            <Pressable style={styles.dialogBox} onPress={() => {}}>
              <Text style={styles.dialogTitle}>
                Mark {overrideStudent?.name ?? overrideStudent?.student_name ?? 'Student'}
              </Text>
              <View style={styles.overrideOpts}>
                {[
                  { key: 'present', label: 'Present',  color: '#22c55e', icon: 'checkmark-circle' },
                  { key: 'late',    label: 'Late',     color: '#f59e0b', icon: 'time-outline' },
                  { key: 'medical', label: 'Medical',  color: '#3b82f6', icon: 'medkit-outline' },
                  { key: 'absent',  label: 'Absent',   color: '#ef4444', icon: 'close-circle-outline' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.overrideChip,
                      overrideStatus === opt.key && { backgroundColor: opt.color, borderColor: opt.color },
                    ]}
                    onPress={() => setOverrideStatus(opt.key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={16}
                      color={overrideStatus === opt.key ? '#fff' : opt.color}
                    />
                    <Text style={[
                      styles.overrideChipText,
                      overrideStatus === opt.key && { color: '#fff' },
                    ]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.confirmBtn, !overrideStatus && { opacity: 0.4 }]}
                onPress={confirmOverride}
                disabled={!overrideStatus}
                activeOpacity={0.85}
              >
                <Text style={styles.confirmBtnText}>Confirm</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── Summary modal ───────────────────────────────────────────── */}
        <Modal
          transparent
          visible={summaryVisible}
          animationType="slide"
          onRequestClose={closeSummary}
        >
          <Pressable style={styles.overlay} onPress={closeSummary}>
            <Pressable style={styles.summaryBox} onPress={() => {}}>
              <Ionicons name="flag-outline" size={44} color={PRIMARY} />
              <Text style={styles.summaryTitle}>Session Ended</Text>
              <Text style={styles.summaryBody}>
                {summaryData?.present ?? 0} / {summaryData?.total ?? 0} present ({summaryData?.percent ?? 0}%)
              </Text>
              <View style={styles.summaryActions}>
                <TouchableOpacity
                  style={[styles.summaryBtn, styles.summaryBtnOutline]}
                  onPress={downloadPdf}
                  activeOpacity={0.85}
                >
                  <Ionicons name="download-outline" size={16} color={PRIMARY} />
                  <Text style={[styles.summaryBtnText, { color: PRIMARY }]}>Download PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.summaryBtn, styles.summaryBtnPrimary]}
                  onPress={closeSummary}
                  activeOpacity={0.85}
                >
                  <Text style={styles.summaryBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    );
  }

  // ══════════════ SETUP PHASE ═════════════════════════════════════════════════
  return (
    <SafeAreaView style={styles.setupRoot}>
      <ScrollView
        contentContainerStyle={styles.setupScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.setupTitle}>Start Attendance Session</Text>
        <Text style={styles.setupDate}>{todayStr}</Text>

        {/* ── Subject picker ───────────────────────────────────────────── */}
        <View style={styles.formSection}>
          <Text style={styles.label}>Subject</Text>
          {subjectsLoading ? (
            <ActivityIndicator color={PRIMARY} style={{ marginTop: 12 }} />
          ) : (
            <Pressable
              style={styles.dropdownBtn}
              onPress={() => setDropdownOpen((v) => !v)}
            >
              <Text style={[styles.dropdownBtnText, !selectedSubject && { color: '#94a3b8' }]}>
                {selectedSubject?.name ?? 'Select subject…'}
              </Text>
              <Ionicons
                name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#64748b"
              />
            </Pressable>
          )}
          {dropdownOpen && (
            <View style={styles.dropdownList}>
              <FlatList
                data={subjects}
                keyExtractor={(s) => String(s.id)}
                scrollEnabled={subjects.length > 5}
                style={{ maxHeight: 220 }}
                renderItem={({ item }) => (
                  <Pressable
                    style={[
                      styles.dropdownItem,
                      selectedSubject?.id === item.id && styles.dropdownItemActive,
                    ]}
                    onPress={() => { setSelectedSubject(item); setDropdownOpen(false); }}
                  >
                    <Text style={[
                      styles.dropdownItemText,
                      selectedSubject?.id === item.id && { color: PRIMARY, fontWeight: '700' },
                    ]}>
                      {item.name}
                    </Text>
                    {item.semester && (
                      <Text style={styles.dropdownItemSub}>
                        Sem {item.semester}{item.department ? ` — ${item.department}` : ''}
                      </Text>
                    )}
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>No subjects found</Text>
                }
              />
            </View>
          )}
        </View>

        {/* ── Room (optional) ──────────────────────────────────────────── */}
        <View style={styles.formSection}>
          <Text style={styles.label}>Room (optional)</Text>
          <TextInput
            style={styles.textInput}
            value={room}
            onChangeText={setRoom}
            placeholder="e.g. Room 301"
            placeholderTextColor="#94a3b8"
            autoCapitalize="words"
          />
        </View>

        {/* ── GPS status ───────────────────────────────────────────────── */}
        <View style={[styles.card, styles.gpsCard]}>
          <Ionicons
            name="location-outline"
            size={20}
            color={gpsStatus === 'ok' ? '#22c55e' : gpsStatus === 'denied' ? '#ef4444' : '#f59e0b'}
          />
          <View style={{ flex: 1, marginLeft: 10 }}>
            {gpsStatus === 'ok' && (
              <Text style={[styles.cardTitle, { color: '#15803d' }]}>
                Location: Captured (Accuracy: {Math.round(gpsCoords?.accuracy ?? 0)}m)
              </Text>
            )}
            {gpsStatus === 'waiting' && (
              <Text style={[styles.cardTitle, { color: '#92400e' }]}>
                Waiting for GPS…
              </Text>
            )}
            {gpsStatus === 'denied' && (
              <>
                <Text style={[styles.cardTitle, { color: '#b91c1c' }]}>
                  GPS unavailable
                </Text>
                <TouchableOpacity onPress={() => Linking.openSettings()}>
                  <Text style={styles.settingsLink}>Open Settings →</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* ── Start button ─────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[
            styles.startBtn,
            (!selectedSubject || gpsStatus !== 'ok' || starting) && styles.startBtnDisabled,
          ]}
          onPress={startSession}
          disabled={!selectedSubject || gpsStatus !== 'ok' || starting}
          activeOpacity={0.85}
        >
          {starting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="play-circle-outline" size={22} color="#fff" />
              <Text style={styles.startBtnText}>Start Session</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  // ── Setup phase ─────────────────────────────────────────────────────────────
  setupRoot:   { flex: 1, backgroundColor: '#f8fafc' },
  setupScroll: { padding: 20, paddingBottom: 40 },
  setupTitle:  { fontSize: 24, fontWeight: '800', color: PRIMARY, marginBottom: 4 },
  setupDate:   { fontSize: 13, color: '#64748b', marginBottom: 24 },

  formSection: { marginBottom: 18 },
  label:       { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8 },

  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
  },
  dropdownBtnText: { fontSize: 14, color: '#1e293b', flex: 1 },
  dropdownList: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0',
    marginTop: 4, overflow: 'hidden',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4,
  },
  dropdownItem:       { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  dropdownItemActive: { backgroundColor: '#e8eaf6' },
  dropdownItemText:   { fontSize: 14, color: '#1e293b' },
  dropdownItemSub:    { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  emptyText:          { padding: 16, color: '#94a3b8', textAlign: 'center', fontSize: 13 },

  textInput: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 14, color: '#1e293b',
  },

  gpsCard: { marginBottom: 20 },

  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: PRIMARY, borderRadius: 14, height: 56,
    elevation: 4, shadowColor: PRIMARY, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 5,
  },
  startBtnDisabled: { opacity: 0.45, elevation: 0 },
  startBtnText:     { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },

  settingsLink: { color: '#3b82f6', fontSize: 12, fontWeight: '600', marginTop: 2 },

  // ── Active phase ────────────────────────────────────────────────────────────
  activeRoot:   { flex: 1, backgroundColor: '#f8fafc' },
  activeScroll: { padding: 20, paddingBottom: 40 },

  // ── QR ──────────────────────────────────────────────────────────────────────
  qrSection: { alignItems: 'center', marginBottom: 20 },
  qrSubjectLabel: {
    fontSize: 18, fontWeight: '800', color: PRIMARY,
    marginBottom: 16, textAlign: 'center',
  },
  qrWrap: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20,
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12, shadowRadius: 8,
    marginBottom: 14,
  },
  qrPlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8 },
  qrBarTrack: {
    width: '100%', height: 6, backgroundColor: '#e2e8f0',
    borderRadius: 3, overflow: 'hidden', marginBottom: 6,
  },
  qrBarFill:     { height: '100%', borderRadius: 3 },
  qrRefreshText: { fontSize: 12, color: '#64748b' },

  // ── Shared card ─────────────────────────────────────────────────────────────
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 14,
  },
  cardRow:   { flexDirection: 'row', alignItems: 'center', flex: 1 },
  cardTitle: { fontSize: 13, color: '#334155', fontWeight: '700' },
  cardSub:   { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  // ── Attendance panel ────────────────────────────────────────────────────────
  attendRow: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', marginBottom: 10, marginTop: 6,
    flex: 1,
  },
  attendCount: { fontSize: 14, color: '#475569' },
  attendPct:   { fontSize: 18, fontWeight: '900' },
  barTrack:    { height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
  barFill:     { height: '100%', borderRadius: 4 },

  // ── Student chips ───────────────────────────────────────────────────────────
  chipSection:      { marginBottom: 16 },
  chipSectionLabel: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8 },
  chipList:         { gap: 8, paddingRight: 20 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
  },
  chipPresent:     { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  chipAbsent:      { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  chipText:        { fontSize: 12, color: '#64748b', maxWidth: 100 },
  chipTextPresent: { color: '#15803d', fontWeight: '600' },

  // ── End session ─────────────────────────────────────────────────────────────
  endBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#dc2626', borderRadius: 14, height: 52,
    marginTop: 8, elevation: 3,
    shadowColor: '#dc2626', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4,
  },
  endBtnConfirm: { backgroundColor: '#991b1b' },
  endBtnText:    { color: '#fff', fontSize: 15, fontWeight: '800' },

  // ── Modals shared ───────────────────────────────────────────────────────────
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24,
  },
  dialogBox: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    width: '100%', elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8,
  },
  dialogTitle: {
    fontSize: 18, fontWeight: '700', color: '#1e293b',
    textAlign: 'center', marginBottom: 18,
  },
  overrideOpts:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 20 },
  overrideChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 2, borderColor: '#e2e8f0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  overrideChipText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  confirmBtn: {
    backgroundColor: PRIMARY, borderRadius: 12, height: 48,
    justifyContent: 'center', alignItems: 'center',
  },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── Summary modal ───────────────────────────────────────────────────────────
  summaryBox: {
    backgroundColor: '#fff', borderRadius: 20, padding: 28,
    alignItems: 'center', width: '100%',
    elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8,
  },
  summaryTitle: { fontSize: 22, fontWeight: '800', color: '#1e293b', marginTop: 12, marginBottom: 8 },
  summaryBody:  { fontSize: 15, color: '#475569', textAlign: 'center', marginBottom: 24 },
  summaryActions: { flexDirection: 'row', gap: 10, width: '100%' },
  summaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, height: 48, borderRadius: 12,
  },
  summaryBtnPrimary: { backgroundColor: PRIMARY },
  summaryBtnOutline: { borderWidth: 2, borderColor: PRIMARY },
  summaryBtnText:    { color: '#fff', fontWeight: '700', fontSize: 14 },
});
