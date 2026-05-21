/**
 * ScanQRScreen — AutoAttend AI v2.0
 *
 * State machine:
 *   idle → face_verify → liveness_check → qr_scan → submitting → success | failed
 *
 * HOW IT WORKS END TO END:
 *  1. idle        — student picks subject; BLE scans for classroom beacon
 *  2. face_verify — front camera, auto-capture after 3s or [Capture] tap
 *                   POST /api/face/verify → face_token (30–60s TTL)
 *  3. liveness_check — 3 frames at 0/2/4s
 *                   POST /api/face/liveness-check → pass/fail
 *  4. qr_scan     — barcode scanner, face_token countdown visible
 *                   BLE + GPS captured in background
 *  5. submitting  — POST /api/attendance/mark
 *  6. success / failed — full-screen result
 *
 * Dependencies (all already in package.json):
 *   expo-camera ~16, expo-location ~18
 *   react-native-ble-plx ^3.3, react-native-reanimated ~3.16
 *   @expo/vector-icons (bundled), react-native-safe-area-context,
 *   expo-secure-store (for device_id)
 *
 * expo-face-detector NOT available → timed auto-capture (3s) used instead.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
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
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView }                   from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location                       from 'expo-location';
import * as SecureStore                    from 'expo-secure-store';
import { Ionicons }                        from '@expo/vector-icons';
import { BleManager }                      from 'react-native-ble-plx';
import * as Haptics                        from 'expo-haptics';
import client                              from '../../api/client';
import { useAuth }                         from '../../context/AuthContext';

// ─── Constants ───────────────────────────────────────────────────────────────
const STATES = Object.freeze({
  IDLE:       'idle',
  FACE:       'face_verify',
  LIVENESS:   'liveness_check',
  QR_SCAN:    'qr_scan',
  SUBMITTING: 'submitting',
  SUCCESS:    'success',
  FAILED:     'failed',
});

const LIVENESS_CHALLENGES = ['BLINK NOW', 'SMILE', 'TURN LEFT', 'TURN RIGHT'];
const FACE_CAPTURE_DELAY  = 3;   // seconds before auto-capture
const LIVENESS_FRAMES     = [0, 2, 4]; // seconds to capture frames
const FACE_TOKEN_TTL      = 45;  // seconds shown in countdown
const GPS_DESIRED_ACCURACY = Location.Accuracy.High;

// ─── Singleton BLE manager (recreating it is expensive) ──────────────────────
let _bleManager = null;
function getBleManager() {
  if (!_bleManager) _bleManager = new BleManager();
  return _bleManager;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ScanQRScreen({ navigation }) {
  const { user } = useAuth();

  // ── State machine ─────────────────────────────────────────────────────────
  const [screen,  setScreen]  = useState(STATES.IDLE);

  // ── Subject picker ────────────────────────────────────────────────────────
  const [subjects,        setSubjects]        = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [dropdownOpen,    setDropdownOpen]    = useState(false);
  const [clockStr,        setClockStr]        = useState('');

  // ── Permissions ───────────────────────────────────────────────────────────
  const [camPermission, requestCamPerm] = useCameraPermissions();
  const [locGranted,    setLocGranted]  = useState(false);
  const [bleGranted,    setBleGranted]  = useState(false);

  // ── BLE ───────────────────────────────────────────────────────────────────
  const [beaconDetected,  setBeaconDetected]  = useState(false);
  const [bluetoothToken,  setBluetoothToken]  = useState(null);
  const bleSubscription = useRef(null);

  // ── GPS ───────────────────────────────────────────────────────────────────
  const [gpsCoords, setGpsCoords] = useState(null); // { lat, lon, accuracy }

  // ── Face verify ───────────────────────────────────────────────────────────
  const cameraRef         = useRef(null);
  const [faceSessionId,   setFaceSessionId]   = useState(null);
  const [faceToken,       setFaceToken]        = useState(null);
  const [faceTokenTTL,    setFaceTokenTTL]     = useState(FACE_TOKEN_TTL);
  const [faceCapturing,   setFaceCapturing]    = useState(false);
  const [faceCapCountdown, setFaceCapCountdown] = useState(FACE_CAPTURE_DELAY);

  // ── Liveness ──────────────────────────────────────────────────────────────
  const [livenessChallenge, setLivenessChallenge] = useState('');
  const [livenessCountdown, setLivenessCountdown] = useState(5);
  const livenessFrames    = useRef([]);
  const livenessIntervals = useRef([]);

  // ── QR scan ───────────────────────────────────────────────────────────────
  const [qrScanned, setQrScanned] = useState(false);

  // ── Result ────────────────────────────────────────────────────────────────
  const [successData, setSuccessData] = useState(null);
  const [failureData, setFailureData] = useState(null);

  // ── Animations ────────────────────────────────────────────────────────────
  const successScale = useRef(new Animated.Value(0)).current;
  const spinValue    = useRef(new Animated.Value(0)).current;
  const cornerAnim   = useRef(new Animated.Value(0)).current;

  // ─── Clock tick ───────────────────────────────────────────────────────────
  useEffect(() => {
    function tick() {
      const now = new Date();
      setClockStr(
        now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) +
        '  ' +
        now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      );
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // ─── Load subjects ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setSubjectsLoading(true);
      try {
        const { data } = await client.get('/faculty/subjects/my-classes');
        setSubjects(Array.isArray(data) ? data : (data.subjects ?? []));
      } catch {
        Alert.alert('Error', 'Could not load your subjects. Check your connection.');
      } finally {
        setSubjectsLoading(false);
      }
    })();
  }, []);

  // ─── GPS permission + tracking ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocGranted(true);
        Location.watchPositionAsync(
          { accuracy: GPS_DESIRED_ACCURACY, distanceInterval: 5 },
          (pos) => setGpsCoords({
            lat:      pos.coords.latitude,
            lon:      pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        );
      }
    })();
  }, []);

  // ─── BLE scan (idle screen, keeps running) ─────────────────────────────────
  useEffect(() => {
    const ble = getBleManager();
    ble.onStateChange((state) => {
      if (state === 'PoweredOn') {
        setBleGranted(true);
        bleSubscription.current = ble.startDeviceScan(null, null, (err, device) => {
          if (err) return;
          // Match devices whose name or service data contains 'AUTOATTEND'
          const name = (device?.name ?? device?.localName ?? '').toUpperCase();
          if (name.includes('AUTOATTEND')) {
            setBeaconDetected(true);
            setBluetoothToken(device.serviceUUIDs?.[0] ?? device.id ?? 'detected');
          }
        });
      } else if (state === 'PoweredOff') {
        setBleGranted(false);
        setBeaconDetected(false);
      }
    }, true);

    return () => {
      bleSubscription.current?.remove?.();
      ble.stopDeviceScan();
    };
  }, []);

  // ─── Corner scan animation (qr_scan state) ────────────────────────────────
  useEffect(() => {
    if (screen !== STATES.QR_SCAN) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(cornerAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(cornerAnim, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [screen, cornerAnim]);

  // ─── Submitting spinner animation ─────────────────────────────────────────
  useEffect(() => {
    if (screen !== STATES.SUBMITTING) return;
    const anim = Animated.loop(
      Animated.timing(spinValue, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [screen, spinValue]);

  // ─── Success animation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== STATES.SUCCESS) return;
    successScale.setValue(0);
    Animated.spring(successScale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
    const tid = setTimeout(() => navigation.navigate('Dashboard'), 3000);
    return () => clearTimeout(tid);
  }, [screen, successScale, navigation]);

  // ─── Face token TTL countdown (during qr_scan) ───────────────────────────
  useEffect(() => {
    if (screen !== STATES.QR_SCAN) return;
    setFaceTokenTTL(FACE_TOKEN_TTL);
    const id = setInterval(() => {
      setFaceTokenTTL((t) => {
        if (t <= 1) {
          clearInterval(id);
          // Token expired — restart from face_verify
          goTo(STATES.FACE);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auto-capture countdown (face_verify) ────────────────────────────────
  useEffect(() => {
    if (screen !== STATES.FACE) return;
    setFaceCapCountdown(FACE_CAPTURE_DELAY);
    const id = setInterval(() => {
      setFaceCapCountdown((c) => {
        if (c <= 1) {
          clearInterval(id);
          captureFace();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  const goTo = useCallback((s) => setScreen(s), []);

  // ─── Start attendance flow ────────────────────────────────────────────────
  const startAttendance = useCallback(async () => {
    if (!selectedSubject) {
      Alert.alert('Select Subject', 'Please select the subject you are attending.');
      return;
    }
    if (!camPermission?.granted) {
      const res = await requestCamPerm();
      if (!res.granted) {
        Alert.alert(
          'Camera Required',
          'AutoAttend AI needs camera access to verify your identity.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }
    }
    if (!locGranted) {
      Alert.alert(
        'Location Required',
        'AutoAttend AI needs your location to confirm you are in the classroom.',
        [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    // Generate a client-side session ID sent to face/verify
    const sessionId = `${user?.id ?? 'u'}_${Date.now()}`;
    setFaceSessionId(sessionId);
    setQrScanned(false);
    goTo(STATES.FACE);
  }, [selectedSubject, camPermission, requestCamPerm, locGranted, user, goTo]);

  // ─── Capture face photo ───────────────────────────────────────────────────
  const captureFace = useCallback(async () => {
    if (faceCapturing || !cameraRef.current) return;
    setFaceCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: Platform.OS === 'android' });
      await submitFaceVerify(photo.uri);
    } catch {
      setFaceCapturing(false);
      Alert.alert('Capture Failed', 'Could not capture photo. Please try again.');
    }
  }, [faceCapturing, faceSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── POST face/verify ────────────────────────────────────────────────────
  const submitFaceVerify = useCallback(async (photoUri) => {
    const form = new FormData();
    form.append('session_id', faceSessionId);
    form.append('image', { uri: photoUri, type: 'image/jpeg', name: 'face.jpg' });
    try {
      const { data } = await client.post('/face/verify', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFaceToken(data.face_token);
      // Kick off liveness
      const ch = data.liveness_challenge ??
        LIVENESS_CHALLENGES[Math.floor(Math.random() * LIVENESS_CHALLENGES.length)];
      setLivenessChallenge(ch);
      livenessFrames.current = [];
      goTo(STATES.LIVENESS);
      startLiveness(photoUri); // pass first frame
    } catch (err) {
      setFaceCapturing(false);
      const detail = err.response?.data?.detail ?? '';
      if (detail.toLowerCase().includes('not match') || err.response?.status === 422) {
        setFailureData({ type: 'face_not_matched' });
        goTo(STATES.FAILED);
      } else {
        Alert.alert('Face Verification Failed', detail || 'Please try again in better lighting.');
        goTo(STATES.FACE);
      }
    } finally {
      setFaceCapturing(false);
    }
  }, [faceSessionId, goTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Liveness: capture multiple frames ────────────────────────────────────
  const startLiveness = useCallback((firstFrameUri) => {
    livenessFrames.current = firstFrameUri ? [firstFrameUri] : [];
    setLivenessCountdown(5);

    // Clear any previous timers
    livenessIntervals.current.forEach(clearTimeout);
    livenessIntervals.current = [];

    // Countdown display
    const cdId = setInterval(() => {
      setLivenessCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    livenessIntervals.current.push(cdId);

    // Frame captures at t=2s and t=4s
    const captureFrame = async (delay) => {
      return new Promise((resolve) => {
        const tid = setTimeout(async () => {
          try {
            if (cameraRef.current) {
              const p = await cameraRef.current.takePictureAsync({ quality: 0.6, skipProcessing: true });
              livenessFrames.current.push(p.uri);
            }
          } catch { /* best-effort */ }
          resolve();
        }, delay * 1000);
        livenessIntervals.current.push(tid);
      });
    };

    // After 4.5s: send liveness check
    (async () => {
      await captureFrame(2);
      await captureFrame(4);
      clearInterval(cdId);
      await submitLiveness();
    })();
  }, [submitLiveness]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── POST face/liveness-check ─────────────────────────────────────────────
  const submitLiveness = useCallback(async () => {
    const form = new FormData();
    form.append('session_id', faceSessionId);
    livenessFrames.current.forEach((uri, i) => {
      form.append('frames', { uri, type: 'image/jpeg', name: `frame${i}.jpg` });
    });
    try {
      await client.post('/face/liveness-check', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      goTo(STATES.QR_SCAN);
    } catch {
      Alert.alert(
        'Liveness Check Failed',
        'Liveness check failed. Please try again in good lighting.',
        [{ text: 'Try Again', onPress: () => goTo(STATES.FACE) }],
      );
    }
  }, [faceSessionId, goTo]);

  // ─── QR scan handler ──────────────────────────────────────────────────────
  const handleBarCode = useCallback(({ data: qrData }) => {
    if (qrScanned || screen !== STATES.QR_SCAN) return;
    setQrScanned(true);
    submitAttendance(qrData);
  }, [qrScanned, screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── POST attendance/mark ─────────────────────────────────────────────────
  const submitAttendance = useCallback(async (qrData) => {
    goTo(STATES.SUBMITTING);
    const deviceId = await SecureStore.getItemAsync('aa_device_id') ?? '';

    let parsedSession = null;
    try { parsedSession = JSON.parse(qrData)?.session_id ?? qrData; } catch { parsedSession = qrData; }

    try {
      const { data } = await client.post('/attendance/mark', {
        session_id:               parsedSession,
        face_token:               faceToken,
        qr_data:                  qrData,
        student_latitude:         gpsCoords?.lat  ?? null,
        student_longitude:        gpsCoords?.lon  ?? null,
        student_gps_accuracy:     gpsCoords?.accuracy ?? null,
        bluetooth_token_detected: bluetoothToken ?? null,
        device_id:                deviceId,
        subject_id:               selectedSubject?.id ?? null,
      });
      setSuccessData(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      goTo(STATES.SUCCESS);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const detail  = (err.response?.data?.detail ?? '').toLowerCase();
      const status  = err.response?.status;

      if (detail.includes('expired') || detail.includes('qr')) {
        setFailureData({ type: 'qr_expired' });
      } else if (detail.includes('distance') || detail.includes('location') || detail.includes('away')) {
        const dist = err.response?.data?.distance_m ?? null;
        setFailureData({ type: 'not_in_classroom', distance: dist });
      } else if (detail.includes('bluetooth') || detail.includes('beacon')) {
        setFailureData({ type: 'no_bluetooth' });
      } else if (detail.includes('face') || detail.includes('match')) {
        setFailureData({ type: 'face_not_matched' });
      } else if (status === 409 || detail.includes('already')) {
        setFailureData({ type: 'already_marked' });
      } else {
        setFailureData({ type: 'unknown', message: err.response?.data?.detail ?? 'Unexpected error.' });
      }
      goTo(STATES.FAILED);
    }
  }, [faceToken, gpsCoords, bluetoothToken, selectedSubject, goTo]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER — STATE MACHINE
  // ═══════════════════════════════════════════════════════════════════════════

  // ── SUCCESS ────────────────────────────────────────────────────────────────
  if (screen === STATES.SUCCESS) {
    const time = successData?.time
      ? new Date(successData.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    return (
      <SafeAreaView style={[styles.fullScreen, styles.successBg]}>
        <Animated.View style={[styles.successIcon, { transform: [{ scale: successScale }] }]}>
          <Ionicons name="checkmark-circle" size={100} color="#22c55e" />
        </Animated.View>
        <Text style={styles.successTitle}>Attendance Marked!</Text>
        <View style={styles.successCard}>
          <Row label="Subject" value={selectedSubject?.name ?? successData?.subject_name ?? '—'} />
          <Row label="Time"    value={time} />
          <Row label="Status"  value="PRESENT" valueStyle={{ color: '#22c55e', fontWeight: '800' }} />
        </View>
        <Text style={styles.successSub}>Your attendance has been recorded.</Text>
        <Text style={styles.successNote}>Returning to dashboard…</Text>
      </SafeAreaView>
    );
  }

  // ── FAILED ────────────────────────────────────────────────────────────────
  if (screen === STATES.FAILED) {
    return <FailedScreen
      data={failureData}
      onTryAgain={() => {
        const t = failureData?.type;
        if (t === 'qr_expired')      { setQrScanned(false); goTo(STATES.QR_SCAN); }
        else if (t === 'no_bluetooth') goTo(STATES.QR_SCAN);
        else                          goTo(STATES.FACE);
      }}
      onDashboard={() => navigation.navigate('Dashboard')}
    />;
  }

  // ── SUBMITTING ────────────────────────────────────────────────────────────
  if (screen === STATES.SUBMITTING) {
    const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    return (
      <SafeAreaView style={[styles.fullScreen, styles.centred, { backgroundColor: '#0f172a' }]}>
        <Animated.View style={{ transform: [{ rotate: spin }], marginBottom: 24 }}>
          <Ionicons name="sync-outline" size={64} color="#3b82f6" />
        </Animated.View>
        <Text style={styles.submitTitle}>Marking your attendance…</Text>
        <Text style={styles.submitSub}>Please wait</Text>
      </SafeAreaView>
    );
  }

  // ── QR SCAN ────────────────────────────────────────────────────────────────
  if (screen === STATES.QR_SCAN) {
    const cornerColor = cornerAnim.interpolate({ inputRange: [0, 1], outputRange: ['#22c55e', '#3b82f6'] });
    return (
      <View style={styles.fullScreen}>
        <CameraView
          onBarcodeScanned={handleBarCode}
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
        <SafeAreaView style={styles.qrOverlay}>
          {/* Top bar */}
          <View style={styles.qrTopBar}>
            <View style={styles.faceVerifiedBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
              <Text style={styles.faceVerifiedText}>Face Verified!</Text>
            </View>
            <View style={styles.tokenTtlBadge}>
              <Ionicons name="timer-outline" size={14} color={faceTokenTTL <= 10 ? '#f87171' : '#fbbf24'} />
              <Text style={[styles.tokenTtlText, faceTokenTTL <= 10 && { color: '#f87171' }]}>
                {faceTokenTTL}s
              </Text>
            </View>
          </View>

          {/* Scan frame */}
          <View style={styles.scanFrameWrap}>
            <View style={styles.scanFrame}>
              {/* Animated corners */}
              {[['TL', 0, 0], ['TR', 0, null], ['BL', null, 0], ['BR', null, null]].map(([key, t, l]) => (
                <Animated.View
                  key={key}
                  style={[
                    styles.corner,
                    t !== null ? { top: -2 }    : { bottom: -2 },
                    l !== null ? { left: -2 }   : { right: -2 },
                    t !== null && l !== null && styles.cornerTL,
                    t !== null && l === null && styles.cornerTR,
                    t === null && l !== null && styles.cornerBL,
                    t === null && l === null && styles.cornerBR,
                    { borderColor: cornerColor },
                  ]}
                />
              ))}
            </View>
          </View>

          {/* Bottom info */}
          <View style={styles.qrBottomBar}>
            <Text style={styles.qrInstruction}>Scan the QR code displayed by your teacher</Text>
            <View style={styles.statusRow}>
              <StatusPill
                icon={beaconDetected ? 'bluetooth' : 'bluetooth-outline'}
                label={beaconDetected ? 'Beacon detected' : 'Scanning beacon…'}
                ok={beaconDetected}
              />
              <StatusPill
                icon="locate-outline"
                label={gpsCoords ? `GPS ±${Math.round(gpsCoords.accuracy ?? 0)}m` : 'Getting GPS…'}
                ok={!!gpsCoords}
              />
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── LIVENESS CHECK ────────────────────────────────────────────────────────
  if (screen === STATES.LIVENESS) {
    return (
      <View style={styles.fullScreen}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
        <SafeAreaView style={styles.livenessOverlay}>
          <View style={styles.livenessBanner}>
            <Text style={styles.livenessChallenge}>{livenessChallenge}</Text>
            <Text style={styles.livenessCountdown}>{livenessCountdown}</Text>
          </View>
          <View style={styles.faceGuide} pointerEvents="none" />
          <View style={styles.livenessBottom}>
            <ActivityIndicator color="#ffffff" size="small" />
            <Text style={styles.livenessCapturing}>Capturing liveness frames…</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── FACE VERIFY ────────────────────────────────────────────────────────────
  if (screen === STATES.FACE) {
    return (
      <View style={styles.fullScreen}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
        <SafeAreaView style={styles.faceOverlay}>
          <Text style={styles.faceTitle}>Verify Your Identity</Text>
          <Text style={styles.faceSub}>Position your face in the oval</Text>
          <View style={styles.faceGuide} pointerEvents="none" />
          <View style={styles.faceBottom}>
            {faceCapturing
              ? <>
                  <ActivityIndicator color="#ffffff" size="large" />
                  <Text style={styles.faceCapturingText}>Verifying your face…</Text>
                </>
              : <>
                  <Text style={styles.faceAutoText}>
                    Auto-capturing in {faceCapCountdown}s
                  </Text>
                  <TouchableOpacity
                    style={styles.captureBtn}
                    onPress={captureFace}
                    activeOpacity={0.85}
                  >
                    <View style={styles.captureInner} />
                  </TouchableOpacity>
                  <Text style={styles.faceAutoText}>or tap to capture now</Text>
                </>
            }
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── IDLE (default) ────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.idleContainer}>
      {/* Header */}
      <View style={styles.idleHeader}>
        <Text style={styles.idleTitle}>Mark Attendance</Text>
        <Text style={styles.idleClock}>{clockStr}</Text>
      </View>

      {/* Subject dropdown */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Which class are you attending?</Text>
        {subjectsLoading
          ? <ActivityIndicator color="#1a237e" style={{ marginTop: 12 }} />
          : (
            <Pressable style={styles.dropdownBtn} onPress={() => setDropdownOpen((v) => !v)}>
              <Text style={[styles.dropdownBtnText, !selectedSubject && { color: '#94a3b8' }]}>
                {selectedSubject?.name ?? 'Select subject…'}
              </Text>
              <Ionicons
                name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#64748b"
              />
            </Pressable>
          )
        }
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
                    selectedSubject?.id === item.id && styles.dropdownItemSelected,
                  ]}
                  onPress={() => { setSelectedSubject(item); setDropdownOpen(false); }}
                >
                  <Text style={[
                    styles.dropdownItemText,
                    selectedSubject?.id === item.id && { color: '#1a237e', fontWeight: '700' },
                  ]}>
                    {item.name}
                  </Text>
                  {item.teacher_name && (
                    <Text style={styles.dropdownItemSub}>{item.teacher_name}</Text>
                  )}
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.dropdownEmpty}>No subjects found</Text>
              }
            />
          </View>
        )}
      </View>

      {/* BLE status */}
      <View style={[styles.section, styles.bleCard]}>
        <Ionicons
          name={beaconDetected ? 'bluetooth' : 'bluetooth-outline'}
          size={20}
          color={beaconDetected ? '#22c55e' : '#94a3b8'}
        />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.bleTitle}>
            {beaconDetected ? 'Classroom beacon detected' : 'Scanning for classroom beacon…'}
          </Text>
          {!bleGranted && (
            <Text style={styles.bleWarn}>Bluetooth is off — enable it for reliable detection</Text>
          )}
        </View>
        <View style={[styles.bleDot, { backgroundColor: beaconDetected ? '#22c55e' : '#e2e8f0' }]} />
      </View>

      {/* GPS status */}
      <View style={[styles.section, styles.bleCard]}>
        <Ionicons
          name="locate-outline"
          size={20}
          color={gpsCoords ? '#3b82f6' : '#94a3b8'}
        />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.bleTitle}>
            {gpsCoords
              ? `Location ready  ±${Math.round(gpsCoords.accuracy ?? 0)}m accuracy`
              : 'Acquiring GPS location…'}
          </Text>
          {!locGranted && (
            <TouchableOpacity onPress={() => Linking.openSettings()}>
              <Text style={styles.bleWarn}>Location permission needed → Open Settings</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Start button */}
      <TouchableOpacity
        style={[styles.startBtn, !selectedSubject && styles.startBtnDisabled]}
        onPress={startAttendance}
        activeOpacity={0.85}
        disabled={!selectedSubject}
      >
        <Ionicons name="shield-checkmark-outline" size={22} color="#fff" />
        <Text style={styles.startBtnText}>Start Attendance</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

function Row({ label, value, valueStyle }) {
  return (
    <View style={subStyles.row}>
      <Text style={subStyles.rowLabel}>{label}</Text>
      <Text style={[subStyles.rowValue, valueStyle]}>{value}</Text>
    </View>
  );
}

function StatusPill({ icon, label, ok }) {
  return (
    <View style={[subStyles.pill, ok ? subStyles.pillOk : subStyles.pillNeutral]}>
      <Ionicons name={icon} size={13} color={ok ? '#22c55e' : '#94a3b8'} />
      <Text style={[subStyles.pillText, ok && { color: '#22c55e' }]}>{label}</Text>
    </View>
  );
}

function FailedScreen({ data, onTryAgain, onDashboard }) {
  const configs = {
    qr_expired: {
      icon: 'qr-code-outline',
      title: 'QR Code Expired',
      body: 'The QR code has changed. Please scan the latest code.',
      actions: [{ label: 'Try Again', onPress: onTryAgain, primary: true }],
    },
    not_in_classroom: {
      icon: 'location-outline',
      title: 'Not in Classroom',
      body: data?.distance
        ? `You are ${Math.round(data.distance)}m away from the classroom. Must be within 50m.`
        : 'You appear to be outside the classroom. Move closer and try again.',
      actions: [
        { label: 'View Map', onPress: () => {}, primary: false },
        { label: 'Contact Teacher', onPress: () => {}, primary: false },
      ],
    },
    no_bluetooth: {
      icon: 'bluetooth-outline',
      title: 'Bluetooth Beacon Not Detected',
      body: 'Cannot confirm you are in the classroom. Enable Bluetooth and try again.',
      actions: [
        { label: 'Enable Bluetooth', onPress: () => Linking.openSettings(), primary: false },
        { label: 'Try Again', onPress: onTryAgain, primary: true },
      ],
    },
    face_not_matched: {
      icon: 'person-circle-outline',
      title: 'Face Not Matched',
      body: 'Your face could not be verified. Ensure good lighting and face the camera directly.',
      actions: [{ label: 'Try Again', onPress: onTryAgain, primary: true }],
    },
    already_marked: {
      icon: 'checkmark-done-circle-outline',
      title: 'Already Marked',
      body: 'Your attendance is already recorded for this class today.',
      actions: [{ label: 'View Dashboard', onPress: onDashboard, primary: true }],
    },
    unknown: {
      icon: 'alert-circle-outline',
      title: 'Attendance Failed',
      body: data?.message ?? 'An unexpected error occurred.',
      actions: [
        { label: 'Try Again', onPress: onTryAgain, primary: true },
        { label: 'Dashboard', onPress: onDashboard, primary: false },
      ],
    },
  };
  const cfg = configs[data?.type] ?? configs.unknown;

  return (
    <SafeAreaView style={[subStyles.failedScreen]}>
      <View style={subStyles.failedCard}>
        <Ionicons name={cfg.icon} size={72} color="#ef4444" style={{ marginBottom: 12 }} />
        <Text style={subStyles.failedTitle}>{cfg.title}</Text>
        <Text style={subStyles.failedBody}>{cfg.body}</Text>
        <View style={subStyles.failedActions}>
          {cfg.actions.map((a, i) => (
            <TouchableOpacity
              key={i}
              style={[subStyles.failedBtn, a.primary ? subStyles.failedBtnPrimary : subStyles.failedBtnOutline]}
              onPress={a.onPress}
              activeOpacity={0.85}
            >
              <Text style={[subStyles.failedBtnText, !a.primary && { color: '#1a237e' }]}>
                {a.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════
const PRIMARY = '#1a237e';

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: '#000' },
  centred:    { justifyContent: 'center', alignItems: 'center' },

  // ── Idle ────────────────────────────────────────────────────────────────────
  idleContainer: { flex: 1, backgroundColor: '#f8fafc', padding: 20 },
  idleHeader:    { marginBottom: 24 },
  idleTitle:     { fontSize: 24, fontWeight: '800', color: PRIMARY },
  idleClock:     { fontSize: 13, color: '#64748b', marginTop: 4 },

  section:      { marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8 },

  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dropdownBtnText: { fontSize: 14, color: '#1e293b', flex: 1 },
  dropdownList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 4,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  dropdownItem: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  dropdownItemSelected: { backgroundColor: '#e8eaf6' },
  dropdownItemText: { fontSize: 14, color: '#1e293b' },
  dropdownItemSub:  { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  dropdownEmpty:    { padding: 16, color: '#94a3b8', textAlign: 'center', fontSize: 13 },

  bleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bleTitle: { fontSize: 13, color: '#334155', fontWeight: '600' },
  bleWarn:  { fontSize: 11, color: '#f59e0b', marginTop: 2 },
  bleDot:   { width: 10, height: 10, borderRadius: 5 },

  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: PRIMARY,
    borderRadius: 14,
    height: 56,
    marginTop: 8,
    elevation: 4,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  startBtnDisabled: { opacity: 0.5, elevation: 0 },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },

  // ── Face verify ─────────────────────────────────────────────────────────────
  faceOverlay: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 32 },
  faceTitle:   { fontSize: 18, fontWeight: '700', color: '#fff', textAlign: 'center' },
  faceSub:     { fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  faceGuide: {
    width: 220,
    height: 290,
    borderRadius: 130,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.7)',
    borderStyle: 'dashed',
  },
  faceBottom:       { alignItems: 'center', gap: 10 },
  faceAutoText:     { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  faceCapturingText:{ color: '#fff', fontSize: 14, marginTop: 8 },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  captureInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' },

  // ── Liveness ────────────────────────────────────────────────────────────────
  livenessOverlay:    { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 32 },
  livenessBanner:     { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 20, borderRadius: 16, gap: 4 },
  livenessChallenge:  { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: 2 },
  livenessCountdown:  { fontSize: 48, fontWeight: '900', color: '#facc15' },
  livenessBottom:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  livenessCapturing:  { color: 'rgba(255,255,255,0.65)', fontSize: 13 },

  // ── QR scan ─────────────────────────────────────────────────────────────────
  qrOverlay:  { flex: 1, justifyContent: 'space-between' },
  qrTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  faceVerifiedBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  faceVerifiedText:   { color: '#22c55e', fontWeight: '700', fontSize: 14 },
  tokenTtlBadge:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tokenTtlText:       { color: '#fbbf24', fontWeight: '700', fontSize: 14 },

  scanFrameWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanFrame: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderWidth: 4,
  },
  cornerTL: { borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  cornerTR: { borderLeftWidth: 0,  borderBottomWidth: 0, borderTopRightRadius: 8 },
  cornerBL: { borderRightWidth: 0, borderTopWidth: 0,    borderBottomLeftRadius: 8 },
  cornerBR: { borderLeftWidth: 0,  borderTopWidth: 0,    borderBottomRightRadius: 8 },

  qrBottomBar: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 10,
  },
  qrInstruction: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  statusRow: { flexDirection: 'row', gap: 10 },

  // ── Submitting ────────────────────────────────────────────────────────────
  submitTitle: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  submitSub:   { color: '#94a3b8', fontSize: 14, marginTop: 6 },

  // ── Success ────────────────────────────────────────────────────────────────
  successBg:    { flex: 1, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', padding: 28 },
  successIcon:  { marginBottom: 16 },
  successTitle: { fontSize: 28, fontWeight: '900', color: '#15803d', marginBottom: 20 },
  successCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    marginBottom: 20,
    gap: 10,
  },
  successSub:  { fontSize: 14, color: '#475569', textAlign: 'center' },
  successNote: { fontSize: 12, color: '#94a3b8', marginTop: 8 },
});

const subStyles = StyleSheet.create({
  // Row (success card)
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: 13, color: '#64748b' },
  rowValue: { fontSize: 14, fontWeight: '700', color: '#1e293b' },

  // StatusPill
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  pillOk:      { backgroundColor: 'rgba(34,197,94,0.15)' },
  pillNeutral: { backgroundColor: 'rgba(255,255,255,0.15)' },
  pillText:    { color: '#94a3b8', fontSize: 12, fontWeight: '600' },

  // Failed screen
  failedScreen: { flex: 1, backgroundColor: '#fff8f8', justifyContent: 'center', padding: 24 },
  failedCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  failedTitle:   { fontSize: 20, fontWeight: '800', color: '#1e293b', textAlign: 'center', marginBottom: 10 },
  failedBody:    { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  failedActions: { width: '100%', gap: 10 },
  failedBtn: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  failedBtnPrimary: { backgroundColor: PRIMARY },
  failedBtnOutline: { borderWidth: 2, borderColor: PRIMARY },
  failedBtnText:    { color: '#fff', fontWeight: '700', fontSize: 14 },
});
