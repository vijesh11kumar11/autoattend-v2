/**
 * AuthContext — auth state for AutoAttend AI mobile
 *
 * Storage:  expo-secure-store (WHEN_UNLOCKED)
 * Token:    JWT; payload decoded in-place (no library needed)
 * Roles:    student < teacher < hod < principal
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { setUnauthorizedCallback } from '../api/client';

const TOKEN_KEY = 'aa_auth_token';
const ROLE_ORDER = { student: 0, teacher: 1, hod: 2, principal: 3 };

/** Decode JWT payload without an external library. */
function decodeJWTPayload(token) {
  try {
    const [, payload] = token.split('.');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Restore token on app launch ───────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (stored) {
          const payload = decodeJWTPayload(stored);
          // Accept token if it has not expired
          if (payload && payload.exp * 1000 > Date.now()) {
            setToken(stored);
            setUser(payload);
          } else {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
          }
        }
      } catch (err) {
        console.warn('[AuthContext] restore error:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ── logout ────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch {}
    setToken(null);
    setUser(null);
  }, []);

  // Register logout as 401 handler for the axios interceptor
  useEffect(() => {
    setUnauthorizedCallback(logout);
  }, [logout]);

  // ── login ─────────────────────────────────────────────────────────
  const login = useCallback(async (newToken) => {
    const payload = decodeJWTPayload(newToken);
    if (!payload) throw new Error('Invalid or malformed token.');
    await SecureStore.setItemAsync(TOKEN_KEY, newToken, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
    setToken(newToken);
    setUser(payload);
  }, []);

  // ── hasRole ───────────────────────────────────────────────────────
  const hasRole = useCallback((minRole) => {
    if (!user) return false;
    return (ROLE_ORDER[user.role] ?? -1) >= (ROLE_ORDER[minRole] ?? 99);
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token,
        login,
        logout,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
