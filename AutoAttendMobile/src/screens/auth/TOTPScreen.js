/**
 * TOTPScreen — 6-digit TOTP verification
 *
 * Features:
 *  • 6 individual TextInput boxes, side by side
 *  • Auto-advance on each digit
 *  • Backspace jumps to previous box
 *  • Paste detection: fills all boxes from clipboard paste
 *  • Auto-submit when all 6 digits are filled
 *  • Shake animation on wrong code
 *  • Tracks remaining attempts (max 3), then locks with alert
 *  • Handles face_enrollment_required in verify-totp response
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const BOX_COUNT = 6;
const MAX_ATTEMPTS = 3;

// ─────────────────────────────────────────────────────────────────────────────
export default function TOTPScreen({ navigation, route }) {
  const { totp_session_token } = route.params ?? {};
  const { login } = useAuth();

  const [digits, setDigits] = useState(Array(BOX_COUNT).fill(''));
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);

  const inputRefs = useRef([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Focus first box once the screen mounts
  useEffect(() => {
    const tid = setTimeout(() => inputRefs.current[0]?.focus(), 300);
    return () => clearTimeout(tid);
  }, []);

  // ── Shake ───────────────────────────────────────────────────────────────
  const shake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // ── Clear boxes and refocus ─────────────────────────────────────────────
  const clearCode = useCallback(() => {
    setDigits(Array(BOX_COUNT).fill(''));
    setTimeout(() => inputRefs.current[0]?.focus(), 50);
  }, []);

  // ── Submit to API ───────────────────────────────────────────────────────
  const submitCode = useCallback(
    async (code) => {
      if (loading || locked) return;
      Keyboard.dismiss();
      setLoading(true);

      try {
        const { data } = await client.post('/auth/verify-totp', {
          totp_session_token,
          totp_code: code,
        });

        // Face enrollment may still be required after TOTP
        if (data.face_enrollment_required) {
          navigation.navigate('FaceSetup', { temp_token: data.access_token });
          return;
        }

        await login(data.access_token, data.refresh_token);
        // AppNavigator switches to role tabs automatically.
      } catch (err) {
        shake();
        clearCode();

        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        if (newAttempts >= MAX_ATTEMPTS) {
          setLocked(true);
          Alert.alert('Too Many Attempts', 'Too many failed attempts. Try again in 15 minutes.', [
            { text: 'Back to Login', onPress: () => navigation.replace('Login') },
          ]);
        } else {
          const remaining = MAX_ATTEMPTS - newAttempts;
          Alert.alert(
            'Invalid Code',
            `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [loading, locked, totp_session_token, login, shake, clearCode, attempts, navigation]
  );

  // ── Handle text change in any box ──────────────────────────────────────
  const handleChange = useCallback(
    (text, index) => {
      // Paste detection: if the pasted text contains multiple chars
      if (text.length > 1) {
        const nums = text.replace(/\D/g, '').slice(0, BOX_COUNT);
        const next = Array(BOX_COUNT).fill('');
        nums.split('').forEach((d, i) => {
          next[i] = d;
        });
        setDigits(next);

        if (nums.length === BOX_COUNT) {
          Keyboard.dismiss();
          submitCode(nums);
        } else {
          inputRefs.current[Math.min(nums.length, BOX_COUNT - 1)]?.focus();
        }
        return;
      }

      // Single digit — only allow numeric
      const digit = text.replace(/\D/g, '');
      const next = [...digits];
      next[index] = digit;
      setDigits(next);

      // Light haptic on each valid digit
      if (digit) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (digit && index < BOX_COUNT - 1) {
        inputRefs.current[index + 1]?.focus();
      }
      if (digit && index === BOX_COUNT - 1) {
        const code = next.join('');
        if (code.length === BOX_COUNT) {
          Keyboard.dismiss();
          submitCode(code);
        }
      }
    },
    [digits, submitCode]
  );

  // ── Backspace navigation ────────────────────────────────────────────────
  const handleKeyPress = useCallback(
    ({ nativeEvent }, index) => {
      if (nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
        inputRefs.current[index - 1]?.focus();
      }
    },
    [digits]
  );

  const attemptsLeft = MAX_ATTEMPTS - attempts;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* ── Lock icon ──────────────────────────────────────────────── */}
        <View style={styles.iconCircle}>
          <Ionicons name="lock-closed" size={40} color="#1a237e" />
        </View>

        <Text style={styles.title}>Two-Factor Authentication</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code from your{'\n'}Google Authenticator app
        </Text>

        {/* ── 6 OTP boxes ───────────────────────────────────────────── */}
        <Animated.View style={[styles.otpRow, { transform: [{ translateX: shakeAnim }] }]}>
          {Array.from({ length: BOX_COUNT }).map((_, i) => (
            <TextInput
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              style={[styles.otpBox, digits[i] ? styles.otpBoxFilled : null]}
              value={digits[i]}
              onChangeText={(text) => handleChange(text, i)}
              onKeyPress={(e) => handleKeyPress(e, i)}
              keyboardType="number-pad"
              maxLength={BOX_COUNT} // Enables paste on first box
              selectTextOnFocus
              textAlign="center"
              caretHidden={Platform.OS === 'android'}
              editable={!loading && !locked}
            />
          ))}
        </Animated.View>

        {/* Attempt warning */}
        {attempts > 0 && !locked && (
          <Text style={styles.attemptsText}>
            {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} remaining
          </Text>
        )}

        {/* Loading */}
        {loading && <ActivityIndicator color="#3b82f6" size="large" style={styles.spinner} />}

        {/* ── Hint ──────────────────────────────────────────────────── */}
        <View style={styles.hintBox}>
          <Ionicons name="information-circle-outline" size={16} color="#94a3b8" />
          <Text style={styles.hintText}>
            Didn't get it? Open Google Authenticator and check the current code.
          </Text>
        </View>

        {/* ── Back to Login ──────────────────────────────────────────── */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={16} color="#3b82f6" />
          <Text style={styles.backText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },

  // ── Icon ──────────────────────────────────────────────────────────────────
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#e8eaf6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 36,
  },

  // ── OTP ───────────────────────────────────────────────────────────────────
  otpRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  otpBox: {
    width: 46,
    height: 58,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  otpBoxFilled: {
    borderColor: '#3b82f6',
    backgroundColor: '#1e3a5f',
  },

  attemptsText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  spinner: { marginVertical: 16 },

  // ── Hint ──────────────────────────────────────────────────────────────────
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    gap: 8,
    marginTop: 8,
    marginBottom: 28,
    maxWidth: 340,
  },
  hintText: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },

  // ── Back ──────────────────────────────────────────────────────────────────
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  backText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },
});
