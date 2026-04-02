/**
 * AutoAttend AI v2.0 — Auth Context
 *
 * Provides: user, token, loading, isAuthenticated
 * Functions: login(token), logout(), hasRole(minRole)
 * Booleans:  isPrincipal, isHOD, isTeacher, isStudent
 *
 * JWT is decoded client-side for display only — actual
 * authorization is always enforced server-side.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Role hierarchy (higher = more privilege)
const ROLE_HIERARCHY = {
  student:   0,
  teacher:   1,
  hod:       2,
  principal: 3,
};

// ── JWT decode (no verification — payload for display only) ───────────
function decodeJWT(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Context ───────────────────────────────────────────────────────────
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();

  const [token,   setToken]   = useState(() => localStorage.getItem('aa_token') || null);
  const [user,    setUser]    = useState(() => {
    try { return JSON.parse(localStorage.getItem('aa_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  // On mount: validate stored token is not expired
  useEffect(() => {
    if (token) {
      const payload = decodeJWT(token);
      if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
        // Token expired — clean up silently
        localStorage.removeItem('aa_token');
        localStorage.removeItem('aa_user');
        setToken(null);
        setUser(null);
      } else if (!user) {
        // Reconstruct user from JWT payload if localStorage lost it
        setUser({
          id:            payload.sub,
          name:          payload.name  || '',
          role:          payload.role  || 'student',
          college_id:    payload.college_id,
          department_id: payload.department_id,
          face_enrolled: payload.face_enrolled,
        });
      }
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // login(token) — called after successful auth API response
  const login = useCallback((newToken) => {
    const payload = decodeJWT(newToken);
    if (!payload) throw new Error('Invalid token received from server.');

    const userObj = {
      id:            payload.sub,
      name:          payload.name  || '',
      role:          payload.role  || 'student',
      college_id:    payload.college_id,
      department_id: payload.department_id,
      face_enrolled: payload.face_enrolled,
    };

    localStorage.setItem('aa_token', newToken);
    localStorage.setItem('aa_user',  JSON.stringify(userObj));
    setToken(newToken);
    setUser(userObj);
    return userObj;
  }, []);

  // logout() — clear everything, go to login
  const logout = useCallback(() => {
    localStorage.removeItem('aa_token');
    localStorage.removeItem('aa_user');
    setToken(null);
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
    token,
    loading,
    isAuthenticated: !!token && !!user,

    // Convenience booleans
    isPrincipal: user?.role === 'principal',
    isHOD:       user?.role === 'hod',
    isTeacher:   user?.role === 'teacher',
    isStudent:   user?.role === 'student',

    login,
    logout,
    hasRole,
  }), [user, token, loading, login, logout, hasRole]);

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

