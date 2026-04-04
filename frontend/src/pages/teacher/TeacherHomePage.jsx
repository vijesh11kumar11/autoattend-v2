/**
 * AutoAttend AI v2.0 — Teacher Dashboard Home (rebuilt for Timetable + One-Tap Start)
 *
 * • Hero card: "Current Class" with ▶ Start Attendance (polls every 60s)
 * • Today's Schedule — card list with status badges
 * • Ward Students summary (if tutor)
 * • Quick Stats
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const STATUS_BG = {
  not_started: 'bg-slate-100 text-slate-500',
  active:      'bg-green-100 text-green-700',
  ended:       'bg-blue-100 text-blue-700',
  expired:     'bg-amber-100 text-amber-700',
};

const StatCard = ({ icon, label, value, color }) => (
  <div className="card p-5 flex items-center gap-4">
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${color}`}>
      {icon}
    </div>
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
    </div>
  </div>
);

export default function TeacherHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

  // Current class (polled every 60s)
  const [currentClass, setCurrentClass] = useState(null);
  const [currentLoading, setCurrentLoading] = useState(true);

  // Today's schedule
  const [todaySchedule, setTodaySchedule] = useState([]);

  // Ward students summary
  const [wardCount, setWardCount]     = useState(null);
  const [defaulterCount, setDefaulterCount] = useState(null);

  // Start attendance
  const [starting, setStarting]       = useState(false);
  const [flash, setFlash]             = useState('');

  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  // Load main dashboard data
  useEffect(() => {
    api.get('/faculty/my-dashboard')
      .then(r => { if (isMounted.current) setData(r.data); })
      .catch(() => { if (isMounted.current) setError('Failed to load dashboard data.'); })
      .finally(() => { if (isMounted.current) setLoading(false); });
  }, []);

  // Load today's schedule
  useEffect(() => {
    api.get('/timetable/my-today')
      .then(r => { if (isMounted.current) setTodaySchedule(r.data || []); })
      .catch(() => {});
  }, []);

  // Load ward students count
  useEffect(() => {
    api.get('/tutor/my-ward-students')
      .then(r => {
        if (!isMounted.current) return;
        const wards = r.data || [];
        setWardCount(wards.length);
        setDefaulterCount(wards.filter(w => w.needs_attention).length);
      })
      .catch(() => {}); // not a tutor — fine
  }, []);

  // Poll current class every 60 seconds
  const fetchCurrentClass = useCallback(() => {
    api.get('/timetable/my-current-class')
      .then(r => { if (isMounted.current) setCurrentClass(r.data); })
      .catch(() => { if (isMounted.current) setCurrentClass(null); })
      .finally(() => { if (isMounted.current) setCurrentLoading(false); });
  }, []);

  useEffect(() => {
    fetchCurrentClass();
    const interval = setInterval(fetchCurrentClass, 60_000);
    return () => clearInterval(interval);
  }, [fetchCurrentClass]);

  // One-tap start attendance
  const handleStart = async (timetableId) => {
    setStarting(true);
    try {
      // Get teacher's GPS
      let lat = 0, lon = 0;
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        );
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      } catch { /* GPS unavailable — use 0,0 */ }

      const r = await api.post(`/timetable/start-from-timetable/${timetableId}`, {
        teacher_latitude: lat,
        teacher_longitude: lon,
      });
      setFlash(`Session started for ${r.data.subject_name} — ${r.data.total_students} students enrolled.`);
      fetchCurrentClass();
      // Refresh today's schedule
      api.get('/timetable/my-today').then(r2 => setTodaySchedule(r2.data || [])).catch(() => {});
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to start session.');
    } finally { setStarting(false); }
  };

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading dashboard…</p>
      </div>
    );
  }

  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Welcome ── */}
      <div className="card bg-gradient-to-r from-[#1a237e] to-[#283593] p-6 text-white">
        <h1 className="text-xl font-bold">Welcome back, {data?.teacher_name || user?.name}!</h1>
        <p className="text-blue-200 text-sm mt-1">Here's your teaching overview for today.</p>
      </div>

      {/* ── Current Class Hero Card ── */}
      {!currentLoading && (
        currentClass ? (
          <div className="card border-2 border-[#1a237e] overflow-hidden">
            <div className="bg-[#1a237e] px-5 py-2 text-white text-sm font-semibold flex items-center gap-2">
              <span className="animate-pulse">🔴</span> CURRENT CLASS
            </div>
            <div className="p-5 flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-lg font-bold text-slate-800">{currentClass.subject_name}</p>
                <p className="text-sm text-slate-400 font-mono">{currentClass.subject_code}</p>
                <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                  <span>🕐 {currentClass.start_time} – {currentClass.end_time}</span>
                  <span>🏫 {currentClass.room || '—'}</span>
                  {currentClass.section_name && <span>👥 {currentClass.section_name}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {currentClass.can_start_attendance && (
                  <button
                    onClick={() => handleStart(currentClass.timetable_id)}
                    disabled={starting}
                    className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50 text-lg shadow-lg hover:shadow-xl transition-all">
                    {starting ? '⏳ Starting…' : '▶ Start Attendance'}
                  </button>
                )}
                {currentClass.can_end_attendance && (
                  <span className="px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-semibold">
                    ✅ Session Active (ID: {currentClass.session_id})
                  </span>
                )}
                {currentClass.session_status === 'ended' && (
                  <span className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-semibold">
                    📋 Session Ended
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="card p-5 text-center text-slate-400 text-sm border-dashed border-2">
            No class happening right now. Check your schedule below.
          </div>
        )
      )}

      {/* ── Quick Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="📚" label="My Subjects" value={data?.total_subjects ?? 0} color="bg-blue-50" />
        <StatCard icon="📋" label="Total Sessions" value={data?.total_sessions ?? 0} color="bg-green-50" />
        <StatCard icon="🔴" label="Active Now" value={data?.active_sessions ?? 0} color="bg-red-50" />
        <StatCard icon="📊" label="Avg Attendance" value={`${data?.avg_attendance ?? 0}%`} color="bg-amber-50" />
      </div>

      {/* ── Ward Students Summary (if tutor) ── */}
      {wardCount !== null && wardCount > 0 && (
        <div className="card p-5 flex items-center justify-between cursor-pointer hover:shadow-md transition"
             onClick={() => navigate('/teacher/ward-students')}>
          <div className="flex items-center gap-4">
            <span className="text-3xl">🎓</span>
            <div>
              <p className="font-semibold text-slate-700">My Ward Students</p>
              <p className="text-sm text-slate-400">
                {wardCount} ward{wardCount !== 1 ? 's' : ''}
                {defaulterCount > 0 && (
                  <span className="text-red-500 ml-2">· {defaulterCount} need attention</span>
                )}
              </p>
            </div>
          </div>
          <span className="text-slate-400">→</span>
        </div>
      )}

      {/* ── Today's Schedule ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">
          📅 Today's Schedule
        </div>
        {todaySchedule.length > 0 ? (
          <div className="divide-y">
            {todaySchedule.map(slot => (
              <div key={slot.timetable_id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  {slot.color_tag && (
                    <div className="w-2 h-10 rounded-full" style={{ backgroundColor: slot.color_tag }} />
                  )}
                  <div>
                    <p className="font-medium text-slate-700">
                      {slot.subject_name} <span className="text-slate-400 text-sm">({slot.subject_code})</span>
                    </p>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                      <span className="font-mono">{slot.start_time} – {slot.end_time}</span>
                      <span>🏫 {slot.room || '—'}</span>
                      {slot.section_name && <span>👥 {slot.section_name}</span>}
                      {slot.is_lab && <span className="px-1 py-0.5 bg-purple-100 text-purple-600 rounded">LAB</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BG[slot.session_status] || STATUS_BG.not_started}`}>
                    {slot.session_status === 'not_started' ? 'Not Started' : slot.session_status}
                  </span>
                  {slot.session_status === 'not_started' && (
                    <button onClick={() => handleStart(slot.timetable_id)} disabled={starting}
                            className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                      ▶ Start
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 text-sm">
            No classes scheduled for today.
          </div>
        )}
      </div>

      {/* ── Today's Sessions (from old dashboard data) ── */}
      {data?.todays_sessions?.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">
            🎯 Today's Attendance Sessions
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b">
                <th className="px-5 py-2 text-left">Subject</th>
                <th className="px-5 py-2 text-left">Time</th>
                <th className="px-5 py-2 text-left">Status</th>
                <th className="px-5 py-2 text-left">Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.todays_sessions.map(s => {
                const pct = s.total_students ? Math.round((s.present_count / s.total_students) * 100) : 0;
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-medium text-slate-700">
                      {s.subject_name} <span className="text-slate-400">({s.subject_code})</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">{s.start_time?.slice(0, 5)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${
                        s.status === 'active' ? 'bg-green-100 text-green-700' :
                        s.status === 'ended'  ? 'bg-blue-100 text-blue-700'  : 'bg-amber-100 text-amber-700'
                      }`}>{s.status}</span>
                    </td>
                    <td className="px-5 py-3 text-sm">
                      <span className="font-bold">{s.present_count}/{s.total_students}</span>
                      <span className="text-slate-400 ml-1">({pct}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button onClick={() => navigate('/teacher/qr')}
                className="card p-5 text-center hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-[#1a237e]">
          <span className="text-3xl block mb-2">📱</span>
          <p className="font-semibold text-slate-700">Generate QR</p>
          <p className="text-xs text-slate-400 mt-1">Manual session start</p>
        </button>
        <button onClick={() => navigate('/teacher/history')}
                className="card p-5 text-center hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-[#1a237e]">
          <span className="text-3xl block mb-2">📜</span>
          <p className="font-semibold text-slate-700">Attendance History</p>
          <p className="text-xs text-slate-400 mt-1">View past sessions</p>
        </button>
        <button onClick={() => navigate('/teacher/classes')}
                className="card p-5 text-center hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-[#1a237e]">
          <span className="text-3xl block mb-2">📖</span>
          <p className="font-semibold text-slate-700">My Classes</p>
          <p className="text-xs text-slate-400 mt-1">Timetable & subjects</p>
        </button>
      </div>
    </div>
  );
}
