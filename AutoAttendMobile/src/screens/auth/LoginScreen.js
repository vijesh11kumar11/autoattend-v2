/**
 * LoginScreen — email / roll number + password login
 *
 * Features:
 *  • Full-screen gradient #1a237e → #3b82f6
 *  • White card with shake animation on credential errors
 *  • Password show/hide toggle
 *  • Remember Me (SecureStore — encrypted on device)
 *  • Device-binding modal (403 response)
 *  • Navigates to TOTPScreen if requires_totp
 *  • Navigates to FaceSetupScreen if face_enrollment_required
 *    (passes temp_token — login() called AFTER enrollment)
 *
 * Requires: npx expo install expo-linear-gradient
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../../context/AuthContext';
import client from '../../api/client';

const REMEMBER_KEY = 'aa_remember_identifier';
const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;

// ─────────────────────────────────────────────────────────────────────────────
export default function LoginScreen({ navigation }) {
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deviceDialog, setDeviceDialog] = useState(false);
  const [errors, setErrors] = useState({ identifier: '', password: '' });
  const [cooldown, setCooldown] = useState(0); // seconds remaining

  const attemptsRef = useRef(0);
  const cooldownTimer = useRef(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const passwordRef = useRef(null);

  // ── Restore remembered identifier from SecureStore ─────────────────────────
  useEffect(() => {
    SecureStore.getItemAsync(REMEMBER_KEY)
      .then((val) => {
        if (val) {
          setIdentifier(val);
          setRememberMe(true);
        }
      })
      .catch(() => {});
  }, []);

  // Cleanup cooldown timer on unmount
  useEffect(
    () => () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    },
    []
  );

  const startCooldown = useCallback(() => {
    setCooldown(COOLDOWN_SECONDS);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          clearInterval(cooldownTimer.current);
          cooldownTimer.current = null;
          attemptsRef.current = 0; // reset after cooldown
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  const validate = useCallback(() => {
    const next = { identifier: '', password: '' };
    const id = identifier.trim();
    if (id.length < 3) next.identifier = 'Enter at least 3 characters.';
    if (password.length < 6) next.password = 'Password must be at least 6 characters.';
    setErrors(next);
    return !next.identifier && !next.password;
  }, [identifier, password]);

  // ── Shake card ─────────────────────────────────────────────────────────────
  const shake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 14, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -14, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 5, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // ── Login handler ──────────────────────────────────────────────────────────
  const handleLogin = useCallback(async () => {
    if (!identifier.trim() || !password.trim()) {
      shake();
      return;
    }
    Keyboard.dismiss();
    setLoading(true);

    try {
      const { data } = await client.post('/auth/login', {
        identifier: identifier.trim(),
        password,
      });

      // Persist / clear remembered identifier (SecureStore — NOT
      // AsyncStorage). The previous code referenced an unimported
      // AsyncStorage which would crash on "remember me" tick.
      if (rememberMe) {
        await SecureStore.setItemAsync(REMEMBER_KEY, identifier.trim());
      } else {
        await SecureStore.deleteItemAsync(REMEMBER_KEY);
      }

      // ── TOTP required ────────────────────────────────────────────────────
      if (data.requires_totp) {
        navigation.navigate('TOTP', {
          totp_session_token: data.totp_session_token,
        });
        return;
      }

      // ── Face enrollment required ─────────────────────────────────────────
      // Do NOT call login() yet; FaceSetupScreen will do it after enrollment.
      if (data.face_enrollment_required) {
        navigation.navigate('FaceSetup', { temp_token: data.access_token });
        return;
      }

      // ── Normal success ───────────────────────────────────────────────────
      await login(data.access_token, data.refresh_token);
      // AppNavigator switches to role-based tabs automatically.
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail ?? '';

      if (status === 401) {
        shake();
        Alert.alert('Login Failed', 'Wrong email / roll number or password.');
      } else if (status === 403) {
        setDeviceDialog(true);
      } else if (!err.response) {
        Alert.alert(
          'Connection Error',
          'Cannot connect to server. Check your internet connection.'
        );
      } else {
        shake();
        Alert.alert('Error', detail || 'An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [identifier, password, rememberMe, login, shake, navigation]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <LinearGradient colors={['#1a237e', '#3b82f6']} style={styles.gradient}>
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Branding ─────────────────────────────────────────────── */}
            <View style={styles.brand}>
              <View style={styles.logoCircle}>
                <Ionicons name="school" size={44} color="#1a237e" />
              </View>
              <Text style={styles.appName}>AutoAttend AI</Text>
              <Text style={styles.appTagline}>Smart Attendance Management</Text>
            </View>

            {/* ── Login card ───────────────────────────────────────────── */}
            <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}>
              <Text style={styles.cardTitle}>Sign In</Text>

              {/* Identifier */}
              <View style={[styles.field, errors.identifier && styles.fieldError]}>
                <Ionicons
                  name="person-outline"
                  size={18}
                  color="#94a3b8"
                  style={styles.fieldIcon}
                />
                <TextInput
                  style={styles.fieldInput}
                  placeholder="Email or Roll Number"
                  placeholderTextColor="#94a3b8"
                  value={identifier}
                  onChangeText={(t) => {
                    setIdentifier(t);
                    if (errors.identifier) setErrors((e) => ({ ...e, identifier: '' }));
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  editable={!loading}
                  textContentType="username"
                />
              </View>
              {errors.identifier ? <Text style={styles.errorText}>{errors.identifier}</Text> : null}

              {/* Password */}
              <View style={[styles.field, errors.password && styles.fieldError]}>
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color="#94a3b8"
                  style={styles.fieldIcon}
                />
                <TextInput
                  ref={passwordRef}
                  style={[styles.fieldInput, styles.flexOne]}
                  placeholder="Password"
                  placeholderTextColor="#94a3b8"
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (errors.password) setErrors((e) => ({ ...e, password: '' }));
                  }}
                  secureTextEntry={!showPw}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  editable={!loading}
                  textContentType="password"
                />
                <TouchableOpacity
                  onPress={() => setShowPw((v) => !v)}
                  style={styles.eyeBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={showPw ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="#64748b"
                  />
                </TouchableOpacity>
              </View>
              {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

              {/* Remember me */}
              <View style={styles.rememberRow}>
                <Text style={styles.rememberLabel}>Remember me</Text>
                <Switch
                  value={rememberMe}
                  onValueChange={setRememberMe}
                  trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
                  thumbColor={rememberMe ? '#1a237e' : '#f1f5f9'}
                  disabled={loading}
                />
              </View>

              {/* Login button */}
              <TouchableOpacity
                style={[styles.loginBtn, (loading || cooldown > 0) && styles.loginBtnDisabled]}
                onPress={handleLogin}
                disabled={loading || cooldown > 0}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.loginBtnText}>
                    {cooldown > 0 ? `Try again in ${cooldown}s` : 'Sign In'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Forgot password */}
              <TouchableOpacity
                onPress={() => navigation.navigate('ForgotPassword')}
                style={styles.forgotRow}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                disabled={loading}
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </TouchableOpacity>
            </Animated.View>

            <Text style={styles.versionStr}>AutoAttend AI v2.0</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── Device-binding modal ────────────────────────────────────────── */}
      <Modal
        transparent
        visible={deviceDialog}
        animationType="fade"
        onRequestClose={() => setDeviceDialog(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setDeviceDialog(false)}>
          <Pressable style={styles.dialogBox} onPress={() => {}}>
            <Ionicons name="phone-portrait-outline" size={44} color="#ef4444" />
            <Text style={styles.dialogTitle}>Device Already Registered</Text>
            <Text style={styles.dialogBody}>
              This account is registered on another device.{'\n\n'}
              Contact your HOD to change your device.
            </Text>
            <TouchableOpacity
              style={styles.dialogBtn}
              onPress={() => setDeviceDialog(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.dialogBtnText}>OK</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  gradient: { flex: 1 },
  flex: { flex: 1 },
  flexOne: { flex: 1 },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },

  // ── Branding ──────────────────────────────────────────────────────────────
  brand: { alignItems: 'center', marginBottom: 32 },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  appName: { fontSize: 26, fontWeight: '800', color: '#ffffff', letterSpacing: 0.5 },
  appTagline: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 28,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 24,
    textAlign: 'center',
  },

  // ── Inputs ────────────────────────────────────────────────────────────────
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
    height: 52,
  },
  fieldIcon: { marginRight: 10 },
  fieldInput: { flex: 1, fontSize: 15, color: '#1e293b', paddingVertical: 0 },
  fieldError: { borderColor: '#ef4444' },
  errorText: { fontSize: 12, color: '#ef4444', marginTop: -8, marginBottom: 10, marginLeft: 4 },
  eyeBtn: { padding: 4 },

  // ── Remember me ───────────────────────────────────────────────────────────
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    marginTop: 4,
  },
  rememberLabel: { fontSize: 14, color: '#475569' },

  // ── Login button ──────────────────────────────────────────────────────────
  loginBtn: {
    backgroundColor: '#1a237e',
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    elevation: 3,
    shadowColor: '#1a237e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 16, letterSpacing: 0.4 },

  // ── Forgot ────────────────────────────────────────────────────────────────
  forgotRow: { alignItems: 'center', paddingVertical: 4 },
  forgotText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },

  // ── Version ───────────────────────────────────────────────────────────────
  versionStr: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
  },

  // ── Device dialog ─────────────────────────────────────────────────────────
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  dialogBox: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  dialogBody: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  dialogBtn: {
    backgroundColor: '#1a237e',
    borderRadius: 10,
    paddingHorizontal: 40,
    paddingVertical: 12,
  },
  dialogBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
});
