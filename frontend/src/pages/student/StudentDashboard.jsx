/**
 * AutoAttend AI v2.0 — Student Dashboard (PROMPT 7 Rebuild)
 *
 * Routes served (within /student/*):
 *   dashboard  → StudentHome (rebuilt with activity rings, forecast, disputes)
 *   scan-qr    → stub
 *   attendance → AttendanceDetailPage
 *   timetable  → StudentTimetablePage
 *   leaves     → StudentLeavePage
 *   disputes   → DisputesPage (NEW)
 *   download   → DownloadReportPage
 */

import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import DashboardLayout from '../../components/DashboardLayout';
import FeedPage from '../shared/FeedPage';
import ArticleDetailPage from '../shared/ArticleDetailPage';
import CareerRoadmapPage from '../shared/CareerRoadmapPage';
import SuggestionBoxPage from '../shared/SuggestionBoxPage';
import ProfilePage from '../shared/ProfilePage';
import NotificationsInboxPage from '../shared/NotificationsInboxPage';
import StudentClassPulsePage from './StudentClassPulsePage';
import StudentKnowledgeGraphPage from '../live/StudentKnowledgeGraphPage';

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

function pctBarColor(pct) {
  if (pct >= THRESHOLD)    return 'bg-emerald-500';
  if (pct >= THRESHOLD - 10) return 'bg-amber-400';
  return 'bg-red-500';
}

// ── Activity Ring (SVG circular progress) ─────────────────────────────
function ActivityRing({ pct, size = 80, strokeWidth = 7, label, sublabel }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(pct, 100) / 100) * circumference;
  const ringColor = pct >= 75 ? '#22c55e' : pct >= 65 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="#e2e8f0" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={ringColor} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-sm font-black" style={{ color: ringColor }}>{pct}%</span>
      </div>
      {label && <p className="text-xs font-semibold text-slate-700 mt-1 text-center truncate max-w-[90px]">{label}</p>}
      {sublabel && <p className="text-[10px] text-slate-400 text-center">{sublabel}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ClassPulseSummary — alert chips for new capsules + pending quizzes
// ═══════════════════════════════════════════════════════════════════════
function ClassPulseSummary({ subjects, navigate }) {
  const [counts, setCounts] = useState({ newCount: 0, pendingQuiz: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ids = (subjects || []).map(s => s.subject_id).filter(Boolean);
    if (ids.length === 0) { setLoading(false); return; }
    Promise.all(
      ids.map(id =>
        api.get(`/api/classpulse/student/subject/${id}/capsules`)
          .then(r => r.data?.capsules || [])
          .catch(() => [])
      )
    ).then(lists => {
      if (cancelled) return;
      let newCount = 0, pendingQuiz = 0;
      lists.flat().forEach(c => {
        const opened = c.my_interaction?.opened;
        if (!opened) newCount += 1;
        if (opened && c.has_quiz && !c.my_interaction?.quiz_attempted) pendingQuiz += 1;
      });
      setCounts({ newCount, pendingQuiz });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [subjects]);

  if (loading || (counts.newCount === 0 && counts.pendingQuiz === 0)) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-violet-100 p-5 flex flex-wrap items-center gap-3">
      <span className="text-2xl">📚</span>
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-bold text-slate-800">ClassPulse</p>
        <div className="flex flex-wrap gap-2 mt-1">
          {counts.newCount > 0 && (
            <span className="text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2.5 py-1">
              {counts.newCount} new capsule{counts.newCount > 1 ? 's' : ''} available
            </span>
          )}
          {counts.pendingQuiz > 0 && (
            <span className="text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1">
              📝 {counts.pendingQuiz} quiz{counts.pendingQuiz > 1 ? 'zes' : ''} pending
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => navigate('/student/classpulse')}
        className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-2"
      >
        Open ClassPulse →
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// StudentHome — rebuilt dashboard (PROMPT 7)
// ═══════════════════════════════════════════════════════════════════════
function StudentHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [flash, setFlash]         = useState('');
  const [disputeModal, setDisputeModal] = useState(null); // session_id to dispute
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeNote, setDisputeNote]     = useState('');
  const [submitting, setSubmitting]       = useState(false);

  const loadDashboard = () => {
    setLoading(true);
    api.get('/student/portal/dashboard')
      .then(r => setDashboard(r.data))
      .catch(() => setError('Failed to load dashboard.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDashboard(); }, []);

  const handleDispute = async () => {
    if (!disputeReason.trim() || disputeReason.length < 5) {
      setFlash('Reason must be at least 5 characters.'); return;
    }
    setSubmitting(true);
    try {
      await api.post('/student/portal/dispute-attendance', {
        session_id: disputeModal,
        reason: disputeReason,
        proof_note: disputeNote || null,
      });
      setFlash('Dispute submitted! Your teacher will be notified.');
      setDisputeModal(null);
      setDisputeReason('');
      setDisputeNote('');
      loadDashboard();
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to submit dispute.');
    } finally { setSubmitting(false); }
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
  if (!dashboard) return null;

  const d = dashboard;
  const subjects = d.attendance_summary || [];
  const lowSubjects = d.low_attendance_subjects || [];
  const todayTT = d.today_timetable || [];
  const recentRecords = d.recent_records || [];
  const upcoming = d.upcoming_sessions || [];

  // Overall %
  const totalSlots = subjects.reduce((a, s) => a + s.total_sessions, 0);
  const totalPresent = subjects.reduce((a, s) => a + s.present, 0);
  const overallPct = totalSlots ? Math.round((totalPresent / totalSlots) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Welcome Header ── */}
      <div className="card bg-gradient-to-r from-[#1a237e] to-[#283593] p-6 text-white flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold">Hello, {d.student_name}!</h1>
          <p className="text-blue-200 text-sm mt-1">
            {d.roll_number} · Semester {d.semester}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-3xl font-extrabold">{overallPct}%</p>
            <p className="text-xs text-blue-200">Overall</p>
          </div>
          <button onClick={() => navigate('/student/scan-qr')}
            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-semibold transition">
            📷 Scan QR
          </button>
        </div>
      </div>

      {/* ── Low Attendance Warning ── */}
      {lowSubjects.length > 0 && (
        <div className="card p-4 border-red-200 bg-red-50 space-y-1">
          {lowSubjects.map(s => (
            <p key={s.subject_id} className="text-sm text-red-700 font-medium">
              ⚠️ <span className="font-bold">{s.subject_name}</span> — {s.percentage}%.
              {s.sessions_needed > 0
                ? ` Attend ${s.sessions_needed} more class${s.sessions_needed > 1 ? 'es' : ''} to be safe.`
                : ' Critically low — contact your HOD.'}
            </p>
          ))}
        </div>
      )}

      {/* ── ClassPulse quick alerts (PROMPT 2) ── */}
      <ClassPulseSummary subjects={subjects} navigate={navigate} />

      {/* ── Activity Rings — Subject Attendance ── */}
      {subjects.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">📊 Subject Attendance</h3>
          <div className="flex flex-wrap gap-6 justify-center">
            {subjects.map(s => (
              <div key={s.subject_id} className="relative">
                <ActivityRing
                  pct={s.percentage}
                  label={s.subject_name}
                  sublabel={`${s.present}/${s.total_sessions}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 2-COLUMN GRID ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── COL 1: Forecast + Timetable ── */}
        <div className="space-y-4">
          {/* Attendance Forecast */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-slate-700 text-sm">
              🔮 Attendance Forecast
            </div>
            <div className="divide-y">
              {subjects.map(s => {
                const atRisk = s.sessions_needed > 0 && s.percentage < THRESHOLD;
                return (
                  <div key={s.subject_id} className={`px-4 py-3 ${atRisk ? 'bg-red-50/50' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{s.subject_name}</p>
                        <p className="text-xs text-slate-400 font-mono">{s.subject_code}</p>
                      </div>
                      <span className={`text-sm font-bold ${s.percentage >= THRESHOLD ? 'text-green-600' : 'text-red-600'}`}>
                        {s.percentage}%
                      </span>
                    </div>
                    <div className="mt-1.5">
                      {s.percentage >= THRESHOLD ? (
                        <p className="text-xs text-green-600">
                          ✅ You can miss {s.can_afford_to_miss} more class{s.can_afford_to_miss !== 1 ? 'es' : ''}
                        </p>
                      ) : (
                        <p className="text-xs text-red-600 font-medium">
                          ⚠️ Need to attend {s.sessions_needed} more class{s.sessions_needed !== 1 ? 'es' : ''} to reach {THRESHOLD}%
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {subjects.length === 0 && (
                <div className="p-6 text-center text-slate-400 text-sm">No data yet.</div>
              )}
            </div>
          </div>

          {/* Today's Timetable */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-slate-700 text-sm">
              📅 Today's Schedule
            </div>
            {todayTT.length > 0 ? (
              <div className="divide-y">
                {todayTT.map((slot, i) => {
                  const nowStr = new Date().toTimeString().slice(0, 5);
                  const isCurrent = slot.start_time <= nowStr && nowStr <= slot.end_time;
                  return (
                    <div key={i} className={`px-4 py-2.5 flex items-center justify-between ${isCurrent ? 'bg-blue-50 border-l-4 border-[#1a237e]' : ''}`}>
                      <div className="flex items-center gap-2">
                        {slot.color_tag && <div className="w-1.5 h-8 rounded-full" style={{ backgroundColor: slot.color_tag }} />}
                        <div>
                          <p className="font-medium text-slate-700 text-sm">
                            {slot.subject_name}
                            {slot.is_twm && <span className="ml-1 text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded">TWM</span>}
                          </p>
                          <p className="text-xs text-slate-400 font-mono">{slot.start_time} – {slot.end_time} · {slot.room || '—'}</p>
                        </div>
                      </div>
                      {isCurrent && <span className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded-full font-semibold">NOW</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">No classes today.</div>
            )}
          </div>
        </div>

        {/* ── COL 2: Recent + Tutor + Quick Actions ── */}
        <div className="space-y-4">
          {/* Recent Records with Dispute buttons */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-slate-700 text-sm">
              🕑 Recent Records
            </div>
            {recentRecords.length > 0 ? (
              <div className="divide-y">
                {recentRecords.map(r => {
                  const statusColors = {
                    present: 'bg-emerald-100 text-emerald-700',
                    absent: 'bg-red-100 text-red-700',
                    late: 'bg-amber-100 text-amber-700',
                    medical_leave: 'bg-blue-100 text-blue-700',
                    duty_leave: 'bg-purple-100 text-purple-700',
                  };
                  return (
                    <div key={r.record_id} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{r.subject_name}</p>
                        <p className="text-xs text-slate-400">{r.date}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${statusColors[r.status] || 'bg-slate-100 text-slate-500'}`}>
                          {r.status.replace('_', ' ')}
                        </span>
                        {r.can_dispute && (
                          <button
                            onClick={() => setDisputeModal(r.session_id)}
                            className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 font-medium"
                          >
                            Dispute
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">No records yet.</div>
            )}
          </div>

          {/* My Tutor */}
          {d.tutor_info && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">👨‍🏫 My Tutor</h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                  {(d.tutor_info.name || 'T').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-slate-700">{d.tutor_info.name}</p>
                  {d.tutor_info.email && <p className="text-xs text-slate-400">{d.tutor_info.email}</p>}
                  {d.tutor_info.phone && <p className="text-xs text-slate-400">{d.tutor_info.phone}</p>}
                </div>
              </div>
            </div>
          )}

          {/* Leave & Dispute Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4 text-center cursor-pointer hover:shadow-md transition" onClick={() => navigate('/student/leaves')}>
              <p className="text-2xl font-bold text-amber-600">{d.pending_leave_requests}</p>
              <p className="text-xs text-slate-400">Pending Leaves</p>
            </div>
            <div className="card p-4 text-center cursor-pointer hover:shadow-md transition" onClick={() => navigate('/student/disputes')}>
              <span className="text-2xl">⚖️</span>
              <p className="text-xs text-slate-400 mt-1">My Disputes</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b font-semibold text-slate-700 text-sm">
              ⚡ Quick Actions
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              <button onClick={() => navigate('/student/attendance')}
                className="p-3 bg-blue-50 rounded-lg text-center hover:bg-blue-100 transition">
                <span className="text-xl block">✅</span>
                <p className="text-xs font-medium text-blue-700 mt-1">Attendance</p>
              </button>
              <button onClick={() => navigate('/student/timetable')}
                className="p-3 bg-green-50 rounded-lg text-center hover:bg-green-100 transition">
                <span className="text-xl block">🗓️</span>
                <p className="text-xs font-medium text-green-700 mt-1">Timetable</p>
              </button>
              <button onClick={() => navigate('/student/leaves')}
                className="p-3 bg-amber-50 rounded-lg text-center hover:bg-amber-100 transition">
                <span className="text-xl block">📋</span>
                <p className="text-xs font-medium text-amber-700 mt-1">Leaves</p>
              </button>
              <button onClick={() => navigate('/student/download')}
                className="p-3 bg-purple-50 rounded-lg text-center hover:bg-purple-100 transition">
                <span className="text-xl block">⬇️</span>
                <p className="text-xs font-medium text-purple-700 mt-1">Report</p>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Dispute Modal ── */}
      {disputeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card w-full max-w-md p-6 space-y-4 m-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">⚖️ Dispute Attendance</h3>
              <button onClick={() => setDisputeModal(null)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <p className="text-sm text-slate-500">Explain why you believe you were wrongly marked absent.</p>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Reason *</label>
              <textarea value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                placeholder="I was present in class but my QR scan failed because…"
                rows={3} maxLength={1000}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e] resize-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">
                Proof/Note <span className="text-slate-400 normal-case">(optional)</span>
              </label>
              <input value={disputeNote}
                onChange={e => setDisputeNote(e.target.value)}
                placeholder="Link to photo, classmate witness, etc."
                maxLength={500}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e]" />
            </div>
            <button onClick={handleDispute} disabled={submitting}
              className="w-full py-3 bg-[#1a237e] text-white font-bold rounded-xl hover:bg-[#283593] disabled:opacity-50">
              {submitting ? '⏳ Submitting…' : '📨 Submit Dispute'}
            </button>
          </div>
        </div>
      )}
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
      .then(r => setTimetable(r.data?.timetable || []))
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

// ── Leave Requests Page ───────────────────────────────────────────────
const LEAVE_TYPES = [
  { value: 'medical',   label: 'Medical',   icon: '🏥' },
  { value: 'duty',      label: 'Duty',      icon: '📋' },
  { value: 'personal',  label: 'Personal',  icon: '👤' },
  { value: 'emergency', label: 'Emergency', icon: '🚨' },
  { value: 'sports',    label: 'Sports',    icon: '🏅' },
  { value: 'other',     label: 'Other',     icon: '📝' },
];

const LEAVE_STATUS_STYLE = {
  pending:   'bg-amber-100 text-amber-700',
  approved:  'bg-emerald-100 text-emerald-700',
  rejected:  'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

function StudentLeavePage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState('');
  const [form, setForm] = useState({
    leave_type: 'medical', from_date: '', to_date: '', reason: '', document_url: '',
  });
  // S3 upload state for supporting document (issues #45 / #116)
  const [docFile, setDocFile] = useState(null);
  const [docError, setDocError] = useState('');
  const MAX_DOC_SIZE_BYTES = 5 * 1024 * 1024;

  const loadRequests = () => {
    setLoading(true);
    api.get('/leave/my-requests')
      .then(r => setRequests(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadRequests(); }, []);

  const handleDocPick = (e) => {
    setDocError('');
    const file = e.target.files?.[0] || null;
    if (!file) { setDocFile(null); return; }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
      setDocError('Only PDF, JPG, JPEG, PNG are allowed.');
      setDocFile(null);
      return;
    }
    if (file.size > MAX_DOC_SIZE_BYTES) {
      setDocError('File too large — max 5 MB.');
      setDocFile(null);
      return;
    }
    setDocFile(file);
  };

  const handleApply = async () => {
    if (!form.from_date || !form.to_date || !form.reason.trim()) {
      setFlash('Please fill in all required fields.'); return;
    }
    setSubmitting(true);
    try {
      // 1. Upload supporting document to S3 first (if picked).
      let s3Key = null;
      if (docFile) {
        const fd = new FormData();
        fd.append('file', docFile);
        try {
          const up = await api.post('/uploads/leave-document', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          s3Key = up.data?.s3_key || null;
        } catch (upErr) {
          // 503 → storage not configured; let leave still submit without file.
          if (upErr?.response?.status === 503) {
            setFlash('File storage is not configured — submitting without document.');
          } else {
            setFlash(upErr?.response?.data?.detail || 'Failed to upload document.');
            setSubmitting(false);
            return;
          }
        }
      }
      // 2. Submit the leave request.
      await api.post('/leave/apply', {
        leave_type: form.leave_type,
        from_date: form.from_date,
        to_date: form.to_date,
        reason: form.reason,
        document_url: form.document_url || null,
        document_s3_key: s3Key,
      });
      setFlash('Leave request submitted successfully!');
      setShowModal(false);
      setForm({ leave_type: 'medical', from_date: '', to_date: '', reason: '', document_url: '' });
      setDocFile(null);
      setDocError('');
      loadRequests();
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to submit leave request.');
    } finally { setSubmitting(false); }
  };

  const handleViewDoc = async (s3Key) => {
    if (!s3Key) return;
    try {
      const { data } = await api.get(`/uploads/signed-url/${encodeURIComponent(s3Key)}`);
      if (data?.url) window.open(data.url, '_blank', 'noopener');
    } catch (err) {
      setFlash(err?.response?.data?.detail || 'Failed to open document.');
    }
  };

  const handleCancel = async (id) => {
    try {
      await api.delete(`/leave/${id}/cancel`);
      setFlash('Leave request cancelled.');
      loadRequests();
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to cancel.');
    }
  };

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading leave requests…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="card p-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">My Leave Requests</h2>
          <p className="text-sm text-slate-400 mt-0.5">{requests.length} request(s)</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-5 py-2.5 bg-[#1a237e] text-white font-semibold rounded-xl hover:bg-[#283593] text-sm"
        >
          + Apply for Leave
        </button>
      </div>

      {/* Requests table */}
      {requests.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  {['Type', 'Dates', 'Days', 'Reason', 'Status', 'Reviewer Note', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {requests.map(lr => (
                  <tr key={lr.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="capitalize font-medium text-slate-700">{lr.leave_type}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{lr.from_date} → {lr.to_date}</td>
                    <td className="px-4 py-3 text-center font-semibold">{lr.days}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{lr.reason}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${LEAVE_STATUS_STYLE[lr.status] || ''}`}>
                        {lr.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 italic max-w-[200px] truncate">
                      {lr.tutor_note || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {lr.status === 'pending' && (
                        <button
                          onClick={() => handleCancel(lr.id)}
                          className="text-xs px-3 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium"
                        >
                          Cancel
                        </button>
                      )}
                      {lr.document_s3_key && (
                        <button
                          onClick={() => handleViewDoc(lr.document_s3_key)}
                          className="text-xs px-3 py-1 ml-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium"
                        >
                          📎 View Document
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-slate-400">
          <span className="text-3xl block mb-2">📭</span>
          <p>No leave requests yet.</p>
        </div>
      )}

      {/* Apply Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card w-full max-w-lg p-6 space-y-4 m-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">Apply for Leave</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>

            {/* Leave Type */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Leave Type</label>
              <div className="grid grid-cols-3 gap-2">
                {LEAVE_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setForm(prev => ({ ...prev, leave_type: t.value }))}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                      form.leave_type === t.value
                        ? 'border-[#1a237e] bg-blue-50 text-[#1a237e]'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">From Date</label>
                <input type="date" value={form.from_date}
                  onChange={e => setForm(prev => ({ ...prev, from_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">To Date</label>
                <input type="date" value={form.to_date}
                  onChange={e => setForm(prev => ({ ...prev, to_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e]" />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Reason</label>
              <textarea value={form.reason}
                onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))}
                placeholder="Describe your reason for leave…"
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e] resize-none"
                maxLength={2000} />
            </div>

            {/* Document URL */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">
                Document URL <span className="text-slate-400 normal-case">(optional — required for medical/sports)</span>
              </label>
              <input type="url" value={form.document_url}
                onChange={e => setForm(prev => ({ ...prev, document_url: e.target.value }))}
                placeholder="https://drive.google.com/..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e]" />
            </div>

            {/* Supporting document upload (S3) — issues #45 / #116 */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">
                Supporting document <span className="text-slate-400 normal-case">(optional — PDF/JPG/PNG, max 5 MB)</span>
              </label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleDocPick}
                className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
              />
              {docFile && !docError && (
                <p className="text-xs text-emerald-600 mt-1">
                  Selected: {docFile.name} ({(docFile.size / 1024).toFixed(0)} KB)
                </p>
              )}
              {docError && (
                <p className="text-xs text-red-600 mt-1">{docError}</p>
              )}
            </div>

            <button
              onClick={handleApply}
              disabled={submitting}
              className="w-full py-3 bg-[#1a237e] text-white font-bold rounded-xl hover:bg-[#283593] disabled:opacity-50"
            >
              {submitting ? '⏳ Submitting…' : '📋 Submit Leave Request'}
            </button>
          </div>
        </div>
      )}
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

// ── Disputes Page (NEW — PROMPT 7) ────────────────────────────────────
const DISPUTE_STATUS_STYLE = {
  pending:  'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

function DisputesPage() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    api.get('/student/portal/my-disputes')
      .then(r => setDisputes(r.data || []))
      .catch(() => setError('Failed to load disputes.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading disputes…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="text-lg font-bold text-slate-800">⚖️ My Attendance Disputes</h2>
        <p className="text-sm text-slate-400 mt-1">
          Disputes you've filed for attendance records you believe are incorrect.
        </p>
      </div>

      {disputes.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  {['Subject', 'Date', 'Reason', 'Status', 'Resolution'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {disputes.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-700">{d.subject_name}</p>
                      <p className="text-xs text-slate-400">{d.session_date}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{d.created_at?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-[250px] truncate">{d.reason}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${DISPUTE_STATUS_STYLE[d.status] || 'bg-slate-100 text-slate-500'}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 italic max-w-[200px] truncate">
                      {d.resolution_note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-slate-400">
          <span className="text-3xl block mb-2">✅</span>
          <p>No disputes filed yet.</p>
        </div>
      )}
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
        <Route path="leaves"     element={<StudentLeavePage />} />
        <Route path="disputes"   element={<DisputesPage />} />
        <Route path="download"   element={<DownloadReportPage />} />
        <Route path="feed"       element={<FeedPage />} />
        <Route path="feed/:articleId" element={<ArticleDetailPage />} />
        <Route path="career"           element={<CareerRoadmapPage />} />
        <Route path="suggestions"      element={<SuggestionBoxPage />} />
        <Route path="profile"          element={<ProfilePage />} />
        <Route path="inbox"            element={<NotificationsInboxPage />} />
        <Route path="classpulse"       element={<StudentClassPulsePage />} />
        <Route path="knowledge-graph"  element={<StudentKnowledgeGraphPage />} />
        <Route path="*"          element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardLayout>
  );
}

