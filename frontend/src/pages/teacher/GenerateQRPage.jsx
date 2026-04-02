/**
 * AutoAttend AI v2.0 — Generate QR Page (Teacher)
 *
 * LEFT  : Session Setup card → QR Display card (after session starts)
 * RIGHT : Live Attendance Board with manual override
 *
 * API:
 *   GET  /api/faculty/{id}/classes        → subject list
 *   POST /api/attendance/start-session    → creates session
 *   GET  /api/qr/token/{session_id}       → current QR data (polled every 4 s)
 *   GET  /api/attendance/session/{id}     → live student list (polled every 10 s)
 *   POST /api/attendance/end-session/{id} → end session
 *   POST /api/attendance/manual-override  → manual status change
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────
const QR_POLL_MS         = 4000;
const ATTENDANCE_POLL_MS = 10000;
const QR_SLOT_SECONDS    = 5;
const END_CONFIRM_SECS   = 4;

// ── Helpers ───────────────────────────────────────────────────────────
function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function formatClock(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function formatIST(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

// ── Avatar ────────────────────────────────────────────────────────────
function Avatar({ name }) {
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0
                    text-white text-xs font-bold select-none"
         style={{ background: '#1a237e' }}>
      {initials(name)}
    </div>
  );
}

// ── Countdown bar (0 → 5 seconds) ─────────────────────────────────────
function CountdownBar({ countdown }) {
  const pct    = (countdown / QR_SLOT_SECONDS) * 100;
  const urgent = countdown <= 1;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500 text-center">
        QR refreshes in{' '}
        <span className={`font-bold tabular-nums ${urgent ? 'text-danger' : 'text-secondary'}`}>
          {countdown}s
        </span>
      </p>
      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-linear
                      ${urgent ? 'bg-danger' : 'bg-secondary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Manual Override Dialog ────────────────────────────────────────────
const OVERRIDE_OPTIONS = [
  { value: 'present',       label: '✅ Present'       },
  { value: 'late',          label: '⏰ Late'           },
  { value: 'medical_leave', label: '🏥 Medical Leave'  },
  { value: 'duty_leave',    label: '📋 Duty Leave'     },
  { value: 'absent',        label: '❌ Absent'         },
];

function OverrideDialog({ student, onConfirm, onClose, loading }) {
  const [status, setStatus] = useState('present');
  const [reason, setReason] = useState('');

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 fade-in">
        <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
          <Avatar name={student.name} />
          <div>
            <p className="font-semibold text-slate-800">{student.name}</p>
            <p className="text-xs text-slate-500">{student.roll_number ?? 'No roll number'}</p>
          </div>
        </div>

        <h3 className="text-lg font-bold text-slate-800">Manual Override</h3>

        <div>
          <label className="label">New Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="input-field"
            disabled={loading}
          >
            {OVERRIDE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">
            Reason <span className="text-danger">*</span>
            <span className="text-slate-400 font-normal ml-1">(min 5 chars)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Provide a clear reason for the override…"
            className="input-field resize-none"
            disabled={loading}
          />
          <p className="text-xs text-slate-400 text-right mt-0.5">{reason.length}/500</p>
        </div>

        <div className="flex gap-3 justify-end">
          <button className="btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn-primary"
            style={{ background: '#1a237e' }}
            onClick={() => onConfirm(status, reason)}
            disabled={reason.trim().length < 5 || loading}
          >
            {loading ? <><div className="spinner" />Saving…</> : 'Confirm Override'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GenerateQRPage
// ═══════════════════════════════════════════════════════════════════════
export default function GenerateQRPage() {
  const { user } = useAuth();

  // Date in YYYY-MM-DD (local)
  const today = new Date().toLocaleDateString('en-CA');

  // ── Phase ─────────────────────────────────────────────────────────
  // 'setup' → form visible  |  'active' → session running  |  'ended' → show final
  const [phase, setPhase] = useState('setup');

  // ── Setup form ────────────────────────────────────────────────────
  const [subjects,        setSubjects]        = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [subjectsError,   setSubjectsError]   = useState(false);
  const [selectedSubId,   setSelectedSubId]   = useState('');
  const [room,            setRoom]            = useState('');
  const [gpsStatus,       setGpsStatus]       = useState('idle'); // idle|getting|got|error
  const [gpsCoords,       setGpsCoords]       = useState(null);
  const [startLoading,    setStartLoading]    = useState(false);
  const [startError,      setStartError]      = useState('');

  // ── Active session ────────────────────────────────────────────────
  const [session,        setSession]        = useState(null);  // StartSessionResponse
  const [qrData,         setQrData]         = useState('');
  const [countdown,      setCountdown]      = useState(QR_SLOT_SECONDS);
  const [sessionElapsed, setSessionElapsed] = useState(0);

  // ── End confirm ───────────────────────────────────────────────────
  const [endState,     setEndState]     = useState('idle'); // idle|confirming
  const [endCountdown, setEndCountdown] = useState(END_CONFIRM_SECS);

  // ── Attendance board ──────────────────────────────────────────────
  const [attendance,      setAttendance]      = useState(null); // SessionStatusResponse
  const [activeTab,       setActiveTab]       = useState('present');
  const [overrideStudent, setOverrideStudent] = useState(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  // ── Refs (timers/pollers) ─────────────────────────────────────────
  const qrPollRef         = useRef(null);
  const attendancePollRef = useRef(null);
  const countdownRef      = useRef(null);
  const sessionTimerRef   = useRef(null);
  const sessionStartRef   = useRef(null);
  const endTimerRef       = useRef(null);
  const endIntervalRef    = useRef(null);

  // ── Load teacher's subjects ────────────────────────────────────────
  useEffect(() => {
    api.get(`/faculty/${user.id}/classes`)
      .then(({ data }) => {
        setSubjects(data);
        if (data.length === 1) setSelectedSubId(String(data[0].id));
      })
      .catch(() => setSubjectsError(true))
      .finally(() => setSubjectsLoading(false));
  }, [user.id]);

  // ── Client-side QR countdown (0.5 s resolution) ───────────────────
  useEffect(() => {
    if (phase !== 'active') return;
    const tick = () => {
      const rem = QR_SLOT_SECONDS - (Math.floor(Date.now() / 1000) % QR_SLOT_SECONDS);
      setCountdown(rem === 0 ? QR_SLOT_SECONDS : rem);
    };
    tick();
    countdownRef.current = setInterval(tick, 500);
    return () => clearInterval(countdownRef.current);
  }, [phase]);

  // ── Session elapsed timer ────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active') return;
    sessionStartRef.current = Date.now();
    sessionTimerRef.current = setInterval(() => {
      setSessionElapsed(Math.floor((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(sessionTimerRef.current);
  }, [phase]);

  // ── QR fetch ─────────────────────────────────────────────────────
  const fetchQR = useCallback(async (sid) => {
    try {
      const { data } = await api.get(`/qr/token/${sid}`);
      if (data.qr_data) setQrData(data.qr_data);
    } catch { /* silent — old QR still displayed */ }
  }, []);

  // ── Attendance fetch ──────────────────────────────────────────────
  const fetchAttendance = useCallback(async (sid) => {
    try {
      const { data } = await api.get(`/attendance/session/${sid}`);
      setAttendance(data);
    } catch { /* silent */ }
  }, []);

  // ── Start polling once session becomes active ─────────────────────
  useEffect(() => {
    if (phase !== 'active' || !session) return;
    const sid = session.session_id;
    fetchQR(sid);
    fetchAttendance(sid);
    qrPollRef.current         = setInterval(() => fetchQR(sid),         QR_POLL_MS);
    attendancePollRef.current = setInterval(() => fetchAttendance(sid), ATTENDANCE_POLL_MS);
    return () => {
      clearInterval(qrPollRef.current);
      clearInterval(attendancePollRef.current);
    };
  }, [phase, session, fetchQR, fetchAttendance]);

  // ── Global cleanup on unmount ─────────────────────────────────────
  useEffect(() => () => {
    [qrPollRef, attendancePollRef, countdownRef,
     sessionTimerRef, endTimerRef, endIntervalRef].forEach((r) => {
      clearInterval(r.current);
      clearTimeout(r.current);
    });
  }, []);

  // ── GPS ───────────────────────────────────────────────────────────
  function requestGPS() {
    setGpsStatus('getting');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setGpsCoords({ latitude: coords.latitude, longitude: coords.longitude });
        setGpsStatus('got');
      },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const getGPSCoords = () =>
    new Promise((resolve) => {
      if (gpsCoords) { resolve(gpsCoords); return; }
      setGpsStatus('getting');
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const c = { latitude: coords.latitude, longitude: coords.longitude };
          setGpsCoords(c);
          setGpsStatus('got');
          resolve(c);
        },
        () => { setGpsStatus('error'); resolve(null); },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });

  // ── Start session ─────────────────────────────────────────────────
  async function handleStart() {
    setStartError('');
    if (!selectedSubId) { setStartError('Please select a subject.'); return; }

    setStartLoading(true);
    const coords = await getGPSCoords();
    if (!coords) {
      setStartError('GPS location is required. Please allow location access and try again.');
      setStartLoading(false);
      return;
    }

    try {
      const { data } = await api.post('/attendance/start-session', {
        subject_id:        parseInt(selectedSubId),
        date:              today,
        teacher_latitude:  coords.latitude,
        teacher_longitude: coords.longitude,
      });
      setSession(data);
      setPhase('active');
    } catch (err) {
      setStartError(err.response?.data?.detail || 'Failed to start session. Please try again.');
    } finally {
      setStartLoading(false);
    }
  }

  // ── End session ───────────────────────────────────────────────────
  function handleEndClick() {
    if (endState === 'idle') {
      setEndState('confirming');
      setEndCountdown(END_CONFIRM_SECS);
      endIntervalRef.current = setInterval(() =>
        setEndCountdown((c) => Math.max(0, c - 1)), 1000);
      endTimerRef.current = setTimeout(doEndSession, END_CONFIRM_SECS * 1000);
    } else {
      clearTimeout(endTimerRef.current);
      clearInterval(endIntervalRef.current);
      doEndSession();
    }
  }

  function cancelEnd() {
    clearTimeout(endTimerRef.current);
    clearInterval(endIntervalRef.current);
    setEndState('idle');
    setEndCountdown(END_CONFIRM_SECS);
  }

  async function doEndSession() {
    clearInterval(endIntervalRef.current);
    setEndState('idle');
    try {
      await api.post(`/attendance/end-session/${session.session_id}`);
    } catch { /* ignore — session may already have timed out */ }
    [qrPollRef, attendancePollRef, sessionTimerRef, countdownRef].forEach((r) =>
      clearInterval(r.current));
    await fetchAttendance(session.session_id);
    setPhase('ended');
  }

  // ── Manual override ───────────────────────────────────────────────
  async function handleOverrideConfirm(status, reason) {
    setOverrideLoading(true);
    try {
      await api.post('/attendance/manual-override', {
        session_id: session.session_id,
        student_id: overrideStudent.student_id,
        status,
        reason,
      });
      setOverrideStudent(null);
      await fetchAttendance(session.session_id);
    } catch { /* handle silently for now */ }
    finally { setOverrideLoading(false); }
  }

  // ── Download CSV ──────────────────────────────────────────────────
  function handleDownload() {
    if (!attendance?.students) return;
    const header  = ['Roll No', 'Name', 'Status', 'Marked At (IST)', 'Face', 'GPS', 'Bluetooth'];
    const rows    = attendance.students.map((s) => [
      s.roll_number ?? '',
      s.name,
      s.status,
      formatIST(s.marked_at),
      s.face_verified      ? 'Yes' : 'No',
      s.gps_verified       ? 'Yes' : 'No',
      s.bluetooth_verified ? 'Yes' : 'No',
    ]);
    const csv  = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href:     url,
      download: `attendance_session_${session.session_id}_${today}.csv`,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Derived attendance numbers ───────────────────────────────────
  const allStudents    = attendance?.students ?? [];
  const presentStud    = allStudents.filter((s) => s.status === 'present');
  const absentStud     = allStudents.filter((s) => s.status !== 'present');
  const totalCount     = attendance?.total_students  ?? session?.total_students ?? 0;
  const presentCount   = attendance?.present_count   ?? presentStud.length;
  const presentPct     = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;

  const pctTextColor = presentPct >= 75 ? 'text-success'
    : presentPct >= 50 ? 'text-warning' : 'text-danger';
  const pctBarColor  = presentPct >= 75 ? 'bg-success'
    : presentPct >= 50 ? 'bg-warning'   : 'bg-danger';

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Session-ended success banner ── */}
      {phase === 'ended' && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl
                        px-5 py-4 flex items-center gap-3 fade-in">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-semibold">Session Ended</p>
            <p className="text-sm text-green-600">
              Final: {presentCount}/{totalCount} present ({presentPct}%)
            </p>
          </div>
          <button
            className="ml-auto text-sm font-medium text-green-700 hover:text-green-900
                       border border-green-300 px-3 py-1.5 rounded-lg hover:bg-green-100
                       transition-colors"
            onClick={() => {
              setPhase('setup');
              setSession(null);
              setAttendance(null);
              setQrData('');
              setSessionElapsed(0);
            }}
          >
            + Start New Session
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ══════════════════════════════════════════
            LEFT COLUMN — Setup / QR Display
        ══════════════════════════════════════════ */}
        <div className="space-y-4">

          {/* ── SETUP CARD ── */}
          {phase === 'setup' && (
            <div className="card space-y-5 fade-in">
              <div className="flex items-center gap-2">
                <span className="text-xl">📋</span>
                <h2 className="text-base font-bold text-slate-800">Start Attendance Session</h2>
              </div>

              {startError && (
                <div role="alert"
                     className="bg-red-50 border border-red-200 text-red-700 rounded-lg
                                px-4 py-3 text-sm flex gap-2">
                  <span>⚠️</span>{startError}
                </div>
              )}

              {/* Subject dropdown */}
              <div>
                <label className="label">Subject</label>
                {subjectsLoading ? (
                  <div className="input-field text-slate-400 flex items-center gap-2">
                    <div style={{ width: 16, height: 16, borderRadius: '50%',
                                  border: '2px solid #e2e8f0', borderTopColor: '#64748b',
                                  animation: 'spin 0.7s linear infinite' }} />
                    Loading your subjects…
                  </div>
                ) : subjectsError || subjects.length === 0 ? (
                  <div className="input-field text-slate-400 flex gap-2">
                    <span>⚠️</span>
                    {subjectsError
                      ? 'Failed to load subjects. Contact administrator.'
                      : 'No subjects assigned to you yet.'}
                  </div>
                ) : (
                  <select
                    value={selectedSubId}
                    onChange={(e) => setSelectedSubId(e.target.value)}
                    className="input-field"
                    disabled={startLoading}
                  >
                    <option value="">— Select a subject —</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name} (Sem {s.semester})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Date (read-only) */}
              <div>
                <label className="label">Date</label>
                <input
                  type="date"
                  value={today}
                  readOnly
                  className="input-field bg-slate-50 text-slate-500 cursor-not-allowed"
                />
              </div>

              {/* Room */}
              <div>
                <label className="label">
                  Room Number
                  <span className="text-slate-400 font-normal ml-1">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. A-101"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="input-field"
                  disabled={startLoading}
                  maxLength={20}
                />
              </div>

              {/* GPS status pill */}
              <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm
                              border ${
                                gpsStatus === 'got'
                                  ? 'bg-green-50 border-green-200 text-green-700'
                                  : gpsStatus === 'error'
                                  ? 'bg-red-50 border-red-200 text-red-700'
                                  : gpsStatus === 'getting'
                                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                                  : 'bg-slate-50 border-slate-200 text-slate-500'
                              }`}>
                <span>
                  {gpsStatus === 'got' ? '📍'
                    : gpsStatus === 'error' ? '⚠️'
                    : gpsStatus === 'getting' ? '🔄'
                    : '🗺️'}
                </span>
                <span className="flex-1">
                  {gpsStatus === 'got'
                    ? `GPS ready — (${gpsCoords.latitude.toFixed(5)}, ${gpsCoords.longitude.toFixed(5)})`
                    : gpsStatus === 'getting'
                    ? 'Getting your location…'
                    : gpsStatus === 'error'
                    ? 'Location access denied — will retry when session starts'
                    : 'GPS will be requested when session starts'}
                </span>
                {(gpsStatus === 'idle' || gpsStatus === 'error') && (
                  <button
                    onClick={requestGPS}
                    className="text-xs font-semibold text-secondary hover:underline flex-shrink-0"
                  >
                    Request now
                  </button>
                )}
              </div>

              <button
                className="btn-primary w-full py-3 text-base"
                style={{ background: '#1a237e' }}
                onClick={handleStart}
                disabled={startLoading || subjectsLoading || subjects.length === 0}
              >
                {startLoading
                  ? <><div className="spinner" />Starting session…</>
                  : '▶ Start Session'}
              </button>
            </div>
          )}

          {/* ── QR DISPLAY CARD ── */}
          {(phase === 'active' || phase === 'ended') && session && (
            <div className="card space-y-5 fade-in">

              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-800 truncate">
                    {session.subject_name}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {session.subject_code} · Session #{session.session_id}
                    {room ? ` · Room ${room}` : ''}
                  </p>
                </div>

                {phase === 'active' ? (
                  <div className="flex items-center gap-1.5 bg-green-50 border border-green-200
                                  rounded-full px-3 py-1 flex-shrink-0">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full
                                       rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                    <span className="text-xs font-semibold text-green-700">LIVE</span>
                  </div>
                ) : (
                  <span className="badge-detained px-3 py-1 flex-shrink-0">ENDED</span>
                )}
              </div>

              {/* QR code */}
              <div className="flex flex-col items-center gap-4">
                <div
                  className="p-5 bg-white border-4 rounded-2xl shadow-lg select-none"
                  style={{ borderColor: '#1a237e', userSelect: 'none', WebkitUserSelect: 'none' }}
                >
                  {qrData ? (
                    <QRCode
                      value={qrData}
                      size={280}
                      level="H"
                      style={{ height: 'auto', maxWidth: '100%', width: '280px' }}
                    />
                  ) : (
                    <div className="w-[280px] h-[280px] flex items-center justify-center">
                      <div style={{
                        width: 48, height: 48, borderRadius: '50%', borderWidth: 4,
                        borderStyle: 'solid', borderColor: '#e2e8f0',
                        borderTopColor: '#1a237e', animation: 'spin 0.7s linear infinite',
                      }} />
                    </div>
                  )}
                </div>

                {/* Countdown bar — only while active */}
                {phase === 'active' && qrData && (
                  <div className="w-full max-w-xs">
                    <CountdownBar countdown={countdown} />
                  </div>
                )}
              </div>

              {/* Security notice */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5
                              flex gap-2 text-xs text-amber-800">
                <span className="flex-shrink-0 mt-0.5">🔒</span>
                <span>
                  This QR is cryptographically protected and changes every 5 seconds.
                  Screenshots and screen recording are blocked on mobile devices.
                </span>
              </div>

              {/* BLE status — always unavailable on web */}
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5
                              flex gap-2 text-xs text-red-700">
                <span className="flex-shrink-0 mt-0.5">📡</span>
                <div>
                  <p className="font-semibold">Bluetooth Beacon: NOT AVAILABLE</p>
                  <p className="mt-0.5 text-red-600">
                    Bluetooth beacon requires the mobile app. Web QR is GPS-verified only.
                  </p>
                </div>
              </div>

              {/* Session timer row */}
              {phase === 'active' && (
                <div className="flex items-center justify-between text-sm pt-2
                                border-t border-slate-100">
                  <span className="text-slate-500">
                    ⏱ Session active:{' '}
                    <span className="font-mono font-semibold text-slate-700">
                      {formatClock(sessionElapsed)}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    {session.total_students} enrolled
                  </span>
                </div>
              )}

              {/* End session button */}
              {phase === 'active' && (
                <div className="flex items-center gap-3">
                  {endState === 'idle' ? (
                    <button className="btn-danger w-full" onClick={handleEndClick}>
                      ⬛ End Session
                    </button>
                  ) : (
                    <>
                      <button className="btn-danger flex-1" onClick={handleEndClick}>
                        Confirm End ({endCountdown}s)
                      </button>
                      <button className="btn-ghost" onClick={cancelEnd}>
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════
            RIGHT COLUMN — Live Attendance Board
        ══════════════════════════════════════════ */}
        <div className="space-y-4">

          {/* Placeholder before session starts */}
          {phase === 'setup' && (
            <div className="card flex flex-col items-center justify-center py-20
                            text-center space-y-3 fade-in">
              <span className="text-6xl">📊</span>
              <p className="font-semibold text-slate-600">Live attendance appears here</p>
              <p className="text-sm text-slate-400">Start a session to see real-time data.</p>
            </div>
          )}

          {/* Live board */}
          {(phase === 'active' || phase === 'ended') && (
            <div className="card space-y-4 fade-in">

              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800">Live Attendance</h2>
                {phase === 'active' && (
                  <button
                    className="text-xs text-secondary hover:underline"
                    onClick={() => session && fetchAttendance(session.session_id)}
                  >
                    ↻ Refresh
                  </button>
                )}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Present', value: presentCount,               color: 'text-success' },
                  { label: 'Absent',  value: totalCount - presentCount,  color: 'text-danger'  },
                  { label: 'Total',   value: totalCount,                 color: 'text-slate-700' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className={`text-2xl font-extrabold tabular-nums ${color}`}>{value}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Large percentage */}
              <div className="text-center">
                <p className={`text-6xl font-black tabular-nums ${pctTextColor}`}>
                  {presentPct}%
                </p>
                <p className="text-xs text-slate-400 mt-1">Attendance rate</p>
              </div>

              {/* Bar */}
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${pctBarColor}`}
                  style={{ width: `${presentPct}%` }}
                />
              </div>

              {/* Tabs */}
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                {[
                  { key: 'present', label: `✅ Present (${presentStud.length})` },
                  { key: 'absent',  label: `❌ Absent  (${absentStud.length})`  },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors
                                ${activeTab === key
                                  ? 'bg-white text-slate-800 shadow-sm'
                                  : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Student list */}
              <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                {activeTab === 'present' && (
                  presentStud.length === 0
                    ? (
                      <p className="text-center text-slate-400 text-sm py-10">
                        No students marked present yet.
                      </p>
                    )
                    : presentStud.map((s) => (
                      <div key={s.student_id}
                           className="flex items-center gap-3 px-3 py-2.5 rounded-xl
                                      bg-green-50 border border-green-100">
                        <Avatar name={s.name} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                          <p className="text-xs text-slate-500">{s.roll_number ?? '—'}</p>
                        </div>
                        <div className="text-right flex-shrink-0 space-y-1">
                          <p className="text-xs text-slate-500 tabular-nums">
                            {formatIST(s.marked_at)}
                          </p>
                          <span className="badge-safe text-[10px] px-1.5 py-0.5">
                            QR Scan
                          </span>
                        </div>
                      </div>
                    ))
                )}

                {activeTab === 'absent' && (
                  absentStud.length === 0
                    ? (
                      <p className="text-center text-slate-400 text-sm py-10">
                        🎉 All students have marked attendance!
                      </p>
                    )
                    : absentStud.map((s) => (
                      <div key={s.student_id}
                           className="flex items-center gap-3 px-3 py-2.5 rounded-xl
                                      bg-red-50 border border-red-100">
                        <Avatar name={s.name} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                          <p className="text-xs text-slate-500">{s.roll_number ?? '—'}</p>
                        </div>
                        {phase === 'active' && (
                          <button
                            className="flex-shrink-0 text-xs font-semibold text-secondary
                                       border border-secondary/40 hover:border-secondary
                                       hover:bg-secondary/5 px-2.5 py-1 rounded-lg
                                       transition-colors"
                            onClick={() => setOverrideStudent(s)}
                          >
                            Mark Present
                          </button>
                        )}
                      </div>
                    ))
                )}
              </div>

              {/* Bottom controls */}
              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <button
                  className="btn-ghost flex-1 text-sm justify-center"
                  onClick={handleDownload}
                  disabled={!attendance}
                >
                  📥 Download CSV
                </button>

                {phase === 'active' && (
                  endState === 'idle' ? (
                    <button className="btn-danger flex-1 text-sm" onClick={handleEndClick}>
                      ⬛ End Session
                    </button>
                  ) : (
                    <button className="btn-danger flex-1 text-sm" onClick={handleEndClick}>
                      Confirm ({endCountdown}s)
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Manual Override Dialog ── */}
      {overrideStudent && (
        <OverrideDialog
          student={overrideStudent}
          loading={overrideLoading}
          onConfirm={handleOverrideConfirm}
          onClose={() => setOverrideStudent(null)}
        />
      )}
    </div>
  );
}

