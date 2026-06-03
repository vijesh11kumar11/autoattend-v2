/**
 * TRACELN — Shared Notifications Inbox  (#111)
 *
 * Full-page version of the navbar notification bell. Consumes the same
 * GET /api/notifications/me endpoint, asks for a larger limit (50) and
 * adds simple kind-based filtering. No new backend code.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const KIND_META = {
  alert: { icon: '🔔', label: 'Alert', color: 'bg-blue-50 border-blue-200 text-blue-700' },
  dispute_update: {
    icon: '⚖️',
    label: 'Dispute update',
    color: 'bg-violet-50 border-violet-200 text-violet-700',
  },
  dispute_pending: {
    icon: '⚖️',
    label: 'Dispute pending',
    color: 'bg-amber-50 border-amber-200 text-amber-700',
  },
  leave_decision: {
    icon: '✋',
    label: 'Leave decision',
    color: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  },
  leave_pending: {
    icon: '✋',
    label: 'Leave pending',
    color: 'bg-amber-50 border-amber-200 text-amber-700',
  },
};

const SEEN_TS_KEY = 'aa.notif.seen_ts';

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleString();
}

function deepLink(role, item) {
  const meta = item?.meta || {};
  if (item.kind === 'dispute_pending' || item.kind === 'dispute_update') {
    return `/${role}/disputes`;
  }
  if (item.kind === 'leave_pending') {
    return `/${role}/leave-requests`;
  }
  if (item.kind === 'leave_decision') {
    return role === 'student' ? '/student/leaves' : null;
  }
  return null;
}

export default function NotificationsInboxPage() {
  const { user } = useAuth();
  const role = user?.role || 'student';

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/notifications/me', { params: { limit: 50 } });
      setItems(Array.isArray(data?.items) ? data.items : []);
      // Mark all as seen — clears the navbar bell badge.
      try {
        localStorage.setItem(SEEN_TS_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const kinds = useMemo(() => {
    const set = new Set(items.map((i) => i.kind).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [items]);

  const visible = filter === 'all' ? items : items.filter((i) => i.kind === filter);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Notifications</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {items.length} {items.length === 1 ? 'item' : 'items'} · newest first
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {/* Kind filter chips */}
      {kinds.length > 2 && (
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => {
            const m = KIND_META[k];
            const active = filter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={
                  'text-xs px-3 py-1.5 rounded-full border transition-colors ' +
                  (active
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')
                }
              >
                {k === 'all' ? 'All' : `${m?.icon || '•'} ${m?.label || k}`}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm"
        >
          {error}
        </div>
      )}

      {/* List */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">
            You&rsquo;re all caught up.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((it, idx) => {
              const meta = KIND_META[it.kind] || {
                icon: '🔔',
                label: it.kind || 'Notification',
                color: 'bg-slate-50 border-slate-200 text-slate-700',
              };
              const href = deepLink(role, it);
              const body = (
                <div className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-start gap-3">
                    <span
                      className={
                        'text-lg leading-none flex-shrink-0 mt-0.5 border rounded-full w-8 h-8 flex items-center justify-center ' +
                        meta.color
                      }
                    >
                      {meta.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {it.title || meta.label}
                        </p>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap">
                          {fmtTime(it.created_at)}
                        </span>
                      </div>
                      {it.body && (
                        <p className="text-sm text-slate-500 mt-0.5 break-words">{it.body}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
              return (
                <li key={idx}>
                  {href ? (
                    <Link to={href} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
