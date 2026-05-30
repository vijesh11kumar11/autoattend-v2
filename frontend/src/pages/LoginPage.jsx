/**
 * AutoAttend AI v2.0 — Login Page
 *
 * Split-screen layout:
 *   LEFT  — branded dark-blue panel (logo, tagline, feature pills)
 *   RIGHT — login form with TOTP modal on top
 *
 * Login flow:
 *   1. POST /api/auth/login
 *      → requires_totp=true  → show TOTP modal
 *      → access_token present → store token → redirect
 *   2. POST /api/auth/verify-totp (if TOTP required)
 *      → access_token → store → redirect
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

// ── SVG: Graduation Cap logo ──────────────────────────────────────────
function GraduationCapIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M32 8 L60 22 L32 36 L4 22 Z" fill="white" fillOpacity="0.95" />
      <path d="M16 28 L16 44 C16 44 22 52 32 52 C42 52 48 44 48 44 L48 28"
            stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="56" cy="22" r="3" fill="white" fillOpacity="0.7" />
      <line x1="56" y1="22" x2="56" y2="36"
            stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M52 36 Q56 40 60 36" stroke="white" strokeWidth="2.5"
            strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ── Feature pill ──────────────────────────────────────────────────────
function FeaturePill({ icon, label }) {
  return (
    <div className="flex items-center gap-2 bg-white/10 border border-white/20
                    rounded-full px-3 py-1.5 text-white/90 text-xs font-medium">
      <span className="text-base leading-none">{icon}</span>
      {label}
    </div>
  );
}

// ── Eye toggle icon ───────────────────────────────────────────────────
function EyeIcon({ open }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5
               c4.478 0 8.268 2.943 9.542 7
               -1.274 4.057-5.064 7-9.542 7
               -4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13.875 18.825A10.05 10.05 0 0112 19
               c-4.478 0-8.268-2.943-9.543-7
               a9.97 9.97 0 011.563-3.029
               m5.858.908a3 3 0 114.243 4.243
               M9.878 9.878l4.242 4.242
               M9.88 9.88l-3.29-3.29
               m7.532 7.532l3.29 3.29
               M3 3l3.59 3.59
               m0 0A9.953 9.953 0 0112 5
               c4.478 0 8.268 2.943 9.543 7
               a10.025 10.025 0 01-4.132 5.411
               m0 0L21 21" />
    </svg>
  );
}

// ── TOTP digit input (6 boxes) ────────────────────────────────────────
function TOTPInput({ value, onChange }) {
  const inputs = useRef([]);

  function handleKey(e, idx) {
    if (e.key === 'Backspace') {
      if (value[idx]) {
        const arr = value.split('');
        arr[idx] = '';
        onChange(arr.join(''));
      } else if (idx > 0) {
        inputs.current[idx - 1]?.focus();
      }
    }
  }

  function handleChange(e, idx) {
    const digit = e.target.value.replace(/\D/g, '').slice(-1);
    const arr = value.padEnd(6, ' ').split('');
    arr[idx] = digit;
    const next = arr.join('').trimEnd();
    onChange(next);
    if (digit && idx < 5) inputs.current[idx + 1]?.focus();
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) { onChange(pasted); inputs.current[5]?.focus(); }
    e.preventDefault();
  }

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => { inputs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKey(e, i)}
          className="w-11 h-12 text-center text-lg font-bold border-2 border-slate-300
                     rounded-lg focus:outline-none focus:border-secondary focus:ring-2
                     focus:ring-secondary/30 transition-colors"
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main LoginPage
// ═══════════════════════════════════════════════════════════════════════

const COLLEGE_NAME = import.meta.env.VITE_COLLEGE_NAME || 'AutoAttend AI College';

export default function LoginPage() {
  const navigate  = useNavigate();
  const { login, isAuthenticated } = useAuth();

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  // Form state
  const [identifier, setIdentifier] = useState(() => {
    // Restore the last-used identifier when 'remember me' was checked.
    try { return localStorage.getItem('aa_remember_id') || ''; } catch { return ''; }
  });
  const [password,   setPassword]   = useState('');
  const [showPwd,    setShowPwd]     = useState(false);
  const [remember,   setRemember]    = useState(() => {
    try { return Boolean(localStorage.getItem('aa_remember_id')); } catch { return false; }
  });
  const [loading,    setLoading]     = useState(false);
  const [error,      setError]       = useState('');
  const [notice,     setNotice]      = useState(() => {
    // Pick up reason set by axios interceptor on forced redirect (#60).
    try {
      const reason = sessionStorage.getItem('aa_login_reason');
      sessionStorage.removeItem('aa_login_reason');
      if (reason === 'session_expired') {
        return 'Your session expired. Please sign in again.';
      }
    } catch { /* private mode */ }
    return '';
  });

  // TOTP modal state
  const [showTotp,      setShowTotp]     = useState(false);
  const [totpToken,     setTotpToken]    = useState('');   // totp_session_token
  const [totpCode,      setTotpCode]     = useState('');
  const [totpLoading,   setTotpLoading]  = useState(false);
  const [totpError,     setTotpError]    = useState('');

  // ── Step 1: Login ───────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError('Please enter your identifier and password.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        identifier: identifier.trim(),
        password,
      });

      // Persist (or clear) the remembered identifier. We deliberately
      // never store the password — only the username/roll-no/email so
      // it pre-fills next visit on this device.
      try {
        if (remember) localStorage.setItem('aa_remember_id', identifier.trim());
        else          localStorage.removeItem('aa_remember_id');
      } catch { /* private mode — ignore */ }

      if (data.requires_totp) {
        // Store the totp_session_token for step 2
        setTotpToken(data.totp_session_token || '');
        setShowTotp(true);
      } else {
        // Cookie is now set by the server — pull /me to populate user.
        const user = await login();
        // Students must enroll face before accessing dashboard
        if (data.face_enrollment_required && user.role === 'student') {
          navigate('/student/face-enrollment', { replace: true });
        } else {
          redirectByRole(user.role);
        }
      }
    } catch (err) {
      const detail = (err.response?.data?.detail || '').toString();
      const d      = detail.toLowerCase();
      // Be tolerant of backend wording drift (#63): match by substring,
      // not exact equality, so a copy-edit on the backend doesn't break UX.
      setError(
        d.includes('invalid credential') || d.includes('wrong password') || d.includes('incorrect')
          ? 'Wrong identifier or password.'
          : d.includes('inactive') || d.includes('disabled')
          ? 'Your account is inactive. Contact the administrator.'
          : d.includes('device') && (d.includes('not registered') || d.includes('mismatch'))
          ? 'This device is not registered. Log in from your registered device.'
          : detail || 'Login failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: TOTP verify ─────────────────────────────────────────────
  async function handleTOTP(e) {
    e.preventDefault();
    if (totpCode.replace(/\s/g, '').length !== 6) {
      setTotpError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setTotpLoading(true);
    setTotpError('');
    try {
      const { data } = await api.post('/auth/verify-totp', {
        totp_session_token: totpToken,
        code: totpCode.trim(),
      });
      // Cookie is now set by the server — pull /me to populate user.
      const user = await login();
      redirectByRole(user.role);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setTotpError(
        detail === 'Invalid TOTP code'
          ? 'Incorrect code. Check your authenticator app and try again.'
          : detail === 'TOTP locked'
          ? 'Too many wrong attempts. Please wait before trying again.'
          : detail || 'Verification failed.',
      );
      setTotpCode('');
    } finally {
      setTotpLoading(false);
    }
  }

  function redirectByRole(role) {
    const map = {
      principal: '/principal/dashboard',
      hod:       '/hod/dashboard',
      teacher:   '/teacher/dashboard',
      student:   '/student/dashboard',
    };
    navigate(map[role] ?? '/', { replace: true });
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex">

      {/* ── LEFT PANEL ── */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-10"
        style={{ background: 'linear-gradient(145deg, #1a237e 0%, #283593 60%, #f57c00 100%)' }}
      >
        {/* Logo + name */}
        <div className="flex items-center gap-3">
          <GraduationCapIcon className="w-10 h-10" />
          <span className="text-white font-bold text-xl tracking-tight">AutoAttend AI</span>
        </div>

        {/* Centre content */}
        <div className="space-y-6">
          <div className="space-y-3">
            <h1 className="text-4xl font-extrabold text-white leading-tight">
              Smart Attendance
              <br />for Smart Colleges
            </h1>
            <p className="text-white/70 text-base leading-relaxed max-w-xs">
              Multi-factor attendance powered by AI — face recognition,
              QR codes, GPS, and Bluetooth working together.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            <FeaturePill icon="📱" label="QR-Based" />
            <FeaturePill icon="🤳" label="Face Verified" />
            <FeaturePill icon="📍" label="GPS Secured" />
            <FeaturePill icon="📊" label="Real-time Reports" />
          </div>
        </div>

        {/* Footer */}
        <p className="text-white/40 text-xs">{COLLEGE_NAME}</p>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-white">
        <div className="w-full max-w-sm space-y-8 fade-in">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                 style={{ background: '#1a237e' }}>
              <GraduationCapIcon className="w-5 h-5" />
            </div>
            <span className="font-bold text-slate-800">AutoAttend AI</span>
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
            <p className="text-slate-500 text-sm">Sign in to your account to continue.</p>
          </div>

          {/* Session-expired / forced-redirect notice (#60) */}
          {notice && !error && (
            <div role="status" className="bg-amber-50 border border-amber-200 text-amber-800
                                          rounded-lg px-4 py-3 text-sm flex items-start gap-2">
              <span className="text-base leading-none mt-0.5">🔒</span>
              <span className="flex-1">{notice}</span>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="text-amber-700/70 hover:text-amber-900 text-xs"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div role="alert" className="bg-red-50 border border-red-200 text-red-700
                                         rounded-lg px-4 py-3 text-sm flex items-start gap-2">
              <span className="text-base leading-none mt-0.5">⚠️</span>
              {error}
            </div>
          )}

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            <div>
              <label htmlFor="identifier" className="label">
                Email / Roll Number
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                placeholder="john@college.edu or 21CS001"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="input-field"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="label">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-10"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2
                             text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showPwd} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-secondary
                             focus:ring-secondary accent-secondary"
                />
                <span className="text-sm text-slate-600">Remember me</span>
              </label>
              <Link
                to="/forgot-password"
                className="text-sm font-medium text-secondary hover:text-secondary-dark
                           transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
              style={{ background: '#1a237e' }}
            >
              {loading ? <><div className="spinner" /> Signing in…</> : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      {/* ── TOTP MODAL ── */}
      {showTotp && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowTotp(false); setTotpCode(''); setTotpError(''); } }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 space-y-6 fade-in">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-secondary/10 rounded-full flex items-center
                              justify-center mx-auto text-3xl">🔐</div>
              <h3 className="text-xl font-bold text-slate-800">Two-Factor Authentication</h3>
              <p className="text-slate-500 text-sm">
                Enter the 6-digit code from your authenticator app.
              </p>
            </div>

            {totpError && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700
                                           rounded-lg px-4 py-3 text-sm text-center">
                {totpError}
              </div>
            )}

            <form onSubmit={handleTOTP} className="space-y-5">
              <TOTPInput value={totpCode} onChange={setTotpCode} />

              <button
                type="submit"
                disabled={totpLoading || totpCode.replace(/\s/g, '').length < 6}
                className="btn-primary w-full"
                style={{ background: '#1a237e' }}
              >
                {totpLoading
                  ? <><div className="spinner" /> Verifying…</>
                  : 'Verify'}
              </button>
            </form>

            <button
              type="button"
              className="w-full text-center text-sm text-slate-400 hover:text-slate-600
                         transition-colors"
              onClick={() => { setShowTotp(false); setTotpCode(''); setTotpError(''); }}
            >
              ← Back to login
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

