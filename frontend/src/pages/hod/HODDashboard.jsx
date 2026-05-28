/**
 * AutoAttend AI v2.0 — HOD Dashboard
 *
 * Routes served (within /hod/*):
 *   dashboard     → HODOverview   (this file)
 *   students      → StudentsPage  (stub)
 *   teachers      → TeachersPage  (stub)
 *   reports       → DeptReportsPage (stub)
 *   face-reenroll → FaceReenrollPage (inline stub below)
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import api from '../../api/axios';
import DashboardLayout from '../../components/DashboardLayout';

// #97 — lazy-load every sub-route page so the HOD bundle only fetches
// chunks the user actually visits. The inline HODOverview + FaceReenrollPage
// defined in this file stay eager because they reference local helpers.
const AlertsPage              = lazy(() => import('./AlertsPage'));
const DeptReportsPage         = lazy(() => import('./DeptReportsPage'));
const SectionsPage            = lazy(() => import('./SectionsPage'));
const StudentsPage            = lazy(() => import('./StudentsPage'));
const SubjectsPage            = lazy(() => import('./SubjectsPage'));
const TeachersPage            = lazy(() => import('./TeachersPage'));
const TimetablePage           = lazy(() => import('./TimetablePage'));
const TutorManagementPage     = lazy(() => import('./TutorManagementPage'));
const LeaveRequestsPage       = lazy(() => import('../teacher/LeaveRequestsPage'));
const SectionAnalyticsPage    = lazy(() => import('./SectionAnalyticsPage'));
const TeacherPerformancePage  = lazy(() => import('./TeacherPerformancePage'));
const TutorOverviewPage       = lazy(() => import('./TutorOverviewPage'));
const HODDisputesPage         = lazy(() => import('./HODDisputesPage'));
const SemesterProgressPage    = lazy(() => import('./SemesterProgressPage'));
const FeedPage                = lazy(() => import('../shared/FeedPage'));
const ArticleDetailPage       = lazy(() => import('../shared/ArticleDetailPage'));
const CareerRoadmapPage       = lazy(() => import('../shared/CareerRoadmapPage'));
const SuggestionBoxPage       = lazy(() => import('../shared/SuggestionBoxPage'));
const HODClassPulsePage       = lazy(() => import('./HODClassPulsePage'));
const LiveSessionAnalyticsPage = lazy(() => import('./LiveSessionAnalyticsPage'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div style={{ borderColor: '#e2e8f0', borderTopColor: '#3b82f6',
                    width: 32, height: 32, borderWidth: 4,
                    borderRadius: '9999px', borderStyle: 'solid' }}
           className="animate-spin" />
    </div>
  );
}

// ── colour helpers ────────────────────────────────────────────────────
const PCT_COLOR = (pct) => {
  if (pct >= 75) return 'text-emerald-600';
  if (pct >= 60) return 'text-amber-500';
  return 'text-red-500';
};

const PCT_BG_CLASS = (pct) => {
  if (pct >= 75) return 'bg-emerald-500';
  if (pct >= 60) return 'bg-amber-400';
  return 'bg-red-500';
};

// ── Small components ──────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, danger }) {
  return (
    <div className={`card p-4 flex items-start gap-3 ${danger ? 'border-red-200 bg-red-50' : ''}`}>
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
        <p className={`text-xl font-bold mt-0.5 ${danger ? 'text-red-600' : 'text-slate-800'}`}>
          {value ?? '—'}
        </p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Face Re-enroll page ───────────────────────────────────────────────
//   Lists students in the HOD's college and lets the HOD reset a student's
//   face enrollment (clears azure_person_id, face_enrolled=False).  The
//   student is prompted to re-enroll on next login.
function FaceReenrollPage() {
  const [students,  setStudents]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [filter,    setFilter]    = useState('');
  const [onlyEnrolled, setOnlyEnrolled] = useState(true);
  const [target,    setTarget]    = useState(null);   // {id, name, roll_number}
  const [reason,    setReason]    = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [flash,     setFlash]     = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/api/face/admin/students', { params: { only_enrolled: onlyEnrolled } })
      .then(r => setStudents(r.data?.students || []))
      .catch(err => setError(err.response?.data?.detail || 'Failed to load students.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [onlyEnrolled]);   // reload when toggle flips

  const filtered = students.filter(s => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return (
      (s.name || '').toLowerCase().includes(q) ||
      (s.roll_number || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    );
  });

  async function confirmReset() {
    if (!target) return;
    if (reason.trim().length < 5) {
      setFlash('Reason must be at least 5 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/face/admin/reset/${target.id}`, { reason: reason.trim() });
      setFlash(`Face enrollment cleared for ${target.name}. They will re-enroll on next login.`);
      setTarget(null);
      setReason('');
      load();
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Reset failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {flash && (
        <div className="card px-4 py-2.5 bg-amber-50 text-amber-800 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="text-3xl">🤳</span>
        <div className="flex-1 min-w-[200px]">
          <p className="font-semibold text-slate-800">Face Re-enrollment</p>
          <p className="text-xs text-slate-500">
            Clear a student's face data so they can re-enroll. All resets are
            audited (FaceChangeLog).
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={onlyEnrolled}
                 onChange={e => setOnlyEnrolled(e.target.checked)} />
          Only enrolled
        </label>
        <input
          type="search"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search name / roll / email…"
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm w-60"
        />
      </div>

      {loading ? (
        <div className="card p-10 text-center text-slate-400">Loading…</div>
      ) : error ? (
        <div className="card p-10 text-center text-red-500">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">No students match.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Roll</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Enrolled</th>
                <th className="text-right px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-700">{s.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{s.roll_number}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{s.email}</td>
                  <td className="px-4 py-2 text-xs">
                    {s.face_enrolled
                      ? <span className="text-emerald-600 font-semibold">✓ Yes</span>
                      : <span className="text-slate-400">— No</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      disabled={!s.face_enrolled}
                      onClick={() => { setTarget(s); setReason(''); }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600
                                 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed">
                      Reset face
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm modal */}
      {target && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-800">
              Reset face for {target.name}?
            </h3>
            <p className="text-xs text-slate-500">
              This clears the Azure face record. {target.name} will be prompted to
              enroll their face again on next login. The action is irreversible
              and is logged.
            </p>
            <textarea
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Reason (visible in audit log) — min 5 chars"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => { setTarget(null); setReason(''); }}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                Cancel
              </button>
              <button
                onClick={confirmReset}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
                {submitting ? 'Resetting…' : 'Confirm reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ClassPulseOverviewCard — small summary on HOD dashboard
// ═══════════════════════════════════════════════════════════════════════
function ClassPulseOverviewCard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/api/classpulse/hod/department-analytics')
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return null;
  if (!data)   return null;
  const stats = data.department_stats || {};
  const gapCount = (data.subjects_overview || []).filter(s => s.content_gap_alert).length;
  return (
    <div className="card p-4 border-violet-100">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📚</span>
          <div>
            <p className="text-sm font-bold text-slate-800">ClassPulse Overview</p>
            <p className="text-xs text-slate-500">{stats.total_capsules || 0} capsules across department</p>
          </div>
        </div>
        <a href="/hod/classpulse" className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-2">
          View Details →
        </a>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <Metric label="Avg Engagement"    value={`${stats.avg_engagement_pct ?? 0}%`}    tone={(stats.avg_engagement_pct ?? 0) >= 70 ? 'text-emerald-600' : (stats.avg_engagement_pct ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600'} />
        <Metric label="Avg Comprehension" value={`${stats.avg_comprehension_pct ?? 0}%`} tone={(stats.avg_comprehension_pct ?? 0) >= 70 ? 'text-emerald-600' : (stats.avg_comprehension_pct ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600'} />
        <Metric label="Content Gaps"      value={gapCount}                               tone={gapCount > 0 ? 'text-red-600' : 'text-slate-700'} />
        <Metric label="Students at Risk"  value={stats.students_at_risk_count ?? 0}      tone={(stats.students_at_risk_count ?? 0) > 0 ? 'text-red-600' : 'text-slate-700'} />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2 text-center">
      <p className={`text-lg font-bold ${tone || 'text-slate-800'}`}>{value}</p>
      <p className="text-[10px] uppercase text-slate-500 tracking-wide">{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HODOverview — main dashboard content
// ═══════════════════════════════════════════════════════════════════════
function HODOverview() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Pending approval actions
  const [actionLoading, setActionLoading] = useState(null); // registry_id
  const [actionMsg,     setActionMsg]     = useState('');

  const load = () => {
    setLoading(true);
    api.get('/hod/dashboard')
      .then((r) => setData(r.data))
      .catch(() => setError('Failed to load HOD dashboard.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleApproval = async (registryId, action) => {
    setActionLoading(registryId);
    setActionMsg('');
    try {
      await api.post(`/hod/${action}-request/${registryId}`);
      setActionMsg(`${action === 'approve' ? 'Approved' : 'Rejected'} successfully.`);
      // Reload data
      load();
    } catch {
      setActionMsg('Action failed. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div className="p-8 text-slate-400 text-sm animate-pulse">Loading…</div>;
  if (error)   return <div className="p-8 text-red-500 text-sm">{error}</div>;

  const teachers = data?.teachers  || [];
  const subjects = data?.subjects  || [];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{data.department_name} Department</h2>
          <p className="text-sm text-slate-500">HOD: {data.hod_name}</p>
        </div>
        {data.pending_approvals > 0 && (
          <span className="badge badge-danger text-sm px-3 py-1">
            {data.pending_approvals} pending approval{data.pending_approvals !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon="👩‍🏫" label="Teachers"          value={data.teacher_count} />
        <StatCard icon="🎓" label="Students"            value={data.student_count} />
        <StatCard icon="✅" label="Avg Attendance"       value={`${data.avg_attendance_pct}%`} />
        <StatCard icon="⏳" label="Pending Approvals"   value={data.pending_approvals}
                  danger={data.pending_approvals > 0} />
      </div>

      {/* ── P8 Summary Row — Sections / Tutors / Disputes / Progress ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Section Overview */}
        <a href="/hod/section-analytics" className="card p-4 hover:shadow-md transition cursor-pointer">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📊</span>
            <p className="text-xs font-semibold text-slate-500 uppercase">Sections</p>
          </div>
          {data.section_overview?.length > 0 ? (
            <div className="space-y-1">
              {data.section_overview.slice(0, 3).map(s => (
                <div key={s.section_id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">Sec {s.section_name}</span>
                  <span className={`font-bold ${s.avg_pct >= 75 ? 'text-emerald-600' : s.avg_pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{s.avg_pct}%</span>
                </div>
              ))}
              {data.section_overview.length > 3 && <p className="text-[10px] text-slate-400">+{data.section_overview.length - 3} more…</p>}
            </div>
          ) : <p className="text-xs text-slate-400">No sections</p>}
        </a>

        {/* Tutor Stats */}
        <a href="/hod/tutor-overview" className="card p-4 hover:shadow-md transition cursor-pointer">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📝</span>
            <p className="text-xs font-semibold text-slate-500 uppercase">Tutors</p>
          </div>
          <p className="text-xl font-bold text-slate-800">{data.tutor_stats?.tutor_count ?? 0}</p>
          <p className="text-xs text-slate-400">Active tutors</p>
          {data.tutor_stats?.unassigned_students > 0 && (
            <p className="text-xs text-amber-600 mt-1 font-medium">⚠️ {data.tutor_stats.unassigned_students} unassigned</p>
          )}
        </a>

        {/* Disputes */}
        <a href="/hod/disputes" className={`card p-4 hover:shadow-md transition cursor-pointer ${data.pending_disputes_count > 0 ? 'border-amber-200 bg-amber-50/30' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">⚖️</span>
            <p className="text-xs font-semibold text-slate-500 uppercase">Disputes</p>
          </div>
          <p className={`text-xl font-bold ${data.pending_disputes_count > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{data.pending_disputes_count}</p>
          <p className="text-xs text-slate-400">Pending disputes</p>
        </a>

        {/* Semester Progress */}
        <a href="/hod/semester-progress" className="card p-4 hover:shadow-md transition cursor-pointer">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📈</span>
            <p className="text-xs font-semibold text-slate-500 uppercase">Progress</p>
          </div>
          <p className="text-sm font-semibold text-slate-700">Semester Tracker</p>
          <p className="text-xs text-slate-400">Planned vs conducted</p>
        </a>
      </div>

      {/* ── ClassPulse Overview ── */}
      <ClassPulseOverviewCard />

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Add Teacher',         icon: '➕', href: '/hod/teachers'          },
          { label: 'Teacher Performance', icon: '👩‍🏫', href: '/hod/teacher-perf'     },
          { label: 'View Defaulters',     icon: '⚠️', href: '/hod/reports'           },
          { label: 'Download Report',     icon: '⬇️', href: '/hod/reports'           },
          { label: 'Approve Requests',    icon: '✅', href: '#pending-approvals'     },
          { label: 'Face Re-enroll',      icon: '🤳', href: '/hod/face-reenroll'     },
        ].map((action) => (
          <a
            key={action.label}
            href={action.href}
            className="card p-3 text-center hover:bg-slate-50 transition-colors group cursor-pointer"
          >
            <span className="text-2xl">{action.icon}</span>
            <p className="text-xs text-slate-600 font-medium mt-1.5 group-hover:text-blue-600">
              {action.label}
            </p>
          </a>
        ))}
      </div>

      {/* ── Teachers table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">My Teachers</h3>
        </div>
        {teachers.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No teachers in department.</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Name', 'Email', 'Subjects', "Today's Session", 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {teachers.map((t) => {
                const sess = t.today_session;
                return (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{t.email}</td>
                    <td className="px-4 py-3">
                      {t.subject_names.length ? (
                        <div className="flex flex-wrap gap-1">
                          {t.subject_names.map((n, i) => (
                            <span key={i} className="badge badge-secondary text-xs">{n}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">No subjects</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {sess ? (
                        <div className="text-xs">
                          <p className="font-medium text-slate-700">{sess.present_count} / {sess.total_students}</p>
                          <p className="text-slate-400 capitalize">{sess.status}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">No class today</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {sess ? (
                        <span className={`badge ${sess.status === 'active' ? 'badge-success' : 'badge-secondary'}`}>
                          {sess.status}
                        </span>
                      ) : (
                        <span className="badge badge-secondary">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Subjects table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Subject Attendance</h3>
        </div>
        {subjects.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No subjects / no sessions yet.</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Subject', 'Code', 'Sem', 'Teacher', 'Sessions', 'Avg %'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {subjects.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.code}</td>
                  <td className="px-4 py-3 text-slate-500">{s.semester ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.teacher_name || <span className="text-slate-300">Unassigned</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{s.sessions_done}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${PCT_BG_CLASS(s.avg_pct)}`}
                          style={{ width: `${Math.min(s.avg_pct, 100)}%` }}
                        />
                      </div>
                      <span className={`font-semibold text-xs ${PCT_COLOR(s.avg_pct)}`}>
                        {s.avg_pct}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pending Device Approvals ── */}
      <PendingApprovals onAction={handleApproval} actionLoading={actionLoading} actionMsg={actionMsg} />
    </div>
  );
}

// ── Pending approvals widget ──────────────────────────────────────────
function PendingApprovals({ onAction, actionLoading, actionMsg }) {
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/hod/pending-approvals')
      .then((r) => setPending(r.data.pending || []))
      .catch(() => setPending([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Reload when action completes
  useEffect(() => {
    if (actionMsg) load();
  }, [actionMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div id="pending-approvals" className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Pending Device Approvals
          {pending && pending.length > 0 && (
            <span className="ml-2 badge badge-danger">{pending.length}</span>
          )}
        </h3>
        {actionMsg && (
          <span className="text-xs text-emerald-600 font-medium">{actionMsg}</span>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-slate-400 text-sm text-center animate-pulse">Loading…</div>
      ) : !pending || pending.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">No pending device approvals.</div>
      ) : (
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              {['Student', 'Roll No.', 'Device', 'OS', 'Registered', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {pending.map((p) => (
              <tr key={p.registry_id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{p.student_name}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.roll_number || '—'}</td>
                <td className="px-4 py-3 text-slate-600 text-xs">{p.device_name || '—'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{p.device_os || '—'}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {new Date(p.bound_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      className="btn-primary text-xs py-1 px-2 disabled:opacity-50"
                      disabled={actionLoading === p.registry_id}
                      onClick={() => onAction(p.registry_id, 'approve')}
                    >
                      {actionLoading === p.registry_id ? '…' : '✓ Approve'}
                    </button>
                    <button
                      className="btn-danger text-xs py-1 px-2 disabled:opacity-50"
                      disabled={actionLoading === p.registry_id}
                      onClick={() => onAction(p.registry_id, 'reject')}
                    >
                      {actionLoading === p.registry_id ? '…' : '✗ Reject'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HOD Dashboard — Routes tree
// ═══════════════════════════════════════════════════════════════════════

export default function HODDashboard() {
  return (
    <DashboardLayout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="dashboard"     element={<HODOverview />} />
          <Route path="students"      element={<StudentsPage />} />
          <Route path="sections"      element={<SectionsPage />} />
          <Route path="teachers"      element={<TeachersPage />} />
          <Route path="subjects"      element={<SubjectsPage />} />
          <Route path="timetable"     element={<TimetablePage />} />
          <Route path="reports"       element={<DeptReportsPage />} />
          <Route path="alerts"        element={<AlertsPage />} />
          <Route path="face-reenroll" element={<FaceReenrollPage />} />
          <Route path="tutors"            element={<TutorManagementPage />} />
          <Route path="leave-requests"    element={<LeaveRequestsPage />} />
          <Route path="section-analytics" element={<SectionAnalyticsPage />} />
          <Route path="teacher-perf"      element={<TeacherPerformancePage />} />
          <Route path="tutor-overview"    element={<TutorOverviewPage />} />
          <Route path="disputes"          element={<HODDisputesPage />} />
          <Route path="semester-progress" element={<SemesterProgressPage />} />
          <Route path="feed"              element={<FeedPage />} />
          <Route path="feed/:articleId"   element={<ArticleDetailPage />} />
          <Route path="career"              element={<CareerRoadmapPage />} />
          <Route path="suggestions"         element={<SuggestionBoxPage />} />
          <Route path="classpulse"          element={<HODClassPulsePage />} />
          <Route path="live-analytics"      element={<LiveSessionAnalyticsPage />} />
          <Route path="*"                 element={<Navigate to="dashboard" replace />} />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}

