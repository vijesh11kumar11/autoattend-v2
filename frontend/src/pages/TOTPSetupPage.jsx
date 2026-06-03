/**
 * TOTPSetupPage — first-time authenticator app setup
 *
 * Shown when login response includes `totp_setup_required: true`.
 * The user must scan the QR code and confirm a valid TOTP code
 * before accessing their dashboard.
 *
 * APIs:
 *   GET  /api/auth/totp-setup    → { secret, qr_image (base64 PNG), instructions }
 *   POST /api/auth/totp-confirm  { secret, totp_code }
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

// ── 6-box one-time code input ─────────────────────────────────────────
function TOTPInput({ value, onChange, disabled }) {
  const refsArr = useRef([]);
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
    <div className="flex gap-2 justify-center">
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
          className="w-11 h-12 border rounded-xl text-center text-xl font-mono focus:ring-2
                     focus:ring-primary focus:border-primary outline-none transition
                     disabled:bg-slate-50 disabled:text-slate-400"
        />
      ))}
    </div>
  );
}

// ── Role to dashboard path ────────────────────────────────────────────
function dashboardPath(role) {
  switch (role) {
    case 'principal':
      return '/principal/dashboard';
    case 'hod':
      return '/hod/dashboard';
    case 'teacher':
      return '/teacher/dashboard';
    default:
      return '/student/dashboard';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TOTPSetupPage
// ═══════════════════════════════════════════════════════════════════════

export default function TOTPSetupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [setupData, setSetupData] = useState(null); // { secret, qr_image, instructions }
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Load QR + secret on mount
  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/totp-setup')
      .then(({ data }) => {
        if (!cancelled) {
          setSetupData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.response?.data?.detail || 'Could not load TOTP setup. Please re-login.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // After success, redirect to dashboard
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate(dashboardPath(user?.role), { replace: true }), 2000);
    return () => clearTimeout(t);
  }, [done, navigate, user?.role]);

  // ── Confirm TOTP ──────────────────────────────────────────────────
  async function handleConfirm(e) {
    e.preventDefault();
    if (code.replace(/\D/g, '').length < 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/totp-confirm', {
        secret: setupData.secret,
        totp_code: code.replace(/\D/g, ''),
      });
      setDone(true);
    } catch (err) {
      setError(
        err.response?.data?.detail || 'Invalid code. Check the time on your device and try again.'
      );
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700
                          flex items-center justify-center text-white text-xl font-bold mx-auto mb-3 shadow-lg"
          >
            AA
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800">TRACELN</h1>
          <p className="text-sm text-slate-500 mt-1">Two-Factor Authentication Setup</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-7 space-y-6">
          {/* Error */}
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && !setupData && !error && (
            <div className="py-10 flex flex-col items-center gap-4 text-slate-400">
              <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-sm">Loading setup…</p>
            </div>
          )}

          {/* Success */}
          {done && (
            <div className="py-8 text-center space-y-4">
              <div className="text-5xl">🔒</div>
              <h2 className="text-lg font-bold text-slate-800">Authenticator Linked!</h2>
              <p className="text-sm text-slate-500">
                Two-factor authentication is now active on your account.
              </p>
              <p className="text-xs text-slate-400">Redirecting to your dashboard…</p>
            </div>
          )}

          {/* Setup form */}
          {!loading && setupData && !done && (
            <form onSubmit={handleConfirm} className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Scan this QR Code</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Open your authenticator app (Google Authenticator, Authy, Microsoft Authenticator)
                  and scan the QR code below.
                </p>
              </div>

              {/* QR code */}
              <div className="flex justify-center">
                <div className="p-3 bg-white border-2 border-slate-200 rounded-xl inline-block">
                  <img
                    src={setupData.qr_image}
                    alt="TOTP QR Code"
                    className="w-44 h-44 object-contain"
                    draggable={false}
                  />
                </div>
              </div>

              {/* Instructions or manual key */}
              {setupData.instructions && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-4 py-3 leading-relaxed">
                  {setupData.instructions}
                </p>
              )}

              {/* Manual entry key */}
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Can't scan? Enter this key manually
                </p>
                <div
                  className="font-mono text-sm text-slate-700 bg-slate-50 border border-slate-200
                              rounded-lg px-4 py-2.5 break-all tracking-widest select-all"
                  title="Click to select all"
                >
                  {setupData.secret}
                </div>
              </div>

              {/* Code input */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700 text-center">
                  I've scanned it — enter the 6-digit code to verify:
                </p>
                <TOTPInput value={code} onChange={setCode} disabled={submitting} />
              </div>

              <button
                type="submit"
                disabled={submitting || code.replace(/\D/g, '').length < 6}
                className="btn-primary w-full"
              >
                {submitting ? 'Verifying…' : 'Verify & Activate'}
              </button>

              <p className="text-xs text-center text-slate-400">
                Make sure your device's clock is accurate. The 6-digit code refreshes every 30
                seconds.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
