/**
 * AutoAttend AI v2.0 — Auth Context
 *
 * Provides: user, loading, isAuthenticated
 * Functions: login(), logout(), hasRole(minRole)
 * Booleans:  isPrincipal, isHOD, isTeacher, isStudent
 *
 * The JWT is stored exclusively in an httpOnly cookie set by the server —
 * it never touches JavaScript land. User metadata (role, name, id, …) is
 * fetched from GET /api/auth/me and kept in React state only (never
 * written to localStorage) so it disappears on hard-refresh and is
 * restored by the /me call on the next mount.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

// Role hierarchy (higher = more privilege)
const ROLE_HIERARCHY = {
  student:   0,
  teacher:   1,
  hod:       2,
  principal: 3,
};

// ── Context ───────────────────────────────────────────────────────────
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();

  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount: restore session by calling /me — the httpOnly cookie is sent
  // automatically by the browser. If 401, the user is not logged in.
  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => {
        setUser({
          id:            data.id,
          name:          data.name  || '',
          role:          data.role  || 'student',
          college_id:    data.college_id,
          department_id: data.department_id,
          face_enrolled: data.face_enrolled,
          totp_enabled:  data.totp_enabled,
        });
      })
      .catch(() => {
        // Not authenticated — leave user as null
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // login() — called after a successful /auth/login or /auth/verify-totp
  // response. Fetches full user data from /me (cookie is already set by
  // the server response) and stores it in memory.
  const login = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    const userObj = {
      id:            data.id,
      name:          data.name  || '',
      role:          data.role  || 'student',
      college_id:    data.college_id,
      department_id: data.department_id,
      face_enrolled: data.face_enrolled,
      totp_enabled:  data.totp_enabled,
    };
    setUser(userObj);
    return userObj;
  }, []);

  // logout() — tells the server to clear the httpOnly cookie, then clears
  // in-memory state and navigates to /login.
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Ignore errors — the cookie will expire naturally
    }
    localStorage.removeItem('aa_user');
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  // hasRole(minRole) — true if current user's role >= minRole
  const hasRole = useCallback((minRole) => {
    if (!user) return false;
    return (ROLE_HIERARCHY[user.role] ?? -1) >= (ROLE_HIERARCHY[minRole] ?? 99);
  }, [user]);

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated: !!user,

    // Convenience booleans
    isPrincipal: user?.role === 'principal',
    isHOD:       user?.role === 'hod',
    isTeacher:   user?.role === 'teacher',
    isStudent:   user?.role === 'student',

    login,
    logout,
    hasRole,
  }), [user, loading, login, logout, hasRole]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default AuthContext;

