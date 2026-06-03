/**
 * JoinSessionPage — PUBLIC entry point for /live/:joinCode (Prompt 5).
 * No auth required to view. Handles 4 states: waiting / live-anon / live-auth / ended.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const VIOLET = 'from-violet-600 via-purple-600 to-fuchsia-600';

function Card({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-violet-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">{children}</div>
    </div>
  );
}

export default function JoinSessionPage() {
  const { joinCode } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const [state, setState] = useState('loading'); // loading | waiting | live | ended | denied
  const [info, setInfo] = useState(null);
  const [meta, setMeta] = useState(null); // public session metadata
  const [error, setError] = useState('');
  const [pwd, setPwd] = useState('');
  const [needPwd, setNeedPwd] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [busy, setBusy] = useState(false);

  // Pre-fetch public metadata so we can render a friendly screen before the
  // user clicks "Join". Falls back gracefully if the endpoint isn't there.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/live/join/${joinCode}/info`);
        if (alive) {
          setMeta(r.data);
          if (r.data?.requires_password) setNeedPwd(true);
        }
      } catch {
        // ignore — probe() below will handle 404 / etc.
      }
    })();
    return () => {
      alive = false;
    };
  }, [joinCode]);

  // Initial probe — try join with current credentials (or none).
  // `silent`: when true, suppress 422 "guest_name required" — expected for
  // anonymous visitors on the first load before they type their name.
  const probe = async (extra = {}, opts = {}) => {
    const { silent = false } = opts;
    setBusy(true);
    setError('');
    try {
      const body = {
        password: extra.password || undefined,
        guest_name: extra.guest_name || undefined,
        guest_email: extra.guest_email || undefined,
      };
      const r = await api.post(`/live/join/${joinCode}`, body);
      const d = r.data;
      if (d.status === 'waiting') {
        setInfo(d);
        setState('waiting');
      } else if (d.allowed) {
        setInfo(d);
        if (d.guest_token) {
          // Stash guest data in module-scope memory (NOT sessionStorage —
          // XSS can read sessionStorage; module memory dies on reload).
          const { setGuestSession } = await import('./guestSessionStore.js');
          setGuestSession({
            token: d.guest_token,
            sessionId: d.session.id,
            participantId: d.participant_id,
            name: extra.guest_name || guestName.trim() || 'Guest',
            joinData: d,
          });
        }
        navigate(`/student/live/${d.session.id}?join=${joinCode}`);
      }
    } catch (e) {
      const detail = e.response?.data?.detail;
      const status = e.response?.status;
      if (status === 401) {
        setNeedPwd(true);
        setState('live');
      } else if (status === 422 && silent) {
        // Expected on first load for guests — just show the join form
        setState('live');
      } else if (status === 403) {
        setError(typeof detail === 'object' ? detail.message : detail || 'Access denied');
        setInfo(typeof detail === 'object' ? detail : null);
        setState('denied');
      } else if (status === 400 && /ended|cancelled/i.test(detail || '')) {
        setState('ended');
      } else if (status === 404) {
        setError('Session not found.');
        setState('denied');
      } else {
        setError(detail || 'Could not join. Please try again.');
        setState('live');
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    probe({}, { silent: true });
  }, [joinCode]);

  // ──────────────────────────────────────────────────────────────────────
  if (state === 'loading' || (busy && !error)) {
    return (
      <Card>
        <p className="text-center text-slate-500">Connecting…</p>
      </Card>
    );
  }

  if (state === 'ended') {
    return (
      <Card>
        <h2 className="text-xl font-bold text-slate-800 text-center">📺 Session has ended</h2>
        <p className="text-sm text-slate-500 text-center mt-2">Thanks for stopping by!</p>
        <button
          onClick={() => navigate('/')}
          className={`mt-6 w-full py-3 rounded-xl text-white font-bold bg-gradient-to-r ${VIOLET}`}
        >
          Go to Dashboard
        </button>
      </Card>
    );
  }

  if (state === 'denied') {
    return (
      <Card>
        <div className="text-center">
          <span className="text-5xl">🔒</span>
          <h2 className="text-xl font-bold text-slate-800 mt-3">Access Restricted</h2>
          <p className="text-sm text-slate-600 mt-2">
            {error || 'You cannot access this session.'}
          </p>
          {info?.capsule_title && (
            <p className="text-xs text-slate-500 mt-2">Capsule: {info.capsule_title}</p>
          )}
          <button
            onClick={() => navigate('/')}
            className="mt-6 w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold"
          >
            Go to My Dashboard
          </button>
        </div>
      </Card>
    );
  }

  if (state === 'waiting') {
    return (
      <Card>
        <div className="text-center">
          <span className="text-5xl">⏰</span>
          <h2 className="text-xl font-bold text-slate-800 mt-3">
            {info?.title || meta?.title || 'Live Class'}
          </h2>
          {meta?.teacher_name && (
            <p className="text-sm text-slate-500 mt-1">
              👤 {meta.teacher_name}
              {meta.subject_name ? ` · ${meta.subject_name}` : ''}
            </p>
          )}
          <p className="text-sm text-slate-500 mt-1">Hasn't started yet — you'll be notified.</p>
        </div>
        {!isAuthenticated && (
          <>
            <button
              onClick={() => navigate(`/login?next=/live/${joinCode}`)}
              className={`mt-5 w-full py-3 rounded-xl text-white font-bold bg-gradient-to-r ${VIOLET}`}
            >
              Login to AutoAttend
            </button>
            <p className="text-center text-xs text-slate-400 my-3">— or —</p>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg mb-2"
            />
            <input
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder="Email (optional)"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg mb-2"
            />
            <button className="w-full py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold">
              🔔 Notify me when class starts
            </button>
          </>
        )}
      </Card>
    );
  }

  // STATE 2: live, no auth → show join options
  const headerTitle = info?.title || meta?.title || `Session ${joinCode}`;
  const isLiveNow = (meta?.status || '').toLowerCase() === 'live';
  return (
    <Card>
      <div className="text-center">
        <div
          className={`inline-flex items-center gap-2 font-bold ${isLiveNow ? 'text-red-500' : 'text-amber-600'}`}
        >
          <span
            className={`w-2 h-2 rounded-full ${isLiveNow ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}
          />
          {isLiveNow ? 'LIVE NOW' : meta?.status ? meta.status.toUpperCase() : 'JOIN SESSION'}
        </div>
        <h2 className="text-xl font-bold text-slate-800 mt-2">{headerTitle}</h2>
        {meta?.teacher_name && (
          <p className="text-sm text-slate-500 mt-1">
            👤 {meta.teacher_name}
            {meta.subject_name ? ` · ${meta.subject_name}` : ''}
          </p>
        )}
        {meta?.session_type && (
          <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
            {meta.session_type === 'public'
              ? '🌐 Public Link'
              : meta.session_type === 'capsule_locked'
                ? '🔒 Capsule-Locked'
                : '🎓 Standalone'}
          </span>
        )}
      </div>
      {needPwd && (
        <div className="mt-4">
          <label className="text-xs font-semibold text-slate-700">Meeting password</label>
          <div className="flex gap-2 mt-1">
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg"
            />
            <button
              onClick={() =>
                probe({
                  password: pwd,
                  guest_name: guestName || undefined,
                  guest_email: guestEmail || undefined,
                })
              }
              className={`px-4 py-2 rounded-lg text-white font-semibold bg-gradient-to-r ${VIOLET}`}
            >
              Enter
            </button>
          </div>
        </div>
      )}
      {!isAuthenticated && (
        <>
          <button
            onClick={() => navigate(`/login?next=/live/${joinCode}`)}
            className={`mt-5 w-full py-3 rounded-xl text-white font-bold bg-gradient-to-r ${VIOLET}`}
          >
            🚀 Login & Join
          </button>
          {meta?.allow_guests !== false && (
            <>
              <p className="text-center text-xs text-slate-400 my-3">— or —</p>
              <input
                value={guestName}
                onChange={(e) => {
                  setGuestName(e.target.value);
                  setError('');
                }}
                placeholder="Your name"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg mb-2"
              />
              <input
                value={guestEmail}
                onChange={(e) => {
                  setGuestEmail(e.target.value);
                  setError('');
                }}
                placeholder="Email (optional)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg mb-2"
              />
              <button
                onClick={() =>
                  probe({
                    guest_name: guestName.trim(),
                    guest_email: guestEmail.trim(),
                    password: pwd || undefined,
                  })
                }
                disabled={!guestName.trim() || busy}
                className="w-full py-3 bg-slate-800 text-white rounded-xl font-semibold disabled:opacity-50"
              >
                {busy
                  ? 'Joining…'
                  : guestName.trim()
                    ? `🚀 Join as ${guestName.trim()}`
                    : 'Join as Guest'}
              </button>
            </>
          )}
        </>
      )}
      {isAuthenticated && !needPwd && (
        <button
          onClick={() => probe()}
          disabled={busy}
          className={`mt-5 w-full py-3 rounded-xl text-white font-bold bg-gradient-to-r ${VIOLET} disabled:opacity-50`}
        >
          {busy ? 'Joining…' : `Join as ${user?.name || 'me'}`}
        </button>
      )}
      {error && <p className="text-red-600 text-sm mt-3 text-center">{error}</p>}
    </Card>
  );
}
