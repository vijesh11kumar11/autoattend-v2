/**
 * TRACELN v2.0 — Teacher Dashboard Home (PROMPT 6 Rebuild)
 *
 * 3-column layout:
 *   Col 1: Current Class hero + Today's Schedule timeline
 *   Col 2: Subject cards with health scores
 *   Col 3: Alerts (wards, pending leaves, anomalies, quick actions)
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const STATUS_BG = {
  not_started: 'bg-slate-100 text-slate-500',
  active: 'bg-green-100 text-green-700',
  ended: 'bg-blue-100 text-blue-700',
  expired: 'bg-amber-100 text-amber-700',
};

function HealthBadge({ score }) {
  if (score == null) return <span className="text-xs text-slate-400">—</span>;
  const color =
    score >= 75
      ? 'bg-green-100 text-green-700'
      : score >= 50
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{score}/100</span>;
}

export default function TeacherHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentClass, setCurrentClass] = useState(null);
  const [todaySchedule, setTodaySchedule] = useState([]);
  const [healthScores, setHealthScores] = useState({});
  const [starting, setStarting] = useState(false);
  const [flash, setFlash] = useState('');

  // ── Load new teacher dashboard ──
  useEffect(() => {
    let cancelled = false;
    api
      .get('/teacher/dashboard')
      .then((r) => {
        if (!cancelled) setDashboard(r.data);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load dashboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load today's schedule ──
  useEffect(() => {
    let cancelled = false;
    api
      .get('/timetable/my-today')
      .then((r) => {
        if (!cancelled) setTodaySchedule(r.data || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Poll current class every 60s ──
  const fetchCurrentClass = useCallback(() => {
    api
      .get('/timetable/my-current-class')
      .then((r) => setCurrentClass(r.data))
      .catch(() => setCurrentClass(null));
  }, []);

  useEffect(() => {
    fetchCurrentClass();
    const interval = setInterval(fetchCurrentClass, 60_000);
    return () => clearInterval(interval);
  }, [fetchCurrentClass]);

  // ── Fetch health scores for each subject ──
  useEffect(() => {
    if (!dashboard?.my_subjects?.length) return;
    let cancelled = false;
    dashboard.my_subjects.forEach((s) => {
      api
        .get(`/analytics/subject-health/${s.subject_id}`)
        .then((r) => {
          if (!cancelled) {
            setHealthScores((prev) => ({ ...prev, [s.subject_id]: r.data.health_score }));
          }
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [dashboard]);

  // ── One-tap start attendance ──
  const handleStart = async (timetableId) => {
    setStarting(true);
    try {
      let lat = 0,
        lon = 0;
      try {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        );
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      } catch {
        /* GPS unavailable */
      }

      const r = await api.post(`/timetable/start-from-timetable/${timetableId}`, {
        teacher_latitude: lat,
        teacher_longitude: lon,
      });
      setFlash(
        `Session started for ${r.data.subject_name} — ${r.data.total_students} students enrolled.`
      );
      fetchCurrentClass();
      api
        .get('/timetable/my-today')
        .then((r2) => setTodaySchedule(r2.data || []))
        .catch(() => {});
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to start session.');
    } finally {
      setStarting(false);
    }
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

  const d = dashboard || {};
  const subjects = d.my_subjects || [];
  const recentSessions = d.recent_sessions || [];
  const alerts = d.low_attendance_alerts || [];
  const ward = d.ward_summary;

  return (
    <div className="space-y-6">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* ── Welcome ── */}
      <div className="card bg-gradient-to-r from-[#1a237e] to-[#283593] p-6 text-white">
        <h1 className="text-xl font-bold">Welcome back, {user?.name}!</h1>
        <p className="text-blue-200 text-sm mt-1">Here's your teaching overview for today.</p>
      </div>

      {/* ═══ 3-COLUMN GRID ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── COL 1: Current Class + Schedule ── */}
        <div className="space-y-4">
          {/* Current Class Hero */}
          {currentClass ? (
            <div className="card border-2 border-[#1a237e] overflow-hidden">
              <div className="bg-[#1a237e] px-4 py-2 text-white text-sm font-semibold flex items-center gap-2">
                <span className="animate-pulse">🔴</span> CURRENT CLASS
              </div>
              <div className="p-4">
                <p className="text-lg font-bold text-slate-800">{currentClass.subject_name}</p>
                <p className="text-sm text-slate-400 font-mono">{currentClass.subject_code}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                  <span>
                    🕐 {currentClass.start_time} – {currentClass.end_time}
                  </span>
                  <span>🏫 {currentClass.room || '—'}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  {currentClass.can_start_attendance && (
                    <button
                      onClick={() => handleStart(currentClass.timetable_id)}
                      disabled={starting}
                      className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50 shadow text-sm"
                    >
                      {starting ? '⏳ Starting…' : '▶ Start Attendance'}
                    </button>
                  )}
                  {currentClass.can_end_attendance && (
                    <span className="px-3 py-2 bg-green-100 text-green-700 rounded-lg text-xs font-semibold">
                      ✅ Active (ID: {currentClass.session_id})
                    </span>
                  )}
                  {currentClass.session_status === 'ended' && (
                    <span className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold">
                      📋 Ended
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-4 text-center text-slate-400 text-sm border-dashed border-2">
              No class happening right now.
            </div>
          )}

          {/* Today's Schedule */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-slate-700 text-sm">
              📅 Today's Schedule
            </div>
            {todaySchedule.length > 0 ? (
              <div className="divide-y">
                {todaySchedule.map((slot) => (
                  <div
                    key={slot.timetable_id}
                    className="px-4 py-2.5 flex items-center justify-between hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2">
                      {slot.color_tag && (
                        <div
                          className="w-1.5 h-8 rounded-full"
                          style={{ backgroundColor: slot.color_tag }}
                        />
                      )}
                      <div>
                        <p className="font-medium text-slate-700 text-sm">{slot.subject_name}</p>
                        <p className="text-xs text-slate-400 font-mono">
                          {slot.start_time} – {slot.end_time} · {slot.room || '—'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BG[slot.session_status] || STATUS_BG.not_started}`}
                      >
                        {slot.session_status === 'not_started' ? 'Pending' : slot.session_status}
                      </span>
                      {slot.session_status === 'not_started' && (
                        <button
                          onClick={() => handleStart(slot.timetable_id)}
                          disabled={starting}
                          className="text-[10px] px-2 py-0.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                        >
                          ▶
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">No classes today.</div>
            )}
          </div>

          {/* Recent Sessions */}
          {recentSessions.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-slate-700 text-sm">
                🕑 Recent Sessions
              </div>
              <div className="divide-y">
                {recentSessions.map((s) => {
                  const pct = s.total ? Math.round((s.present / s.total) * 100) : 0;
                  return (
                    <div key={s.session_id} className="px-4 py-2 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{s.subject_name}</p>
                        <p className="text-xs text-slate-400">{s.date}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold">
                          {s.present}/{s.total}
                        </span>
                        <span
                          className={`ml-1 text-xs ${pct >= 75 ? 'text-green-600' : 'text-red-500'}`}
                        >
                          ({pct}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── COL 2: Subject Cards ── */}
        <div className="space-y-4">
          <div className="card px-4 py-2.5 bg-slate-50 border-b font-semibold text-slate-700 text-sm">
            📚 My Subjects ({subjects.length})
          </div>
          {subjects.length > 0 ? (
            subjects.map((s) => (
              <div
                key={s.subject_id}
                onClick={() => navigate(`/teacher/analytics/${s.subject_id}`)}
                className="card p-4 cursor-pointer hover:shadow-md hover:border-[#1a237e] border-2 border-transparent transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800">{s.name}</p>
                    <p className="text-xs text-slate-400 font-mono">
                      {s.code} · Sem {s.semester}
                    </p>
                  </div>
                  <HealthBadge score={healthScores[s.subject_id]} />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="bg-blue-50 rounded-lg py-2">
                    <p className="text-lg font-bold text-blue-700">{s.total_students}</p>
                    <p className="text-[10px] text-blue-400">Students</p>
                  </div>
                  <div className="bg-green-50 rounded-lg py-2">
                    <p className="text-lg font-bold text-green-700">{s.sessions_conducted}</p>
                    <p className="text-[10px] text-green-400">Sessions</p>
                  </div>
                  <div
                    className={`rounded-lg py-2 ${s.avg_attendance_pct >= 75 ? 'bg-emerald-50' : 'bg-red-50'}`}
                  >
                    <p
                      className={`text-lg font-bold ${s.avg_attendance_pct >= 75 ? 'text-emerald-700' : 'text-red-700'}`}
                    >
                      {s.avg_attendance_pct}%
                    </p>
                    <p
                      className={`text-[10px] ${s.avg_attendance_pct >= 75 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      Avg Att.
                    </p>
                  </div>
                </div>
                {s.section_name && (
                  <p className="text-xs text-slate-400 mt-2">Section: {s.section_name}</p>
                )}
                {s.last_session_date && (
                  <p className="text-[10px] text-slate-300 mt-1">
                    Last session: {s.last_session_date}
                  </p>
                )}
              </div>
            ))
          ) : (
            <div className="card p-6 text-center text-slate-400 text-sm">No subjects assigned.</div>
          )}
        </div>

        {/* ── COL 3: Alerts + Ward + Quick Actions ── */}
        <div className="space-y-4">
          {/* Ward Summary */}
          {ward && ward.is_tutor && (
            <div
              className="card p-4 cursor-pointer hover:shadow-md transition"
              onClick={() => navigate('/teacher/ward-students')}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎓</span>
                <div>
                  <p className="font-semibold text-slate-700">My Ward Students</p>
                  <p className="text-sm text-slate-400">
                    {ward.ward_count} ward{ward.ward_count !== 1 ? 's' : ''}
                    {ward.needs_attention_count > 0 && (
                      <span className="text-red-500 ml-1">
                        · {ward.needs_attention_count} need attention
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {ward.pending_leaves > 0 && (
                <div className="mt-2 px-3 py-1.5 bg-amber-50 rounded-lg text-sm text-amber-700">
                  ✋ {ward.pending_leaves} pending leave request
                  {ward.pending_leaves !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}

          {/* Low Attendance Alerts */}
          {alerts.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 bg-red-50 border-b font-semibold text-red-700 text-sm">
                ⚠️ Low Attendance Alerts ({alerts.length})
              </div>
              <div className="divide-y max-h-60 overflow-y-auto">
                {alerts.slice(0, 8).map((a) => (
                  <div key={a.student_id} className="px-4 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{a.name}</p>
                      <p className="text-xs text-slate-400">{a.roll_number}</p>
                    </div>
                    <span className="text-sm font-bold text-red-600">{a.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-slate-700 text-sm">
              ⚡ Quick Actions
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => navigate('/teacher/qr')}
                className="p-3 bg-blue-50 rounded-lg text-center hover:bg-blue-100 transition"
              >
                <span className="text-xl block">📱</span>
                <p className="text-xs font-medium text-blue-700 mt-1">Generate QR</p>
              </button>
              <button
                onClick={() => navigate('/teacher/history')}
                className="p-3 bg-green-50 rounded-lg text-center hover:bg-green-100 transition"
              >
                <span className="text-xl block">📜</span>
                <p className="text-xs font-medium text-green-700 mt-1">History</p>
              </button>
              <button
                onClick={() => navigate('/teacher/leave-requests')}
                className="p-3 bg-amber-50 rounded-lg text-center hover:bg-amber-100 transition"
              >
                <span className="text-xl block">✋</span>
                <p className="text-xs font-medium text-amber-700 mt-1">Leaves</p>
              </button>
              <button
                onClick={() => navigate('/teacher/twm')}
                className="p-3 bg-purple-50 rounded-lg text-center hover:bg-purple-100 transition"
              >
                <span className="text-xl block">🤝</span>
                <p className="text-xs font-medium text-purple-700 mt-1">TWM</p>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
