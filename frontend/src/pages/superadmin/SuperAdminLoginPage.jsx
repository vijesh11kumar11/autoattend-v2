/**
 * SuperAdminLoginPage — /admin/login
 *
 * Separate from the main /login page. Reuses the same /api/auth/login
 * endpoint but ONLY allows super_admin role through; any other role is
 * rejected client-side with an error banner (and logged out server-side).
 *
 * Internal Traceln tooling — minimal branding.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

export default function SuperAdminLoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const navigate = useNavigate();
  const { user, login: refreshAuth, logout } = useAuth();

  // If already authenticated as super_admin, jump straight in.
  useEffect(() => {
    if (user?.role === 'super_admin') navigate('/admin/colleges', { replace: true });
  }, [user, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });

      // Reject non-super_admin accounts on this entry point.
      const role = data?.user?.role;
      if (role !== 'super_admin') {
        try { await logout(); } catch { /* ignore */ }
        setError('This panel is for Traceln staff only. Please use the standard login page.');
        return;
      }

      await refreshAuth();
      navigate('/admin/colleges', { replace: true });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-xl
                      shadow-2xl p-8 text-slate-100">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold text-amber-400 tracking-widest uppercase">
            Internal Tooling
          </p>
          <h1 className="mt-2 text-2xl font-bold">Traceln Admin</h1>
          <p className="mt-1 text-sm text-slate-400">AutoAttend AI — Super Admin Console</p>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded bg-red-900/40 border border-red-800
                          text-red-200 text-sm" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <input type="email" required autoFocus autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700
                         text-slate-100 focus:outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
            <input type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700
                         text-slate-100 focus:outline-none focus:border-amber-500" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2 rounded bg-amber-500 hover:bg-amber-400
                       text-slate-900 font-semibold disabled:opacity-60">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Unauthorized access is monitored and logged.
        </p>
      </div>
    </div>
  );
}
