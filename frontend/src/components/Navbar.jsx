/**
 * AutoAttend AI v2.0 — Navbar
 *
 * Features:
 * • Page title (passed as prop)
 * • Live IST clock (updates every second)
 * • Notification bell (placeholder)
 * • User name + role badge
 * • Two-click logout with 4-second cancel window
 *
 * Usage: <Navbar title="Dashboard" collapsed={collapsed} />
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

// ── Role badge classes ────────────────────────────────────────────────
const ROLE_BADGE = {
  principal: 'badge-principal',
  hod:       'badge-hod',
  teacher:   'badge-teacher',
  student:   'badge-student',
};
const ROLE_LABEL = { principal: 'Principal', hod: 'HOD', teacher: 'Teacher', student: 'Student' };

// ── IST clock ─────────────────────────────────────────────────────────
function ISTClock() {
  const [time, setTime] = useState('');

  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-IN', {
          timeZone:   'Asia/Kolkata',
          hour:       '2-digit',
          minute:     '2-digit',
          second:     '2-digit',
          hour12:     true,
        }),
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const date = new Date().toLocaleDateString('en-IN', {
    timeZone:  'Asia/Kolkata',
    weekday:   'short',
    day:       '2-digit',
    month:     'short',
    year:      'numeric',
  });

  return (
    <div className="flex flex-col items-center leading-tight select-none">
      <span className="text-sm font-semibold text-slate-700 tabular-nums">{time}</span>
      <span className="text-xs text-slate-400">{date} IST</span>
    </div>
  );
}

// ── Bell icon ────────────────────────────────────────────────────────
function BellIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11
               a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341
               C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436
               L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

// ── Notifications dropdown ───────────────────────────────────────────
const NOTIF_POLL_MS   = 60_000;            // poll every 60 s
const SEEN_TS_KEY     = 'aa_notif_seen_ts';

function NotificationBell() {
  const [open,    setOpen]    = useState(false);
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [unread,  setUnread]  = useState(0);
  const wrapRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/api/notifications/me', { params: { limit: 20 } });
      const next = Array.isArray(data?.items) ? data.items : [];
      setItems(next);
      const seen = Number(localStorage.getItem(SEEN_TS_KEY) || 0);
      const u = next.filter((it) => {
        const t = Date.parse(it.created_at || '');
        return Number.isFinite(t) && t > seen;
      }).length;
      setUnread(u);
    } catch (_) {
      // Silent — bell stays in its last state if backend hiccups.
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll on mount + interval
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, NOTIF_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Close on outside click
  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function toggle() {
    setOpen((v) => !v);
    if (!open) {
      // Marking as 'seen' clears the unread badge until newer items arrive.
      try { localStorage.setItem(SEEN_TS_KEY, String(Date.now())); } catch (_) {}
      setUnread(0);
    }
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const min = Math.round(diffMs / 60000);
    if (min < 1)   return 'just now';
    if (min < 60)  return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24)   return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 7)   return `${day}d ago`;
    return d.toLocaleDateString();
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        className="relative p-2 text-slate-500 hover:text-slate-700
                   hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="Notifications"
        onClick={toggle}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1
                           rounded-full bg-red-500 text-white text-[10px] font-bold
                           flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[420px] bg-white
                        border border-slate-200 rounded-xl shadow-lg
                        overflow-hidden z-50 flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            <button onClick={refresh}
                    className="text-xs text-slate-500 hover:text-slate-700">
              {loading ? '…' : 'Refresh'}
            </button>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                {loading ? 'Loading…' : 'You\'re all caught up.'}
              </div>
            ) : (
              items.map((it, idx) => (
                <div key={idx} className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-700 truncate">
                      {it.title || 'Notification'}
                    </p>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">
                      {formatTime(it.created_at)}
                    </span>
                  </div>
                  {it.body && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{it.body}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Navbar component
// ═══════════════════════════════════════════════════════════════════════

const CANCEL_TIMEOUT_MS = 4000;

export default function Navbar({ title = 'Dashboard', collapsed = false }) {
  const { user, logout } = useAuth();
  const role = user?.role || 'student';

  // Two-click logout state
  const [confirmState, setConfirmState]   = useState('idle'); // idle | confirming
  const [countdown,    setCountdown]      = useState(CANCEL_TIMEOUT_MS / 1000);
  const timerRef    = useRef(null);
  const intervalRef = useRef(null);

  const clearTimers = useCallback(() => {
    clearTimeout(timerRef.current);
    clearInterval(intervalRef.current);
  }, []);

  function handleLogoutClick() {
    if (confirmState === 'idle') {
      // First click — enter confirmng state
      setConfirmState('confirming');
      setCountdown(CANCEL_TIMEOUT_MS / 1000);

      intervalRef.current = setInterval(() => {
        setCountdown((c) => Math.max(0, c - 1));
      }, 1000);

      timerRef.current = setTimeout(() => {
        clearTimers();
        logout();
      }, CANCEL_TIMEOUT_MS);
    } else {
      // Second click — logout immediately
      clearTimers();
      logout();
    }
  }

  function handleCancel() {
    clearTimers();
    setConfirmState('idle');
    setCountdown(CANCEL_TIMEOUT_MS / 1000);
  }

  // Cleanup on unmount
  useEffect(() => () => clearTimers(), [clearTimers]);

  const leftOffset = collapsed
    ? 'var(--sidebar-collapsed-width)'
    : 'var(--sidebar-width)';

  return (
    <header
      className="fixed top-0 right-0 z-30 flex items-center justify-between
                 px-5 border-b border-slate-200 bg-white/95 backdrop-blur-sm
                 transition-all duration-200"
      style={{
        left:   leftOffset,
        height: 'var(--navbar-height)',
      }}
    >
      {/* ── Left: page title ── */}
      <h1 className="text-base font-semibold text-slate-800 truncate">{title}</h1>

      {/* ── Right: clock · bell · user · logout ── */}
      <div className="flex items-center gap-4">

        {/* IST clock */}
        <div className="hidden sm:block">
          <ISTClock />
        </div>

        {/* Notification bell (live) */}
        <NotificationBell />

        {/* Divider */}
        <div className="w-px h-7 bg-slate-200" />

        {/* User chip */}
        <div className="flex flex-col items-end leading-tight select-none">
          <span className="text-sm font-semibold text-slate-800 truncate max-w-[120px]">
            {user?.name || 'User'}
          </span>
          <span className={`mt-0.5 ${ROLE_BADGE[role]}`}>
            {ROLE_LABEL[role]}
          </span>
        </div>

        {/* Logout / Cancel */}
        {confirmState === 'idle' ? (
          <button
            onClick={handleLogoutClick}
            className="btn-ghost text-slate-500 text-sm px-3 py-1.5"
            title="Logout"
          >
            <span className="text-base leading-none">🚪</span>
            <span className="hidden sm:inline">Logout</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 fade-in">
            <button
              onClick={handleLogoutClick}
              className="btn-danger text-xs px-3 py-1.5"
              title="Confirm logout"
            >
              Confirm ({countdown}s)
            </button>
            <button
              onClick={handleCancel}
              className="btn-ghost text-xs px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

