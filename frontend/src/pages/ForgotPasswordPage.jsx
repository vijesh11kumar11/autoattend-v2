/**
 * ForgotPasswordPage  (4-step password reset flow)
 *
 * Step 1 — Enter roll number or email
 * Step 2 — Enter SMS OTP + Email OTP
 * Step 3 — Enter new password
 * Step 4 — Success + auto-redirect to /login
 *
 * APIs:
 *   POST /api/auth/forgot-password  { identifier }
 *   POST /api/auth/reset-password   { identifier, otp_sms, otp_email, new_password }
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';

// ── OTP multi-box input (6 boxes) ─────────────────────────────────────
function OTPInput({ value, onChange, disabled }) {
  const refsArr = useRef([]);
  // Populate ref slots without calling hooks in a loop
  function refFor(i) {
    return (el) => {
      refsArr.current[i] = el;
    };
  }
  function focusAt(i) {
    refsArr.current[i]?.focus();
  }

  const digits = (value || '').split('').slice(0, 6).concat(Array(6).fill('')).slice(0, 6);

  function handleChange(i, e) {
    const ch = e.target.value.replace(/\D/, '').slice(-1);
    const next = [...digits];
    next[i] = ch;
    onChange(next.join(''));
    if (ch && i < 5) focusAt(i + 1);
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      focusAt(i - 1);
    }
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted.padEnd(6, '').slice(0, 6).trimEnd());
    focusAt(Math.min(pasted.length, 5));
    e.preventDefault();
  }

  return (
    <div className="flex gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={refFor(i)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          disabled={disabled}
          value={d}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          className="w-10 h-11 border rounded-lg text-center text-lg font-mono focus:ring-2
                     focus:ring-primary focus:border-primary outline-none transition
                     disabled:bg-slate-50 disabled:text-slate-400"
        />
      ))}
    </div>
  );
}

// ── Countdown timer ───────────────────────────────────────────────────
function Countdown({ seconds }) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (
    <span className="font-mono font-semibold text-slate-600">
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

// ── Password strength meter ───────────────────────────────────────────
function passwordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[!@#$%^&*()_+\-=[\]{};':"|,.<>/?]/.test(password)) score++;
  const labels = ['', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['', 'bg-red-400', 'bg-amber-400', 'bg-blue-500', 'bg-emerald-500'];
  const txts = ['', 'text-red-500', 'text-amber-500', 'text-blue-600', 'text-emerald-600'];
  return { score, label: labels[score], barColor: colors[score], textColor: txts[score] };
}

function PasswordStrengthBar({ password }) {
  const { score, label, barColor, textColor } = passwordStrength(password);
  if (!password) return null;
  return (
    <div className="space-y-1">
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${(score / 4) * 100}%` }}
        />
      </div>
      <p className={`text-xs font-medium ${textColor}`}>{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════

const RESEND_COOLDOWN = 60; // seconds
const OTP_TTL = 600; // 10 minutes

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1-4
  const [identifier, setIdentifier] = useState('');
  const [phoneMasked, setPhoneMasked] = useState('');
  const [emailMasked, setEmailMasked] = useState('');
  const [otpSms, setOtpSms] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpTimer, setOtpTimer] = useState(OTP_TTL);
  const [resendTimer, setResendTimer] = useState(0);
  const timerRef = useRef(null);

  // Start timers when entering step 2
  useEffect(() => {
    if (step !== 2) return;
    setOtpTimer(OTP_TTL);
    setResendTimer(RESEND_COOLDOWN);

    timerRef.current = setInterval(() => {
      setOtpTimer((t) => Math.max(0, t - 1));
      setResendTimer((t) => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [step]);

  // Auto-redirect on step 4
  useEffect(() => {
    if (step !== 4) return;
    const t = setTimeout(() => navigate('/login', { replace: true }), 3000);
    return () => clearTimeout(t);
  }, [step, navigate]);

  // ── Step 1: send OTP ─────────────────────────────────────────────
  const handleSendOTP = useCallback(
    async (e) => {
      e.preventDefault();
      if (!identifier.trim()) {
        setError('Enter your roll number or email');
        return;
      }
      setError('');
      setLoading(true);
      try {
        const { data } = await api.post('/auth/forgot-password', { identifier: identifier.trim() });
        setPhoneMasked(data.phone_masked || '');
        setEmailMasked(data.email_masked || '');
        setStep(2);
      } catch (err) {
        setError(
          err.response?.data?.detail || 'Failed to send OTP. Check your identifier and try again.'
        );
      } finally {
        setLoading(false);
      }
    },
    [identifier]
  );

  // ── Resend OTP ────────────────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (resendTimer > 0) return;
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { identifier: identifier.trim() });
      setPhoneMasked(data.phone_masked || '');
      setEmailMasked(data.email_masked || '');
      setOtpTimer(OTP_TTL);
      setResendTimer(RESEND_COOLDOWN);
    } catch (err) {
      setError(err.response?.data?.detail || 'Resend failed.');
    } finally {
      setLoading(false);
    }
  }, [identifier, resendTimer]);

  // ── Step 2 → 3 ────────────────────────────────────────────────────
  const handleOTPContinue = useCallback(
    (e) => {
      e.preventDefault();
      if (otpSms.length < 6) {
        setError('Enter full 6-digit SMS OTP');
        return;
      }
      if (otpEmail.length < 6) {
        setError('Enter full 6-digit email OTP');
        return;
      }
      if (otpTimer <= 0) {
        setError('OTPs have expired. Please resend.');
        return;
      }
      setError('');
      setStep(3);
    },
    [otpSms, otpEmail, otpTimer]
  );

  // ── Step 3: reset password ────────────────────────────────────────
  const handleReset = useCallback(
    async (e) => {
      e.preventDefault();
      if (newPassword.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (newPassword !== confirmPwd) {
        setError('Passwords do not match.');
        return;
      }
      if (passwordStrength(newPassword).score < 2) {
        setError('Choose a stronger password.');
        return;
      }
      setError('');
      setLoading(true);
      try {
        await api.post('/auth/reset-password', {
          identifier: identifier.trim(),
          otp_sms: otpSms,
          otp_email: otpEmail,
          new_password: newPassword,
        });
        setStep(4);
      } catch (err) {
        const msg = err.response?.data?.detail;
        // If OTP expired/invalid, send user back to step 2
        if (err.response?.status === 400 || err.response?.status === 422) {
          setError(msg || 'Invalid or expired OTP. Please re-enter OTPs.');
          setStep(2);
        } else {
          setError(msg || 'Password reset failed. Please try again.');
        }
      } finally {
        setLoading(false);
      }
    },
    [identifier, otpSms, otpEmail, newPassword, confirmPwd]
  );

  // ── Layout shell ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700
                          flex items-center justify-center text-white text-xl font-bold mx-auto mb-3 shadow-lg"
          >
            AA
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800">AutoAttend AI</h1>
          <p className="text-sm text-slate-500 mt-1">Password Recovery</p>
        </div>

        {/* Step progress */}
        <div className="flex items-center mb-6">
          {[1, 2, 3, 4].map((n, idx) => (
            <div key={n} className="flex items-center flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                              transition-colors
                              ${
                                step >= n ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'
                              }`}
              >
                {step > n ? '✓' : n}
              </div>
              {idx < 3 && (
                <div
                  className={`flex-1 h-0.5 mx-1 transition-colors ${step > n ? 'bg-blue-600' : 'bg-slate-200'}`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg p-7 space-y-5">
          {/* Error banner */}
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          {/* ── Step 1 ──────────────────────────────────────────── */}
          {step === 1 && (
            <form onSubmit={handleSendOTP} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Forgot Password?</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Enter your roll number or registered email address.
                </p>
              </div>
              <div className="space-y-1">
                <label className="label-text" htmlFor="identifier">
                  Roll Number or Email
                </label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. CS2024001 or you@college.edu"
                  className="input-field"
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Sending…' : 'Send OTP'}
              </button>
              <p className="text-center text-sm text-slate-500">
                Remember your password?{' '}
                <Link to="/login" className="text-blue-600 hover:underline font-medium">
                  Sign in
                </Link>
              </p>
            </form>
          )}

          {/* ── Step 2 ──────────────────────────────────────────── */}
          {step === 2 && (
            <form onSubmit={handleOTPContinue} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Enter OTPs</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  OTPs have been sent to your registered mobile and email.
                </p>
              </div>

              {/* Timer */}
              <div className="text-sm text-slate-500 flex items-center justify-between">
                <span>
                  {otpTimer > 0 ? (
                    <>
                      OTPs expire in <Countdown seconds={otpTimer} />
                    </>
                  ) : (
                    <span className="text-red-500 font-medium">OTPs have expired</span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={resendTimer > 0 || loading}
                  onClick={handleResend}
                  className="text-blue-600 hover:underline text-sm disabled:text-slate-400 disabled:no-underline"
                >
                  {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                </button>
              </div>

              {/* SMS OTP */}
              <div className="space-y-2">
                <label className="label-text">
                  Mobile OTP{phoneMasked ? ` (sent to ${phoneMasked})` : ''}
                </label>
                <OTPInput value={otpSms} onChange={setOtpSms} disabled={loading} />
              </div>

              {/* Email OTP */}
              <div className="space-y-2">
                <label className="label-text">
                  Email OTP{emailMasked ? ` (sent to ${emailMasked})` : ''}
                </label>
                <OTPInput value={otpEmail} onChange={setOtpEmail} disabled={loading} />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setError('');
                  }}
                  className="btn-secondary flex-1"
                >
                  Back
                </button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">
                  Continue
                </button>
              </div>
            </form>
          )}

          {/* ── Step 3 ──────────────────────────────────────────── */}
          {step === 3 && (
            <form onSubmit={handleReset} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Set New Password</h2>
                <p className="text-sm text-slate-500 mt-0.5">Choose a strong password.</p>
              </div>

              {/* New password */}
              <div className="space-y-1.5">
                <label className="label-text" htmlFor="new-pwd">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="new-pwd"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label="Toggle password visibility"
                  >
                    {showPwd ? '🙈' : '👁️'}
                  </button>
                </div>
                <PasswordStrengthBar password={newPassword} />
              </div>

              {/* Confirm password */}
              <div className="space-y-1">
                <label className="label-text" htmlFor="confirm-pwd">
                  Confirm Password
                </label>
                <input
                  id="confirm-pwd"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className={`input-field ${
                    confirmPwd && confirmPwd !== newPassword
                      ? 'border-red-300 focus:ring-red-400'
                      : ''
                  }`}
                />
                {confirmPwd && confirmPwd !== newPassword && (
                  <p className="text-xs text-red-500">Passwords don't match</p>
                )}
              </div>

              {/* Password hints */}
              <ul className="text-xs text-slate-500 space-y-0.5">
                {[
                  [newPassword.length >= 8, 'At least 8 characters'],
                  [/[A-Z]/.test(newPassword), 'One uppercase letter'],
                  [/\d/.test(newPassword), 'One number'],
                  [/[!@#$%^&*()_+\-=[\]{};':"|,.<>/?]/.test(newPassword), 'One special character'],
                ].map(([ok, hint]) => (
                  <li
                    key={hint}
                    className={`flex items-center gap-1.5 ${ok ? 'text-emerald-600' : ''}`}
                  >
                    <span>{ok ? '✓' : '·'}</span>
                    {hint}
                  </li>
                ))}
              </ul>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep(2);
                    setError('');
                  }}
                  className="btn-secondary flex-1"
                >
                  Back
                </button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">
                  {loading ? 'Resetting…' : 'Reset Password'}
                </button>
              </div>
            </form>
          )}

          {/* ── Step 4 ──────────────────────────────────────────── */}
          {step === 4 && (
            <div className="py-4 text-center space-y-4">
              <div className="text-5xl">✅</div>
              <h2 className="text-lg font-bold text-slate-800">Password Reset Successfully!</h2>
              <p className="text-sm text-slate-500">
                All your existing sessions have been logged out for security.
              </p>
              <p className="text-xs text-slate-400">Redirecting to sign in…</p>
              <Link
                to="/login"
                className="inline-block text-blue-600 hover:underline text-sm font-medium"
              >
                Sign in now →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
