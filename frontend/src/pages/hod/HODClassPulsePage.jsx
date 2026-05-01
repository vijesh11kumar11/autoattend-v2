/**
 * HOD ClassPulse Intelligence Dashboard
 *
 * Sections:
 *   1. Department Health Bar (top stats)
 *   2. Subject Overview Grid (cards → SubjectDetailModal slide-over)
 *   3. Attention Required (Hot Doubts + Students Struggling)
 *   4. Teacher Engagement Tracker (table)
 *   5. 7-Day Engagement Trend (pure CSS bars)
 *
 * Data:
 *   GET /api/classpulse/hod/department-analytics
 *   GET /api/classpulse/hod/subject/{id}/full-report  (modal)
 *
 * Optional ?department_id= for principal usage.
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';

// ── Color helpers ─────────────────────────────────────────────────────
const pctColor = (p) => p >= 70 ? 'bg-emerald-500' : p >= 50 ? 'bg-amber-500' : 'bg-red-500';
const pctText  = (p) => p >= 70 ? 'text-emerald-600' : p >= 50 ? 'text-amber-600' : 'text-red-600';

// ═══════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════
export default function HODClassPulsePage({ departmentId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');
  const [openSubject, setOpenSubject] = useState(null);  // {id, name, teacher_name}

  useEffect(() => {
    setLoading(true);
    const url = departmentId
      ? `/api/classpulse/hod/department-analytics?department_id=${departmentId}`
      : '/api/classpulse/hod/department-analytics';
    api.get(url)
      .then(r => setData(r.data))
      .catch(e => setErr(e?.response?.data?.detail || 'Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [departmentId]);

  if (loading) return <div className="p-8 text-slate-400 text-sm animate-pulse">Loading ClassPulse analytics…</div>;
  if (err)     return <div className="p-8 text-red-500 text-sm">{err}</div>;
  if (!data)   return null;

  const stats     = data.department_stats || {};
  const subjects  = data.subjects_overview || [];
  const topDoubts = data.top_doubts || [];
  const trend     = data.engagement_trend || [];
  const teachers  = data.teachers_not_using || [];

  // derive content gap count
  const gapCount = subjects.filter(s => s.content_gap_alert).length;
  const hotDoubtTotal = subjects.reduce((acc, s) => acc + (s.hot_doubts_count || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">📚 ClassPulse Intelligence</h2>
          <p className="text-xs text-slate-500">Department-wide content engagement & comprehension insights</p>
        </div>
      </div>

      {/* ── Section 1: Department Health Bar ── */}
      <DepartmentHealthBar
        stats={stats}
        gapCount={gapCount}
        hotDoubtTotal={hotDoubtTotal}
      />

      {/* ── Section 2: Subject Overview Grid ── */}
      <Section title="📖 Subject Overview">
        {subjects.length === 0 ? (
          <p className="text-sm text-slate-400">No subjects yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {subjects.map(s => (
              <SubjectCard
                key={s.subject_id}
                s={s}
                onOpen={() => setOpenSubject({ id: s.subject_id, name: s.subject_name, teacher_name: s.teacher_name })}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ── Section 3: Attention Required ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HotDoubtsPanel doubts={topDoubts} />
        <StrugglingStudentsPanel atRiskCount={stats.students_at_risk_count || 0} subjects={subjects} departmentId={departmentId} />
      </div>

      {/* ── Section 4: Teacher Engagement Tracker ── */}
      <TeacherEngagementTracker subjects={subjects} teachersNotUsing={teachers} />

      {/* ── Section 5: 7-Day Engagement Trend ── */}
      <EngagementTrendChart trend={trend} />

      {/* ── Subject Detail Modal ── */}
      {openSubject && (
        <SubjectDetailModal
          subject={openSubject}
          onClose={() => setOpenSubject(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 1: Department Health Bar
// ═══════════════════════════════════════════════════════════════════════
function DepartmentHealthBar({ stats, gapCount, hotDoubtTotal }) {
  const items = [
    { icon: '📚', label: 'Total Capsules',   value: stats.total_capsules ?? 0 },
    { icon: '👀', label: 'Avg Engagement',   value: `${stats.avg_engagement_pct ?? 0}%`, tone: pctText(stats.avg_engagement_pct ?? 0) },
    { icon: '🧠', label: 'Avg Comprehension',value: `${stats.avg_comprehension_pct ?? 0}%`, tone: pctText(stats.avg_comprehension_pct ?? 0) },
    { icon: '⚠️', label: 'Students At Risk', value: stats.students_at_risk_count ?? 0, tone: (stats.students_at_risk_count || 0) > 0 ? 'text-red-600' : 'text-slate-700' },
    { icon: '🔥', label: 'Hot Doubts',       value: hotDoubtTotal, tone: hotDoubtTotal > 0 ? 'text-orange-600' : 'text-slate-700' },
    { icon: '⚡', label: 'Content Gaps',     value: gapCount, tone: gapCount > 0 ? 'text-red-600' : 'text-slate-700' },
  ];
  return (
    <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map((it, i) => (
        <div key={i} className="flex flex-col items-center text-center px-2">
          <span className="text-xl">{it.icon}</span>
          <span className={`text-xl font-extrabold mt-1 ${it.tone || 'text-slate-800'}`}>{it.value}</span>
          <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 2: Subject Card
// ═══════════════════════════════════════════════════════════════════════
function SubjectCard({ s, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="text-left bg-white rounded-2xl shadow-sm hover:shadow-md transition border border-slate-100 p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-800 truncate">{s.subject_name}</p>
          <p className="text-xs text-slate-500 truncate">{s.teacher_name || '— No teacher —'}</p>
        </div>
        <span className="text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
          📚 {s.total_capsules}
        </span>
      </div>

      <ProgressBar label="Engagement"    value={s.avg_engagement_pct} hint="of students accessing content" />
      <ProgressBar label="Comprehension" value={s.avg_comprehension_pct} hint="passing quizzes" />

      <div className="flex flex-wrap gap-2 items-center">
        {s.last_upload_days_ago === null
          ? <span className="text-[10px] text-slate-400">No uploads yet</span>
          : <span className="text-[10px] text-slate-500">Last upload: {s.last_upload_days_ago}d ago</span>}
        {s.content_gap_alert && (
          <span className="text-[10px] font-semibold text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5 animate-pulse">
            ⚠️ No content uploaded in 14+ days
          </span>
        )}
        {s.hot_doubts_count > 0 && (
          <span className="text-[10px] font-semibold text-orange-700 bg-orange-100 border border-orange-200 rounded-full px-2 py-0.5">
            🔥 {s.hot_doubts_count} hot doubt{s.hot_doubts_count !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  );
}

function ProgressBar({ label, value, hint }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div>
      <div className="flex justify-between text-[10px] text-slate-500 mb-1">
        <span className="font-semibold uppercase tracking-wide">{label}</span>
        <span className={`font-bold ${pctText(v)}`}>{v}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${pctColor(v)} transition-all`} style={{ width: `${v}%` }} />
      </div>
      <p className="text-[9px] text-slate-400 mt-0.5">{hint}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 3a: Hot Doubts
// ═══════════════════════════════════════════════════════════════════════
function HotDoubtsPanel({ doubts }) {
  return (
    <Section title="🔥 Hot Doubts Across Department">
      {doubts.length === 0 ? (
        <p className="text-sm text-slate-400">No flagged doubts.</p>
      ) : (
        <div className="space-y-2">
          {doubts.map(d => {
            const ageHrs = d.created_at ? (Date.now() - new Date(d.created_at).getTime()) / 36e5 : 0;
            const stale  = d.status === 'open' && ageHrs > 48;
            return (
              <div key={d.id} className="border border-slate-100 rounded-xl p-3 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-700 line-clamp-2 flex-1">{d.content}</p>
                  <span className="text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5 shrink-0">
                    🤝 {d.resonance_count}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-slate-500">📚 {d.subject_name}</span>
                  <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border ${
                    d.status === 'answered' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>{d.status}</span>
                  {stale && (
                    <span className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5">
                      🚨 Teacher hasn't responded (48h+)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 3b: Struggling Students (best-effort, fetches from full-report)
// ═══════════════════════════════════════════════════════════════════════
function StrugglingStudentsPanel({ atRiskCount, subjects, departmentId }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [notifying, setNotifying] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const ids = subjects.map(s => s.subject_id);
    if (ids.length === 0) { setLoading(false); return; }
    Promise.all(ids.map(id =>
      api.get(`/api/classpulse/hod/subject/${id}/full-report`).then(r => r.data).catch(() => null)
    )).then(reports => {
      if (cancelled) return;
      const failMap = new Map(); // student_id → { name, roll_no, subjects:Set, fail_count }
      reports.forEach(rep => {
        if (!rep) return;
        const subjName = rep.subject?.name;
        (rep.per_student_matrix || []).forEach(row => {
          const fails = (row.capsules || []).filter(c => c.quiz_passed === false).length;
          if (fails > 2) {
            const cur = failMap.get(row.student_id) || { name: row.name, roll_no: row.roll_no, subjects: new Set(), fail_count: 0 };
            cur.subjects.add(subjName);
            cur.fail_count += fails;
            failMap.set(row.student_id, cur);
          }
        });
      });
      setStudents(Array.from(failMap.entries()).map(([id, v]) => ({
        id, name: v.name, roll_no: v.roll_no,
        subjects: Array.from(v.subjects).filter(Boolean),
        fail_count: v.fail_count,
      })).sort((a, b) => b.fail_count - a.fail_count));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [subjects, departmentId]);

  const notify = async (s) => {
    setNotifying(s.id);
    try {
      await api.post(`/hod/notify-tutor/${s.id}`, { reason: 'low_classpulse_comprehension' });
      alert(`Tutor notified for ${s.name}`);
    } catch {
      alert('Tutor notification endpoint not available; alerting failed.');
    } finally {
      setNotifying(null);
    }
  };

  return (
    <Section title={`😟 Students Struggling (${atRiskCount} at risk)`}>
      {loading ? (
        <p className="text-xs text-slate-400 animate-pulse">Aggregating per-student quiz failures…</p>
      ) : students.length === 0 ? (
        <p className="text-sm text-slate-400">No students with persistent quiz failures detected.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {students.slice(0, 10).map(s => (
            <div key={s.id} className="border border-slate-100 rounded-xl p-3 bg-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold">
                {(s.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 text-sm truncate">{s.name}</p>
                <p className="text-[10px] text-slate-500">Roll: {s.roll_no || '—'} · {s.fail_count} quiz fail{s.fail_count !== 1 ? 's' : ''}</p>
                {s.subjects.length > 0 && (
                  <p className="text-[10px] text-slate-500 truncate">📚 {s.subjects.join(', ')}</p>
                )}
              </div>
              <button
                onClick={() => notify(s)}
                disabled={notifying === s.id}
                className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-2 py-1 shrink-0"
              >
                {notifying === s.id ? '…' : '📩 Notify Tutor'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 4: Teacher Engagement Tracker
// ═══════════════════════════════════════════════════════════════════════
function TeacherEngagementTracker({ subjects, teachersNotUsing }) {
  // Aggregate teacher stats from subjects_overview
  const rows = useMemo(() => {
    const map = new Map();
    subjects.forEach(s => {
      if (!s.teacher_id) return;
      const cur = map.get(s.teacher_id) || {
        teacher_id: s.teacher_id,
        teacher_name: s.teacher_name,
        total_capsules: 0,
        last_upload_days_ago: null,
        engagement_sum: 0,
        engagement_count: 0,
      };
      cur.total_capsules += s.total_capsules || 0;
      if (s.last_upload_days_ago !== null) {
        cur.last_upload_days_ago = cur.last_upload_days_ago === null
          ? s.last_upload_days_ago
          : Math.min(cur.last_upload_days_ago, s.last_upload_days_ago);
      }
      if (s.total_capsules > 0) {
        cur.engagement_sum += s.avg_engagement_pct || 0;
        cur.engagement_count += 1;
      }
      map.set(s.teacher_id, cur);
    });
    // Add teachers from teachersNotUsing who have 0 capsules
    teachersNotUsing.forEach(t => {
      if (!map.has(t.teacher_id)) {
        map.set(t.teacher_id, {
          teacher_id: t.teacher_id,
          teacher_name: t.name,
          total_capsules: 0,
          last_upload_days_ago: t.days_ago ?? null,
          engagement_sum: 0,
          engagement_count: 0,
        });
      }
    });
    return Array.from(map.values()).map(r => ({
      ...r,
      avg_engagement: r.engagement_count > 0 ? Math.round((r.engagement_sum / r.engagement_count) * 10) / 10 : 0,
      using: r.total_capsules > 0 && (r.last_upload_days_ago === null || r.last_upload_days_ago <= 14),
    })).sort((a, b) => {
      // sort by last upload — null (never) first, then largest days ago, etc.
      const ax = a.last_upload_days_ago ?? 9999;
      const bx = b.last_upload_days_ago ?? 9999;
      return bx - ax;
    });
  }, [subjects, teachersNotUsing]);

  const [reminding, setReminding] = useState(null);
  const remind = async (t) => {
    if (!confirm(`Send a reminder to ${t.teacher_name} to use ClassPulse?`)) return;
    setReminding(t.teacher_id);
    try {
      await api.post(`/hod/notify-teacher/${t.teacher_id}`, { reason: 'classpulse_inactive' });
      alert(`Reminder sent to ${t.teacher_name}`);
    } catch {
      alert('Reminder endpoint not available.');
    } finally {
      setReminding(null);
    }
  };

  return (
    <Section title="👩‍🏫 Teacher Engagement Tracker">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No teachers in scope.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500 border-b border-slate-100">
              <tr>
                <th className="py-2 pr-2">Teacher</th>
                <th className="py-2 pr-2">Capsules</th>
                <th className="py-2 pr-2">Last Upload</th>
                <th className="py-2 pr-2">Avg Engagement</th>
                <th className="py-2 pr-2">Using ClassPulse?</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.teacher_id} className={`border-b border-slate-50 ${!r.using ? 'bg-red-50/40' : ''}`}>
                  <td className="py-2 pr-2 font-medium text-slate-800">{r.teacher_name}</td>
                  <td className="py-2 pr-2 text-slate-700">{r.total_capsules}</td>
                  <td className="py-2 pr-2 text-slate-600">
                    {r.last_upload_days_ago === null ? '—' : `${r.last_upload_days_ago}d ago`}
                  </td>
                  <td className={`py-2 pr-2 font-bold ${pctText(r.avg_engagement)}`}>{r.avg_engagement}%</td>
                  <td className="py-2 pr-2">
                    {r.using
                      ? <span className="text-emerald-600 font-semibold">✅ Active</span>
                      : <span className="text-red-600 font-semibold">❌ Inactive</span>}
                  </td>
                  <td className="py-2 text-right">
                    {!r.using && (
                      <button
                        onClick={() => remind(r)}
                        disabled={reminding === r.teacher_id}
                        className="text-[11px] font-semibold bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-md px-2 py-1 disabled:opacity-50"
                      >
                        {reminding === r.teacher_id ? '…' : '📩 Remind Teacher'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Section 5: 7-Day Engagement Trend Chart (pure CSS bars)
// ═══════════════════════════════════════════════════════════════════════
function EngagementTrendChart({ trend }) {
  const max = Math.max(1, ...trend.map(d => d.count || 0));
  const dayLabel = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    } catch { return iso; }
  };
  return (
    <Section title="📈 7-Day Engagement Trend">
      {trend.length === 0 ? (
        <p className="text-sm text-slate-400">No interactions yet.</p>
      ) : (
        <div className="flex items-end justify-between gap-2 h-44 pt-4">
          {trend.map((d, i) => {
            const h = Math.round(((d.count || 0) / max) * 100);
            return (
              <div key={i} className="flex-1 flex flex-col items-center group relative">
                <div
                  className="w-full bg-gradient-to-t from-violet-600 to-violet-300 rounded-t-md transition-all hover:from-violet-700 hover:to-violet-400"
                  style={{ height: `${h}%`, minHeight: 4 }}
                  title={`${d.date}: ${d.count} interaction${d.count !== 1 ? 's' : ''}`}
                />
                <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition bg-slate-800 text-white text-[10px] font-semibold rounded px-2 py-0.5 whitespace-nowrap pointer-events-none">
                  {d.count} interaction{d.count !== 1 ? 's' : ''}
                </div>
                <span className="text-[10px] text-slate-500 mt-1">{dayLabel(d.date)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Subject Detail Modal (slide-over)
// ═══════════════════════════════════════════════════════════════════════
function SubjectDetailModal({ subject, onClose }) {
  const [tab, setTab] = useState('capsules');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/classpulse/hod/subject/${subject.id}/full-report`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [subject.id]);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="w-full max-w-4xl bg-white shadow-2xl overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 bg-white border-b border-slate-100 p-4 flex items-start justify-between gap-3 z-10">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{subject.name}</h3>
            <p className="text-xs text-slate-500">{subject.teacher_name || '—'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>
        <div className="px-4 pt-3 border-b border-slate-100 flex gap-1">
          {['capsules', 'students', 'wall'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-semibold rounded-t-lg ${tab === t ? 'text-violet-700 border-b-2 border-violet-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t === 'capsules' ? 'Capsules' : t === 'students' ? 'Students' : 'Wall Activity'}
            </button>
          ))}
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
          ) : !data ? (
            <p className="text-sm text-red-500">Failed to load report.</p>
          ) : tab === 'capsules' ? (
            <CapsulesTable capsules={data.capsules || []} matrix={data.per_student_matrix || []} />
          ) : tab === 'students' ? (
            <StudentMatrix capsules={data.capsules || []} matrix={data.per_student_matrix || []} />
          ) : (
            <WallActivityTab subjectId={subject.id} summary={data.wall_summary} />
          )}
        </div>
      </div>

      {/* slide-in keyframe */}
      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        .animate-slide-in-right { animation: slide-in-right 220ms cubic-bezier(.2,.8,.2,1); }
      `}</style>
    </div>
  );
}

function CapsulesTable({ capsules, matrix }) {
  // engagement = % of students who opened; comprehension = % quiz_passed among quiz_attempted
  const rows = capsules.map(c => {
    let opened = 0, attempted = 0, passed = 0;
    matrix.forEach(row => {
      const cell = (row.capsules || []).find(x => x.capsule_id === c.id);
      if (cell?.opened) opened += 1;
      if (cell?.quiz_passed === true) { attempted += 1; passed += 1; }
      else if (cell?.quiz_passed === false) attempted += 1;
    });
    const total = matrix.length || 1;
    return {
      ...c,
      engagement_pct: Math.round((opened / total) * 100),
      comprehension_pct: attempted > 0 ? Math.round((passed / attempted) * 100) : null,
    };
  });
  if (rows.length === 0) return <p className="text-sm text-slate-400">No capsules.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-slate-500 border-b border-slate-100">
          <tr>
            <th className="py-2 pr-2">Title</th>
            <th className="py-2 pr-2">Type</th>
            <th className="py-2 pr-2">Views</th>
            <th className="py-2 pr-2">Downloads</th>
            <th className="py-2 pr-2">Engagement</th>
            <th className="py-2">Comprehension</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-slate-50">
              <td className="py-2 pr-2 font-medium text-slate-800">{r.title}</td>
              <td className="py-2 pr-2 text-slate-600">{r.capsule_type}</td>
              <td className="py-2 pr-2">{r.view_count}</td>
              <td className="py-2 pr-2">{r.download_count}</td>
              <td className={`py-2 pr-2 font-bold ${pctText(r.engagement_pct)}`}>{r.engagement_pct}%</td>
              <td className={`py-2 font-bold ${r.comprehension_pct === null ? 'text-slate-400' : pctText(r.comprehension_pct)}`}>
                {r.comprehension_pct === null ? '—' : `${r.comprehension_pct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudentMatrix({ capsules, matrix }) {
  if (matrix.length === 0) return <p className="text-sm text-slate-400">No students.</p>;
  const cellOf = (cell) => {
    if (!cell) return { icon: '⬜', cls: 'bg-slate-50 text-slate-300' };
    if (cell.quiz_passed === true)  return { icon: '✅', cls: 'bg-emerald-50 text-emerald-700' };
    if (cell.quiz_passed === false) return { icon: '❌', cls: 'bg-red-50 text-red-700' };
    if (cell.opened)                return { icon: '📖', cls: 'bg-amber-50 text-amber-700' };
    return { icon: '⬜', cls: 'bg-slate-50 text-slate-300' };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left">
            <th className="py-2 pr-2 sticky left-0 bg-white">Student</th>
            <th className="py-2 pr-2 sticky left-24 bg-white">Roll</th>
            {capsules.map(c => (
              <th key={c.id} className="py-2 px-2 text-center text-[10px] text-slate-500 max-w-[80px]">
                <div className="truncate" title={c.title}>{c.title}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map(row => (
            <tr key={row.student_id} className="border-b border-slate-50">
              <td className="py-2 pr-2 font-medium text-slate-800 sticky left-0 bg-white">{row.name}</td>
              <td className="py-2 pr-2 text-slate-500 sticky left-24 bg-white">{row.roll_no}</td>
              {capsules.map(c => {
                const cell = (row.capsules || []).find(x => x.capsule_id === c.id);
                const m = cellOf(cell);
                return (
                  <td key={c.id} className="py-2 px-1 text-center">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-sm ${m.cls}`}>{m.icon}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
        <span>✅ Passed quiz</span>
        <span>❌ Failed quiz</span>
        <span>📖 Opened (no quiz)</span>
        <span>⬜ Not opened</span>
      </div>
    </div>
  );
}

function WallActivityTab({ subjectId, summary }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.get(`/api/classpulse/teacher/subject/${subjectId}/wall`)
      .then(r => setPosts(r.data?.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [subjectId]);

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-4 gap-2 text-xs">
          <Stat label="Total"    value={summary.total} />
          <Stat label="Open"     value={summary.open}     tone="text-amber-600" />
          <Stat label="Answered" value={summary.answered} tone="text-emerald-600" />
          <Stat label="Hot"      value={summary.hot}      tone="text-orange-600" />
        </div>
      )}
      {loading ? (
        <p className="text-sm text-slate-400 animate-pulse">Loading wall…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-slate-400">No wall posts.</p>
      ) : (
        <div className="space-y-2">
          {posts.map(p => (
            <div key={p.id} className="border border-slate-100 rounded-xl p-3 bg-white">
              <p className="text-sm text-slate-700">{p.content}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                <span className="text-slate-500">🤝 {p.resonance_count}</span>
                {p.is_hot && <span className="text-orange-600 font-semibold">🔥 Hot</span>}
                <span className={`font-semibold rounded-full px-2 py-0.5 border ${
                  p.status === 'answered' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>{p.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2 text-center">
      <p className={`text-lg font-bold ${tone || 'text-slate-800'}`}>{value ?? 0}</p>
      <p className="text-[9px] uppercase text-slate-500 tracking-wide">{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Generic Section wrapper
// ═══════════════════════════════════════════════════════════════════════
function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <h3 className="text-sm font-bold text-slate-800 mb-3">{title}</h3>
      {children}
    </div>
  );
}
