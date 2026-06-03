/**
 * FaceSetupScreen — one-time face enrollment for new students
 *
 * Only shown when face_enrollment_required = true in the login response.
 * Route params: { temp_token } — JWT before it is committed to SecureStore.
 * AuthContext.login(temp_token) is called AFTER successful enrollment.
 *
 * Screen states:
 *   intro     → instructions + [Take Selfie] + [Skip for now]
 *   camera    → full-screen CameraView, liveness challenge overlay, capture button
 *   preview   → still photo + [Retake] / [Confirm & Enroll]
 *   enrolling → spinner
 *   success   → success message, auto-navigates to dashboard
 *
 * Camera API: expo-camera ~16 (SDK 54) — uses CameraView + useCameraPermissions
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../../context/AuthContext';
import client from '../../api/client';

const CHALLENGES = ['BLINK', 'SMILE'];
const CHALLENGE_WINDOW = 5; // countdown seconds
const SKIP_KEY = 'aa_face_skip_ts';

/** AsyncStorage key recording that this device has completed face setup. */
function faceRegisteredKey(userId) {
  return `face_biometric_registered_${userId}`;
}

/** Decode JWT payload — no library, atob available in RN 0.76 Hermes */
function decodeJWT(token) {
  try {
    const [, payload] = token.split('.');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FaceSetupScreen({ navigation, route }) {
  const { temp_token } = route.params ?? {};
  const { login } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();

  // Screen state machine
  const [screen, setScreen] = useState('intro');
  const [challenge, setChallenge] = useState(null);
  const [countdown, setCountdown] = useState(CHALLENGE_WINDOW);
  const [photoUri, setPhotoUri] = useState(null);

  const cameraRef = useRef(null);
  const countdownRef = useRef(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Open camera ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Permission Needed',
          'AutoAttend AI needs camera access to enroll your face for attendance.'
        );
        return;
      }
    }
    const picked = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    setChallenge(picked);
    setCountdown(CHALLENGE_WINDOW);
    setScreen('camera');

    // Countdown
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, [permission, requestPermission]);

  // ── Capture photo ──────────────────────────────────────────────────────
  const takePicture = useCallback(async () => {
    if (!cameraRef.current) return;
    if (countdownRef.current) clearInterval(countdownRef.current);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.75,
        skipProcessing: Platform.OS === 'android',
      });
      setPhotoUri(photo.uri);
      setScreen('preview');
    } catch {
      Alert.alert('Capture Failed', 'Could not capture photo. Please try again.');
    }
  }, []);

  // ── Retake ─────────────────────────────────────────────────────────────
  const retake = useCallback(() => {
    setPhotoUri(null);
    startCamera();
  }, [startCamera]);

  // ── Enroll ─────────────────────────────────────────────────────────────
  const enroll = useCallback(async () => {
    if (!photoUri) return;
    setScreen('enrolling');

    const payload = decodeJWT(temp_token);
    if (!payload?.id) {
      Alert.alert('Session Error', 'Invalid session. Please log in again.');
      navigation.replace('Login');
      return;
    }

    const formData = new FormData();
    formData.append('image', {
      uri: photoUri,
      type: 'image/jpeg',
      name: 'face_enrollment.jpg',
    });

    try {
      await client.post(`/students/${payload.id}/enroll-face`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${temp_token}`,
        },
      });
      // Record device-local face setup completion (issues #15 / #87) so the
      // app knows this student has enrolled their face biometric here.
      try {
        await AsyncStorage.setItem(faceRegisteredKey(payload.id), Date.now().toString());
        await AsyncStorage.removeItem(SKIP_KEY);
      } catch {
        /* non-fatal */
      }
      setScreen('success');
      // Auto-navigate to dashboard after brief pause
      setTimeout(async () => {
        await login(temp_token);
      }, 2000);
    } catch (err) {
      setScreen('preview');
      const detail = err.response?.data?.detail ?? '';
      Alert.alert(
        'Enrollment Failed',
        detail || 'Face enrollment failed. Please retake your photo and try again.',
        [
          { text: 'Retake', onPress: retake },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  }, [photoUri, temp_token, login, navigation, retake]);

  // ── Skip ───────────────────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    await AsyncStorage.setItem(SKIP_KEY, Date.now().toString());
    if (temp_token) {
      await login(temp_token);
    } else {
      navigation.replace('Login');
    }
  }, [temp_token, login, navigation]);

  // ══════════════════════════════════════════════════════════════════════════
  // Camera screen
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === 'camera') {
    return (
      <View style={styles.cameraRoot}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />
        <SafeAreaView style={styles.cameraOverlay}>
          {/* Liveness challenge banner */}
          <View style={styles.challengeBanner}>
            <Text style={styles.challengeLabel}>Liveness Challenge</Text>
            <Text style={styles.challengeAction}>Please {challenge} now</Text>
            {countdown > 0 && <Text style={styles.challengeCountdown}>{countdown}s</Text>}
          </View>

          {/* Oval face guide */}
          <View style={styles.faceGuide} pointerEvents="none" />

          {/* Capture controls */}
          <View style={styles.captureArea}>
            <TouchableOpacity style={styles.captureBtn} onPress={takePicture} activeOpacity={0.85}>
              <View style={styles.captureInner} />
            </TouchableOpacity>
            <Text style={styles.captureHint}>Tap after completing the challenge</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Preview screen
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === 'preview') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.previewContent}>
          <Text style={styles.screenTitle}>Preview Photo</Text>
          <Text style={styles.screenSub}>Make sure your face is clear, centred, and well-lit.</Text>
          {photoUri && (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
          )}
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnOutline]}
              onPress={retake}
              activeOpacity={0.85}
            >
              <Ionicons name="refresh-outline" size={18} color="#1a237e" />
              <Text style={[styles.btnText, styles.btnTextOutline]}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={enroll}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={styles.btnText}>Confirm & Enroll</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Enrolling screen
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === 'enrolling') {
    return (
      <SafeAreaView style={[styles.container, styles.centred]}>
        <ActivityIndicator size="large" color="#1a237e" style={{ marginBottom: 20 }} />
        <Text style={styles.screenTitle}>Enrolling your face...</Text>
        <Text style={styles.screenSub}>Please wait</Text>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Success screen
  // ══════════════════════════════════════════════════════════════════════════
  if (screen === 'success') {
    return (
      <SafeAreaView style={[styles.container, styles.centred]}>
        <Ionicons name="checkmark-circle" size={80} color="#22c55e" style={{ marginBottom: 16 }} />
        <Text style={[styles.screenTitle, { color: '#15803d' }]}>Face Enrolled Successfully!</Text>
        <Text style={styles.screenSub}>Redirecting to your dashboard...</Text>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Intro screen (default)
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.introContent} showsVerticalScrollIndicator={false}>
        {/* Icon */}
        <View style={styles.introIconCircle}>
          <Ionicons name="scan-circle-outline" size={56} color="#1a237e" />
        </View>

        <Text style={styles.screenTitle}>Setup Face Recognition</Text>
        <Text style={styles.introPara}>
          Your face is used to verify your identity when marking attendance. This is a one-time
          setup and your face data is securely stored on the server.
        </Text>

        {/* Steps */}
        <View style={styles.stepList}>
          {[
            { icon: 'camera-outline', text: 'Take a clear selfie in good lighting' },
            { icon: 'eye-outline', text: 'Complete the on-screen liveness challenge' },
            { icon: 'shield-checkmark-outline', text: 'Your face data is encrypted and secure' },
          ].map((s, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepIconWrap}>
                <Ionicons name={s.icon} size={20} color="#3b82f6" />
              </View>
              <Text style={styles.stepText}>{s.text}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, styles.btnFull]}
          onPress={startCamera}
          activeOpacity={0.85}
        >
          <Ionicons name="camera-outline" size={20} color="#fff" />
          <Text style={styles.btnText}>Take Selfie</Text>
        </TouchableOpacity>

        {/* Skip */}
        <TouchableOpacity
          onPress={handleSkip}
          style={styles.skipBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
        <Text style={styles.skipHint}>
          You will be reminded daily until face recognition is set up.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const PRIMARY = '#1a237e';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centred: { justifyContent: 'center', alignItems: 'center', padding: 32 },

  // ── Intro ─────────────────────────────────────────────────────────────────
  introContent: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 32,
  },
  introIconCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#e8eaf6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  introPara: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: 320,
  },
  stepList: { width: '100%', gap: 10, marginBottom: 28 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 14,
  },
  stepIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dbeafe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepText: { flex: 1, fontSize: 13, color: '#334155', lineHeight: 19 },

  // ── Shared text ───────────────────────────────────────────────────────────
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 8,
  },
  screenSub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 8,
  },

  // ── Shared buttons ────────────────────────────────────────────────────────
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 12,
    flex: 1,
  },
  btnFull: { flex: 0, width: '100%' },
  btnPrimary: {
    backgroundColor: PRIMARY,
    elevation: 3,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  btnOutline: {
    borderWidth: 2,
    borderColor: PRIMARY,
    backgroundColor: '#ffffff',
  },
  btnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  btnTextOutline: { color: PRIMARY },

  // ── Skip ──────────────────────────────────────────────────────────────────
  skipBtn: { marginTop: 18, padding: 4 },
  skipText: { color: '#94a3b8', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  skipHint: { fontSize: 11, color: '#cbd5e1', textAlign: 'center', marginTop: 6, maxWidth: 260 },

  // ── Camera ────────────────────────────────────────────────────────────────
  cameraRoot: { flex: 1, backgroundColor: '#000' },
  cameraOverlay: { flex: 1, justifyContent: 'space-between' },

  challengeBanner: {
    backgroundColor: 'rgba(0,0,0,0.68)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'center',
  },
  challengeLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginBottom: 2 },
  challengeAction: { color: '#ffffff', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  challengeCountdown: { color: '#facc15', fontSize: 30, fontWeight: '900', marginTop: 4 },

  faceGuide: {
    width: 220,
    height: 290,
    borderRadius: 130,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.65)',
    borderStyle: 'dashed',
    alignSelf: 'center',
  },

  captureArea: { alignItems: 'center', paddingBottom: 36 },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#ffffff',
  },
  captureHint: { color: 'rgba(255,255,255,0.65)', fontSize: 12 },

  // ── Preview ───────────────────────────────────────────────────────────────
  previewContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  photoPreview: {
    width: '86%',
    aspectRatio: 3 / 4,
    borderRadius: 16,
    marginVertical: 20,
    borderWidth: 3,
    borderColor: '#e2e8f0',
  },
  previewActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 16,
  },
});
