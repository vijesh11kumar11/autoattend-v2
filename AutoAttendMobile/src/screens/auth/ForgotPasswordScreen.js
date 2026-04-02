/**
 * ForgotPasswordScreen — 3-step password reset
 * Step 1: Enter identifier (roll/email)
 * Step 2: Enter SMS OTP + Email OTP
 * Step 3: New password → success
 *
 * APIs:
 *   POST /api/auth/forgot-password  { identifier }
 *   POST /api/auth/reset-password   { identifier, otp_sms, otp_email, new_password }
 */
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import client from '../../api/client';

const PRIMARY = '#1a237e';

function OTPBoxes({ value, onChange }) {
  const refs = useRef([]);
  const digits = (value || '').split('').concat(Array(6).fill('')).slice(0, 6);

  const handleChange = (i, ch) => {
    const c = ch.replace(/\D/, '').slice(-1);
    const next = [...digits]; next[i] = c;
    onChange(next.join(''));
    if (c && i < 5) refs.current[i + 1]?.focus();
  };
  const handleKey = (i, e) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  };

  return (
    <View style={styles.otpRow}>
      {digits.map((d, i) => (
        <TextInput
          key={i} ref={el => { refs.current[i] = el; }}
          style={styles.otpBox} keyboardType="number-pad" maxLength={1}
          value={d} onChangeText={ch => handleChange(i, ch)} onKeyPress={e => handleKey(i, e)}
        />
      ))}
    </View>
  );
}

export default function ForgotPasswordScreen({ navigation }) {
  const [step, setStep]           = useState(1);
  const [identifier, setId]       = useState('');
  const [otpSms, setOtpSms]       = useState('');
  const [otpEmail, setOtpEmail]   = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const sendOtp = async () => {
    if (!identifier.trim()) { setError('Enter your roll number or email.'); return; }
    setLoading(true); setError('');
    try {
      await client.post('/auth/forgot-password', { identifier: identifier.trim() });
      setStep(2);
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not send OTP. Check your identifier.');
    } finally { setLoading(false); }
  };

  const resetPassword = async () => {
    if (otpSms.length < 6 || otpEmail.length < 6) { setError('Enter both 6-digit OTPs.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true); setError('');
    try {
      await client.post('/auth/reset-password', {
        identifier: identifier.trim(), otp_sms: otpSms, otp_email: otpEmail, new_password: password,
      });
      setStep(3);
    } catch (e) {
      setError(e.response?.data?.detail || 'Reset failed. Check OTPs and try again.');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={PRIMARY} />
        </TouchableOpacity>

        <Text style={styles.heading}>
          {step === 1 ? '🔑 Forgot Password' : step === 2 ? '📨 Verify OTP' : '✅ Password Reset'}
        </Text>

        {error ? <Text style={styles.err}>{error}</Text> : null}

        {/* Step 1 */}
        {step === 1 && (
          <View style={styles.card}>
            <Text style={styles.label}>Roll Number or Email</Text>
            <TextInput style={styles.input} placeholder="e.g. 21CS101 or user@college.edu"
              autoCapitalize="none" value={identifier} onChangeText={setId} />
            <Text style={styles.hint}>We'll send OTPs to your registered phone and email.</Text>
            <TouchableOpacity style={styles.btn} onPress={sendOtp} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Send OTP</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <View style={styles.card}>
            <Text style={styles.label}>SMS OTP</Text>
            <OTPBoxes value={otpSms} onChange={setOtpSms} />
            <Text style={[styles.label, { marginTop: 16 }]}>Email OTP</Text>
            <OTPBoxes value={otpEmail} onChange={setOtpEmail} />

            <Text style={[styles.label, { marginTop: 20 }]}>New Password</Text>
            <View style={styles.pwRow}>
              <TextInput style={[styles.input, styles.flex]}
                secureTextEntry={!showPw} value={password} onChangeText={setPassword}
                placeholder="Min 8 characters" />
              <TouchableOpacity onPress={() => setShowPw(!showPw)} style={styles.eye}>
                <Ionicons name={showPw ? 'eye-off' : 'eye'} size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Confirm Password</Text>
            <TextInput style={styles.input} secureTextEntry value={confirm} onChangeText={setConfirm}
              placeholder="Re-enter password" />
            <TouchableOpacity style={styles.btn} onPress={resetPassword} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Reset Password</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={sendOtp} style={{ marginTop: 12, alignSelf: 'center' }}>
              <Text style={{ color: PRIMARY, fontSize: 13 }}>Resend OTP</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <View style={[styles.card, { alignItems: 'center' }]}>
            <Ionicons name="checkmark-circle" size={64} color="#22c55e" />
            <Text style={[styles.heading, { marginTop: 12 }]}>Password Changed!</Text>
            <Text style={styles.hint}>You can now log in with your new password.</Text>
            <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Login')}>
              <Text style={styles.btnTxt}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 20, paddingTop: 50 },
  back: { marginBottom: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: PRIMARY, marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  label: { fontSize: 13, fontWeight: '600', color: '#64748b', marginBottom: 6, textTransform: 'uppercase' },
  input: { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 14, fontSize: 15, color: '#1e293b', marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  hint: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  btn: { backgroundColor: PRIMARY, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  err: { color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  otpBox: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 10, padding: 14, fontSize: 20, fontWeight: '700', textAlign: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  pwRow: { flexDirection: 'row', alignItems: 'center' },
  eye: { position: 'absolute', right: 12, top: 14 },
});
