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
    <div className="card p-10 text-center text-slate-400 space-y-2">
      <span className="text-5xl">📷</span>
      <p className="font-medium text-slate-600">Scan QR — coming soon (mobile app)</p>
    </div>
  );
}
function AttendanceStub() {
  return <div className="card p-8 text-center text-slate-400 text-sm">My Attendance — coming soon</div>;
}
function TimetableStub() {
  return <div className="card p-8 text-center text-slate-400 text-sm">Timetable — coming soon</div>;
}
function DownloadStub() {
  return <div className="card p-8 text-center text-slate-400 text-sm">Download Report — coming soon</div>;
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
        <Route path="attendance" element={<AttendanceStub />} />
        <Route path="timetable"  element={<TimetableStub />} />
        <Route path="download"   element={<DownloadStub />} />
        <Route path="*"          element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardLayout>
  );
}

