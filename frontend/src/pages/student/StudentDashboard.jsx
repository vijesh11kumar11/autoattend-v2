/**
 * AutoAttend AI v2.0 — Student Dashboard
 *
 * Routes served (within /student/*):
 *   dashboard  → StudentHome (this file)
 *   scan-qr    → stub
 *   attendance → stub
 *   timetable  → stub
 *   download   → stub
 *
 * APIs used:
 *   GET /api/auth/me                               → profile
 *   GET /api/attendance/student/{id}/summary       → subject cards
 *   GET /api/attendance/student/{id}/calendar      → 30-day calendar
 *   GET /api/attendance/student/{id}/recent        → last 10 records
 */

import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import DashboardLayout from '../../components/DashboardLayout';

// ── helpers ───────────────────────────────────────────────────────────
const THRESHOLD = 75;

function statusMeta(status) {
  switch (status) {
    case 'safe':     return { label: 'SAFE',     icon: '✅', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' };
    case 'warning':  return { label: 'WARNING',  icon: '⚠️', color: 'text-amber-500',   bg: 'bg-amber-50 border-amber-200'   };
    case 'critical': return { label: 'CRITICAL', icon: '❌', color: 'text-red-500',      bg: 'bg-red-50 border-red-200'       };
    case 'detained': return { label: 'DETAINED', icon: '🚨', color: 'text-red-700',      bg: 'bg-red-100 border-red-300'      };
    default:         return { label: status,     icon: '',    color: 'text-slate-500',    bg: 'bg-slate-50 border-slate-200'   };
  }
}

function classesNeeded(present, total) {
  // classes needed to reach THRESHOLD when adding more classes
  // if present/total < THRESHOLD/100, need x more so (present+x)/(total+x) >= THRESHOLD/100
  if (total === 0) return 0;
  const pct = present / total;
  if (pct * 100 >= THRESHOLD) return 0;
  // (present + x) / (total + x) >= THRESHOLD/100
  // => present + x >= THRESHOLD/100 * (total + x)
  // => present + x - THRESHOLD/100 * total - THRESHOLD/100 * x >= 0
  // => x * (1 - THRESHOLD/100) >= THRESHOLD/100 * total - present
  // => x >= (THRESHOLD/100 * total - present) / (1 - THRESHOLD/100)
  const t = THRESHOLD / 100;
  return Math.ceil((t * total - present) / (1 - t));
}

function pctBarColor(pct) {
  if (pct >= THRESHOLD)    return 'bg-emerald-500';
  if (pct >= THRESHOLD - 10) return 'bg-amber-400';
  return 'bg-red-500';
}

// ── Avatar component ──────────────────────────────────────────────────
function Avatar({ name, size = 'lg' }) {
  const initials = (name || 'S')
    .split(' ').filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('');
  const sz = size === 'lg' ? 'w-16 h-16 text-xl' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br from-blue-500 to-indigo-600
                     flex items-center justify-center font-bold text-white flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ── Header Card ───────────────────────────────────────────────────────
function HeaderCard({ profile, overallPct }) {
  const navigate = useNavigate();
  const pctColor = overallPct >= THRESHOLD ? 'text-emerald-600'
                 : overallPct >= THRESHOLD - 10 ? 'text-amber-500'
                 : 'text-red-500';

  return (
    <div className="card p-5 flex items-start gap-4 flex-wrap">
      <Avatar name={profile.name} size="lg" />

      <div className="flex-1 min-w-0 space-y-0.5">
        <h2 className="text-lg font-bold text-slate-800 truncate">{profile.name}</h2>
        <p className="text-sm text-slate-500 font-mono">{profile.roll_number}</p>
        {profile.course_name && (
          <p className="text-sm text-slate-500">{profile.course_name}
            {profile.semester ? <span className="ml-2 text-slate-400">· Sem {profile.semester}</span> : null}
          </p>
        )}
      </div>

      <div className="flex items-center gap-5">
        <div className="text-center">
          <p className={`text-3xl font-extrabold ${pctColor}`}>{overallPct ?? '—'}%</p>
          <p className="text-xs text-slate-400 mt-0.5">Overall</p>
        </div>
        <button
          className="btn-primary text-sm flex items-center gap-2"
          onClick={() => navigate('/student/scan-qr')}
        >
          <span>📷</span> Scan QR
        </button>
      </div>
    </div>
  );
}

// ── Warning Banner ────────────────────────────────────────────────────
function WarningBanner({ subjects }) {
  const atRisk = subjects.filter(s => s.percentage < THRESHOLD);
  if (!atRisk.length) return null;

  return (
    <div className="card p-4 border-red-200 bg-red-50 space-y-1">
      {atRisk.map(s => {
        const needed = classesNeeded(s.present, s.total_sessions);
        return (
          <p key={s.subject_id} className="text-sm text-red-700 font-medium">
            ⚠️ <span className="font-bold">{s.subject_name}</span> — {s.percentage}% attendance.
            {needed > 0
              ? ` Attend ${needed} more class${needed > 1 ? 'es' : ''} to reach ${THRESHOLD}%. Contact your HOD.`
              : ` Attendance is critically low. Contact your HOD immediately.`}
          </p>
        );
      })}
    </div>
  );
}

// ── Subject Card ──────────────────────────────────────────────────────
function SubjectCard({ subj }) {
  const meta = statusMeta(subj.attendance_status);
  const needed = classesNeeded(subj.present, subj.total_sessions);

  return (
    <div className={`card p-4 border ${meta.bg} space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 truncate">{subj.subject_name}</p>
          <p className="text-xs text-slate-400 font-mono">{subj.subject_code}</p>
        </div>
        <span className={`text-sm font-bold ${meta.color} flex-shrink-0`}>
          {subj.percentage}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pctBarColor(subj.percentage)}`}
          style={{ width: `${Math.min(subj.percentage, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{subj.present}/{subj.total_sessions} classes attended</span>
        <span className={`font-semibold ${meta.color}`}>
          {meta.icon} {meta.label}
        </span>
      </div>

      {subj.attendance_status === 'warning' && needed > 0 && (
        <p className="text-xs text-amber-600 font-medium">
          Need {needed} more class{needed > 1 ? 'es' : ''} to reach {THRESHOLD}%
        </p>
      )}
      {subj.attendance_status === 'critical' && (
        <p className="text-xs text-red-500 font-medium">Attendance low — contact HOD</p>
      )}
      {subj.attendance_status === 'detained' && (
        <p className="text-xs text-red-700 font-bold">Cannot sit for exams!</p>
      )}
    </div>
  );
}

// ── Attendance Calendar ───────────────────────────────────────────────
const DAY_META = {
  P: { bg: 'bg-emerald-500', text: 'text-white',        tip: 'Present'       },
  A: { bg: 'bg-red-400',     text: 'text-white',        tip: 'Absent'        },
  L: { bg: 'bg-amber-400',   text: 'text-white',        tip: 'Late'          },
  M: { bg: 'bg-blue-400',    text: 'text-white',        tip: 'Medical Leave' },
  D: { bg: 'bg-purple-400',  text: 'text-white',        tip: 'Duty Leave'    },
  '':{ bg: 'bg-slate-100',   text: 'text-slate-300',    tip: 'No class'      },
};

function AttendanceCalendar({ days }) {
  const [selected, setSelected] = useState(null);

  if (!days || !days.length) return null;

  return (
    <div className="card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Attendance Calendar (Last 30 Days)</h3>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(DAY_META).filter(([k]) => k !== '').map(([code, m]) => (
          <span key={code} className="flex items-center gap-1">
            <span className={`w-5 h-5 rounded ${m.bg} inline-block`} />
            <span className="text-slate-500">{m.tip}</span>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-5 h-5 rounded bg-slate-100 inline-block" />
          <span className="text-slate-500">No class</span>
        </span>
      </div>

      {/* Grid */}
      <div className="flex flex-wrap gap-1.5">
        {days.map(day => {
          const m = DAY_META[day.day_code] || DAY_META[''];
          const isSelected = selected === day.date;
          return (
            <button
              key={day.date}
              onClick={() => setSelected(isSelected ? null : day.date)}
              title={`${day.date}: ${m.tip}`}
              className={`w-7 h-7 rounded text-xs font-bold ${m.bg} ${m.text}
                          transition-all hover:scale-110 focus:outline-none
                          ${isSelected ? 'ring-2 ring-offset-1 ring-blue-500 scale-110' : ''}`}
            >
              {day.day_code || new Date(day.date).getDate()}
            </button>
          );
        })}
      </div>

      {/* Detail popup */}
      {selected && (() => {
        const day = days.find(d => d.date === selected);
        if (!day || !day.subjects.length) return (
          <p className="text-xs text-slate-400 mt-1">No classes on {selected}</p>
        );
        return (
          <div className="mt-2 text-xs space-y-1 border-t border-slate-100 pt-2">
            <p className="font-semibold text-slate-600">{selected}</p>
            {day.subjects.map((s, i) => {
              const sm = statusMeta(s.status);
              return (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-slate-700">{s.subject_name}</span>
                  <span className={`font-semibold ${sm.color}`}>{sm.icon} {s.status}</span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

// ── Recent Activity ───────────────────────────────────────────────────
function RecentActivity({ records }) {
  if (!records || !records.length) return null;

  const statusColor = (s) => {
    if (s === 'present') return 'badge-success';
    if (s === 'absent')  return 'badge-danger';
    if (s === 'late')    return 'badge-warning';
    return 'badge-secondary';
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700">Recent Activity</h3>
      </div>
      <table className="w-full text-sm text-left">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            {['Date', 'Subject', 'Status', 'Marked Via'].map(h => (
              <th key={h} className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {records.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 text-slate-500 text-xs">{r.date}</td>
              <td className="px-4 py-2.5">
                <p className="font-medium text-slate-800">{r.subject_name}</p>
                <p className="text-xs text-slate-400 font-mono">{r.subject_code}</p>
              </td>
              <td className="px-4 py-2.5">
                <span className={`badge ${statusColor(r.status)} capitalize`}>{r.status.replace('_', ' ')}</span>
              </td>
              <td className="px-4 py-2.5 text-slate-500 text-xs capitalize">
                {r.face_verified ? '🔒 ' : ''}{r.marked_via.replace('_', ' ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// StudentHome — main dashboard content
// ═══════════════════════════════════════════════════════════════════════
function StudentHome() {
  const { user } = useAuth();
  const studentId = user?.id;

  const [profile,   setProfile]   = useState(null);
  const [summary,   setSummary]   = useState(null);
  const [calendar,  setCalendar]  = useState(null);
  const [recent,    setRecent]    = useState(null);
  const [todayTT,   setTodayTT]   = useState([]);
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(true);

  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  useEffect(() => {
    if (!studentId) return;

    Promise.all([
      api.get('/auth/me'),
      api.get(`/attendance/student/${studentId}/summary`),
      api.get(`/attendance/student/${studentId}/calendar`, { params: { days: 30 } }),
      api.get(`/attendance/student/${studentId}/recent`,   { params: { limit: 10 } }),
    ])
      .then(([p, s, c, r]) => {
        if (!isMounted.current) return;
        setProfile(p.data);
        setSummary(s.data);
        setCalendar(c.data);
        setRecent(r.data);
      })
      .catch(() => {
        if (isMounted.current) setError('Failed to load dashboard. Please refresh.');
      })
      .finally(() => {
        if (isMounted.current) setLoading(false);
      });
  }, [studentId]);

  // Load today's timetable from new endpoint
  useEffect(() => {
    api.get('/timetable/my-section-timetable')
      .then(r => {
        if (!isMounted.current) return;
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        const dayData = (r.data || []).find(d => d.day?.toLowerCase() === today);
        setTodayTT(dayData?.entries || []);
      })
      .catch(() => {});
  }, []);

  if (loading) return <div className="p-8 text-slate-400 text-sm animate-pulse">Loading your dashboard…</div>;
  if (error)   return <div className="p-8 text-red-500 text-sm">{error}</div>;
  if (!profile || !summary) return null;

  // Overall attendance %: weighted by total_sessions
  const totalSlots   = summary.subjects.reduce((a, s) => a + s.total_sessions, 0);
  const totalPresent = summary.subjects.reduce((a, s) => a + s.present,        0);
  const overallPct   = totalSlots
    ? Math.round((totalPresent / totalSlots) * 1000) / 10
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <HeaderCard profile={profile} overallPct={overallPct} />

      {/* Warning banner */}
      <WarningBanner subjects={summary.subjects} />

      {/* Today's Timetable */}
      {todayTT.length > 0 && (() => {
        const nowStr = new Date().toTimeString().slice(0, 5);
        return (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b font-semibold text-slate-700">📅 Today's Classes</div>
            <div className="divide-y">
              {todayTT.map((slot, i) => {
                const isCurrent = slot.start_time <= nowStr && nowStr <= slot.end_time;
                return (
                  <div key={i} className={`px-4 py-3 flex items-center justify-between ${isCurrent ? 'bg-blue-50 border-l-4 border-[#1a237e]' : ''}`}>
                    <div className="flex items-center gap-3">
                      {slot.color_tag && <div className="w-2 h-8 rounded-full" style={{ backgroundColor: slot.color_tag }} />}
                      <div>
                        <p className="font-medium text-slate-700 text-sm">
                          {slot.subject_name} <span className="text-slate-400 text-xs">({slot.subject_code})</span>
                        </p>
                        <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                          <span>👨‍🏫 {slot.teacher_name}</span>
                          <span>🏫 {slot.room || '—'}</span>
                          {slot.is_lab && <span className="px-1 py-0.5 bg-purple-100 text-purple-600 rounded">LAB</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{slot.start_time} – {slot.end_time}</span>
                      {isCurrent && <span className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded-full font-semibold">NOW</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Subject cards */}
      {summary.subjects.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Subject Attendance</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {summary.subjects.map(s => <SubjectCard key={s.subject_id} subj={s} />)}
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-slate-400 text-sm">
          No subjects / sessions recorded yet.
        </div>
      )}

      {/* Calendar + Recent side by side on large screens */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <AttendanceCalendar days={calendar?.days} />
        <RecentActivity records={recent?.records} />
      </div>
    </div>
  );
}

// ── Stubs for other student routes ────────────────────────────────────
function ScanQRStub() {
  return (
    <div className="card p-10 text-center text-slate-400 space-y-3">
      <span className="text-5xl block">📱</span>
      <p className="font-semibold text-slate-600">Scan QR Code</p>
      <p className="text-sm max-w-md mx-auto">
        QR scanning is available on the mobile app. Open the AutoAttend app on your phone,
        go to "Scan QR", and scan the code displayed by your teacher.
      </p>
      <div className="bg-blue-50 rounded-xl p-4 mt-4 text-left max-w-sm mx-auto text-sm text-slate-600 space-y-1">
        <p className="font-semibold text-slate-700">How it works:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Teacher starts an attendance session</li>
          <li>A rotating QR code is displayed</li>
          <li>Scan it with the mobile app</li>
          <li>Face verification confirms your identity</li>
          <li>Attendance is marked automatically!</li>
        </ol>
      </div>
    </div>
  );
}
function AttendanceDetailPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    api.get(`/attendance/student/${user.id}/summary`)
      .then(r => setSummary(r.data))
      .catch(() => setError('Failed to load attendance details.'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading attendance…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;
  if (!summary?.subjects?.length) return <div className="card p-8 text-center text-slate-400">No attendance data yet.</div>;

  const totalSessions = summary.subjects.reduce((a, s) => a + s.total_sessions, 0);
  const totalPresent = summary.subjects.reduce((a, s) => a + s.present, 0);
  const overallPct = totalSessions > 0 ? Math.round((totalPresent / totalSessions) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{totalSessions}</p>
          <p className="text-sm text-slate-500">Total Sessions</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{totalPresent}</p>
          <p className="text-sm text-slate-500">Present</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{totalSessions - totalPresent}</p>
          <p className="text-sm text-slate-500">Absent</p>
        </div>
        <div className="card p-4 text-center">
          <p className={`text-2xl font-bold ${overallPct >= THRESHOLD ? 'text-emerald-600' : overallPct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{overallPct}%</p>
          <p className="text-sm text-slate-500">Overall</p>
        </div>
      </div>

      {/* Subject Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">📊 Subject-wise Attendance</div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b">
                <th className="px-5 py-2 text-left">Subject</th>
                <th className="px-5 py-2 text-left">Code</th>
                <th className="px-5 py-2 text-left">Sem</th>
                <th className="px-5 py-2 text-left">Present</th>
                <th className="px-5 py-2 text-left">Absent</th>
                <th className="px-5 py-2 text-left">%</th>
                <th className="px-5 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {summary.subjects.map(s => {
                const statusColors = {
                  safe: 'bg-emerald-100 text-emerald-700',
                  warning: 'bg-amber-100 text-amber-700',
                  critical: 'bg-red-100 text-red-700',
                  detained: 'bg-red-200 text-red-800',
                };
                return (
                  <tr key={s.subject_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-medium text-slate-700">{s.subject_name}</td>
                    <td className="px-5 py-3 text-sm text-slate-500">{s.subject_code}</td>
                    <td className="px-5 py-3 text-sm text-slate-500">{s.semester}</td>
                    <td className="px-5 py-3 text-sm text-emerald-600 font-semibold">{s.present}</td>
                    <td className="px-5 py-3 text-sm text-red-500 font-semibold">{s.absent}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-slate-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${s.percentage >= THRESHOLD ? 'bg-emerald-500' : s.percentage >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(s.percentage, 100)}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold ${s.percentage >= THRESHOLD ? 'text-emerald-600' : s.percentage >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                          {Math.round(s.percentage)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusColors[s.attendance_status] || 'bg-slate-100 text-slate-600'}`}>
                        {s.attendance_status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StudentTimetablePage() {
  const [timetable, setTimetable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const dayColors = {
    monday: 'border-l-blue-500', tuesday: 'border-l-emerald-500', wednesday: 'border-l-purple-500',
    thursday: 'border-l-amber-500', friday: 'border-l-red-500', saturday: 'border-l-slate-400',
  };
  const dayLabel = d => d.charAt(0).toUpperCase() + d.slice(1);

  useEffect(() => {
    api.get('/timetable/my-section-timetable')
      .then(r => setTimetable(r.data || []))
      .catch(() => setError('Failed to load timetable.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading timetable…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">📅 My Weekly Timetable</div>
        {timetable.length > 0 ? (
          <div className="divide-y">
            {timetable.map(dayGroup => (
              <div key={dayGroup.day} className={`p-4 ${dayGroup.day === todayName ? 'bg-blue-50/30' : ''}`}>
                <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  {dayLabel(dayGroup.day)}
                  {dayGroup.day === todayName && <span className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded-full">TODAY</span>}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(dayGroup.entries || []).map((slot, i) => (
                    <div key={i} className={`border-l-4 ${dayColors[dayGroup.day] || 'border-l-slate-300'} bg-slate-50 rounded-r-lg p-3`}>
                      <div className="flex items-center gap-2">
                        {slot.color_tag && <div className="w-2 h-6 rounded-full" style={{ backgroundColor: slot.color_tag }} />}
                        <div>
                          <p className="font-medium text-slate-700 text-sm">{slot.subject_name}</p>
                          <p className="text-xs text-slate-400">{slot.subject_code}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                        <span className="font-mono">{slot.start_time} – {slot.end_time}</span>
                        <span>🏫 {slot.room || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-xs text-slate-400">
                        <span>👨‍🏫 {slot.teacher_name}</span>
                        {slot.is_lab && <span className="px-1 py-0.5 bg-purple-100 text-purple-600 rounded">LAB</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400">
            <span className="text-3xl block mb-2">📭</span>
            <p>No timetable entries found for your section.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DownloadReportPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    api.get(`/attendance/student/${user.id}/summary`)
      .then(r => setSummary(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  const downloadCSV = () => {
    if (!summary?.subjects) return;
    const rows = [['Subject', 'Code', 'Semester', 'Total Sessions', 'Present', 'Absent', 'Percentage', 'Status']];
    for (const s of summary.subjects) {
      rows.push([s.subject_name, s.subject_code, s.semester, s.total_sessions, s.present, s.absent, `${Math.round(s.percentage)}%`, s.attendance_status]);
    }
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-report-${user.sub || user.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Preparing report…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-6 text-center space-y-4">
        <span className="text-5xl block">📄</span>
        <h2 className="text-lg font-bold text-slate-700">Download Attendance Report</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Export your attendance data as a CSV file. This includes all subjects, session counts,
          present/absent records, and your attendance percentage.
        </p>
        <button
          onClick={downloadCSV}
          disabled={!summary?.subjects?.length}
          className="px-6 py-3 bg-[#1a237e] text-white font-semibold rounded-xl hover:bg-[#283593] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ⬇ Download CSV Report
        </button>
        {!summary?.subjects?.length && (
          <p className="text-sm text-slate-400">No attendance data available to export.</p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Student Dashboard — Routes tree
// ═══════════════════════════════════════════════════════════════════════

export default function StudentDashboard() {
  return (
    <DashboardLayout>
      <Routes>
        <Route path="dashboard"  element={<StudentHome />} />
        <Route path="scan-qr"    element={<ScanQRStub />} />
        <Route path="attendance" element={<AttendanceDetailPage />} />
        <Route path="timetable"  element={<StudentTimetablePage />} />
        <Route path="download"   element={<DownloadReportPage />} />
        <Route path="*"          element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardLayout>
  );
}

