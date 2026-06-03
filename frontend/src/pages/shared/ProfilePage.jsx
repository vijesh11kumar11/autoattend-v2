/**
 * TRACELN — Shared Profile Page  (#109 student profile, #110 staff profile)
 *
 * Mounted by every role dashboard at /{role}/profile. Reads the current
 * user from GET /api/auth/me and exposes a dual-OTP password-change flow
 * backed by /api/auth/request-password-change + /api/auth/confirm-password-change.
 *
 * No new backend code — only consumes endpoints that already existed.
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const ROLE_LABEL = {
  principal: 'Principal',
  hod: 'HOD',
  teacher: 'Teacher',
  student: 'Student',
};

function Field({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <p className="text-sm text-slate-800 mt-0.5 break-words">{value || '—'}</p>
    </div>
  );
}

export default function ProfilePage() {
  const { logout } = useAuth();

  // ── Profile load ────────────────────────────────────────────────
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/auth/me');
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.detail || 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Password change (dual OTP) ──────────────────────────────────
  const [stage, setStage] = useState('idle'); // idle | otp_sent | submitting
  const [pwForm, setPwForm] = useState({
    otp_sms: '',
    otp_email: '',
    new_password: '',
    confirm: '',
  });
  const [pwInfo, setPwInfo] = useState(null); // {phone_masked, email_masked, ...}
  const [pwError, setPwError] = useState('');
  const [pwOk, setPwOk] = useState('');

  async function requestOtp() {
    setPwError('');
    setPwOk('');
    try {
      setStage('submitting');
      const { data } = await api.post('/api/auth/request-password-change', {});
      setPwInfo(data);
      setStage('otp_sent');
    } catch (err) {
      setPwError(err?.response?.data?.detail || 'Could not send OTP. Please try again.');
      setStage('idle');
    }
  }

  async function confirmPwChange(e) {
    e?.preventDefault?.();
    setPwError('');
    setPwOk('');
    if (pwForm.new_password.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (pwForm.new_password !== pwForm.confirm) {
      setPwError('Passwords do not match.');
      return;
    }
    if (pwForm.otp_sms.length !== 6 || pwForm.otp_email.length !== 6) {
      setPwError('Both OTPs must be 6 digits.');
      return;
    }
    try {
      setStage('submitting');
      await api.post('/api/auth/confirm-password-change', {
        otp_sms: pwForm.otp_sms,
        otp_email: pwForm.otp_email,
        new_password: pwForm.new_password,
      });
      setPwOk('Password changed successfully. You will be logged out in 3 seconds.');
      setTimeout(() => logout(), 3000);
    } catch (err) {
      setPwError(err?.response?.data?.detail || 'OTP verification failed.');
      setStage('otp_sent');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="max-w-2xl mx-auto bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ── Profile card ─────────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{profile.name}</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {ROLE_LABEL[profile.role] || profile.role}
              {profile.course_name ? ` · ${profile.course_name}` : ''}
            </p>
          </div>
          <span className="text-3xl">👤</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          <Field label="Email" value={profile.email} />
          <Field label="Phone" value={profile.phone} />
          {profile.role === 'student' && (
            <>
              <Field label="Roll number" value={profile.roll_number} />
              <Field label="Semester" value={profile.semester} />
            </>
          )}
          <Field label="Face enrolled" value={profile.face_enrolled ? 'Yes' : 'No'} />
          <Field label="TOTP enabled" value={profile.totp_enabled ? 'Yes' : 'No'} />
          {profile.role !== 'student' && (
            <Field label="Face auth enabled" value={profile.face_auth_enabled ? 'Yes' : 'No'} />
          )}
        </div>
      </section>

      {/* ── Change password ───────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h3 className="text-base font-semibold text-slate-800">Change password</h3>
        <p className="text-xs text-slate-500 mt-1">
          For security, a 6-digit OTP is sent to both your registered mobile and email.
        </p>

        {pwOk && (
          <div
            role="status"
            className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-lg text-sm"
          >
            {pwOk}
          </div>
        )}
        {pwError && (
          <div
            role="alert"
            className="mt-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm"
          >
            {pwError}
          </div>
        )}

        {stage === 'idle' && (
          <button
            type="button"
            onClick={requestOtp}
            className="mt-4 px-4 py-2 bg-[#1a237e] hover:bg-[#0d174f] text-white rounded-lg text-sm font-semibold"
          >
            Send OTP to my mobile & email
          </button>
        )}

        {stage === 'submitting' && stage !== 'otp_sent' && (
          <p className="mt-4 text-sm text-slate-500">Sending OTP…</p>
        )}

        {stage === 'otp_sent' && (
          <form onSubmit={confirmPwChange} className="mt-4 space-y-3">
            <p className="text-xs text-slate-500">
              OTP sent to <strong>{pwInfo?.phone_masked || 'mobile'}</strong> and{' '}
              <strong>{pwInfo?.email_masked || 'email'}</strong>. Valid for{' '}
              {Math.round((pwInfo?.expires_in || 600) / 60)} minutes.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-slate-600 font-semibold">SMS OTP</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={pwForm.otp_sms}
                  onChange={(e) =>
                    setPwForm({ ...pwForm, otp_sms: e.target.value.replace(/\D/g, '') })
                  }
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tracking-widest font-mono"
                  placeholder="••••••"
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-600 font-semibold">Email OTP</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={pwForm.otp_email}
                  onChange={(e) =>
                    setPwForm({ ...pwForm, otp_email: e.target.value.replace(/\D/g, '') })
                  }
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm tracking-widest font-mono"
                  placeholder="••••••"
                  required
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-slate-600 font-semibold">
                New password (min 8 chars)
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={pwForm.new_password}
                onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                required
                minLength={8}
              />
            </label>

            <label className="block">
              <span className="text-xs text-slate-600 font-semibold">Confirm new password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={pwForm.confirm}
                onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                required
                minLength={8}
              />
            </label>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="px-4 py-2 bg-[#1a237e] hover:bg-[#0d174f] text-white rounded-lg text-sm font-semibold"
              >
                Change password
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage('idle');
                  setPwForm({ otp_sms: '', otp_email: '', new_password: '', confirm: '' });
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={requestOtp}
                className="ml-auto text-xs text-slate-500 hover:text-slate-700 underline"
              >
                Resend OTP
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
