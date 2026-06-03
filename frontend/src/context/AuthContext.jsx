/**
 * TRACELN v2.0 — Auth Context
 *
 * Web auth model:
 *   • JWT lives in an httpOnly `aa_token` cookie (set by the backend).
 *   • JavaScript NEVER sees the token (XSS-safe).
 *   • Only user metadata (role, name, id, ...) is held in React state.
 *   • On page refresh we restore state by calling GET /api/auth/me
 *     (the cookie travels automatically).
 *
 * Public API:
 *   user, loading, isAuthenticated
 *   login()           → call AFTER /api/auth/login succeeds; pulls /me and sets user.
 *   logout()          → calls /api/auth/logout (server clears cookie) and resets state.
 *   hasRole(minRole)
 *   isPrincipal, isHOD, isTeacher, isStudent
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

// Role hierarchy (higher = more privilege)
const ROLE_HIERARCHY = {
  student: 0,
  teacher: 1,
  hod: 2,
  principal: 3,
};

// ── Context ───────────────────────────────────────────────────────────
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch the current profile using the httpOnly cookie.
  // Returns the user object on success, or null on 401/network error.
  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      const userObj = {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        college_id: data.college_id,
        department_id: data.department_id,
        face_enrolled: data.face_enrolled,
        totp_enabled: data.totp_enabled,
      };
      setUser(userObj);
      return userObj;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  // On mount: try to restore session from cookie.
  useEffect(() => {
    (async () => {
      await fetchMe();
      setLoading(false);
    })();
  }, [fetchMe]);

  // login() — call AFTER POST /api/auth/login (or /verify-totp) succeeds.
  // The cookie is already set; we just pull /me and stash the user.
  const login = useCallback(async () => {
    const u = await fetchMe();
    if (!u) throw new Error('Login succeeded but profile fetch failed.');
    return u;
  }, [fetchMe]);

  // logout() — server clears the cookie, then we reset and redirect.
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore network errors — still log out client-side
    }
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const hasRole = useCallback(
    (minRole) => {
      if (!user) return false;
      return (ROLE_HIERARCHY[user.role] ?? -1) >= (ROLE_HIERARCHY[minRole] ?? 99);
    },
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: !!user,

      isPrincipal: user?.role === 'principal',
      isHOD: user?.role === 'hod',
      isTeacher: user?.role === 'teacher',
      isStudent: user?.role === 'student',

      login,
      logout,
      hasRole,
    }),
    [user, loading, login, logout, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default AuthContext;
