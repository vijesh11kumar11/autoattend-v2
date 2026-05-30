/**
 * HOD ▸ Live Session Analytics
 * --------------------------------------------------------------
 * Department-wide analytics for ClassPulse Live (PROMPT 7).
 */
import { useEffect, useState } from 'react';
import api from '../../api/axios';

function StatCard({ icon, label, value, sub, tone = 'text-slate-800' }) {
  return (
    <div className="card p-4 flex items-start gap-3 border-violet-100">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
        <p className={`text-xl font-bold mt-0.5 ${tone}`}>{value ?? '—'}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function LiveSessionAnalyticsPage() {
  const [summary, setSummary] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('sessions_count');
  const [openTeacher, setOpenTeacher] = useState(null);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([api.get('/api/hod/dashboard'), api.get('/api/hod/live-sessions/overview')])
      .then(([d, o]) => {
        if (cancel) return;
        setSummary(d.data?.live_sessions_this_month || null);
        setOverview(o.data || null);
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, []);

  const openDetails = (teacherId) => {
    setOpenTeacher(teacherId);
    setDetails(null);
    api
      .get(`/api/hod/live-sessions/teacher/${teacherId}/details`)
      .then((r) => setDetails(r.data))
      .catch(() => setDetails({ error: true }));
  };

  if (loading) {
    return (
      <div className="card p-8 text-center text-slate-500">Loading live session analytics…</div>
    );
  }
  if (error) {
    return <div className="card p-6 border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>;
  }

  const teachers = [...(overview?.sessions_by_teacher || [])].sort((a, b) => {
    if (sortBy === 'avg_health_score') return (b.avg_health_score || 0) - (a.avg_health_score || 0);
    if (sortBy === 'auto_capsules_count')
      return (b.auto_capsules_count || 0) - (a.auto_capsules_count || 0);
    return (b.sessions_count || 0) - (a.sessions_count || 0);
  });
  const maxConfused = Math.max(
    1,
    ...(overview?.department_knowledge_gaps || []).map((g) => g.confused_students)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-3xl">📺</span>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Live Session Analytics</h1>
          <p className="text-xs text-slate-500">
            Department-wide ClassPulse Live insights for this month
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon="🎬" label="Total Sessions" value={summary?.total_sessions ?? 0} />
        <StatCard
          icon="❤️"
          label="Avg Health Score"
          value={`${summary?.average_health_score ?? 0}`}
          tone={
            (summary?.average_health_score ?? 0) >= 70
              ? 'text-emerald-600'
              : (summary?.average_health_score ?? 0) >= 50
                ? 'text-amber-600'
                : 'text-red-600'
          }
        />
        <StatCard
          icon="⏱️"
          label="Live Hours"
          value={summary?.total_live_attendance_hours ?? 0}
          sub="student hours"
        />
        <StatCard
          icon="👨‍🏫"
          label="Teachers Using"
          value={summary?.teachers_using_live ?? 0}
          sub={`${summary?.auto_capsules_generated ?? 0} auto-capsules`}
        />
      </div>

      {(summary?.subjects_with_zero_live_sessions || []).length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <p className="text-xs uppercase tracking-wide font-semibold text-amber-700 mb-1">
            Subjects without live sessions this month
          </p>
          <p className="text-sm text-amber-900">
            {summary.subjects_with_zero_live_sessions.join(' • ')}
          </p>
        </div>
      )}

      {/* Teacher table */}
      <div className="card p-4 border-violet-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-800">Teacher Performance</h2>
          <select
            className="text-xs border rounded px-2 py-1"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="sessions_count">Sort: Sessions</option>
            <option value="avg_health_score">Sort: Health Score</option>
            <option value="auto_capsules_count">Sort: Auto Capsules</option>
          </select>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="py-1">Teacher</th>
              <th>Sessions</th>
              <th>Avg Health</th>
              <th>Capsules</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.teacher_id} className="border-t">
                <td className="py-2 font-medium">{t.teacher_name}</td>
                <td>{t.sessions_count}</td>
                <td
                  className={
                    t.avg_health_score >= 70
                      ? 'text-emerald-600'
                      : t.avg_health_score >= 50
                        ? 'text-amber-600'
                        : 'text-red-600'
                  }
                >
                  {t.avg_health_score}
                </td>
                <td>{t.auto_capsules_count}</td>
                <td>
                  <button
                    className="text-xs text-violet-600 hover:underline"
                    onClick={() => openDetails(t.teacher_id)}
                  >
                    Details →
                  </button>
                </td>
              </tr>
            ))}
            {!teachers.length && (
              <tr>
                <td colSpan="5" className="py-4 text-center text-slate-400">
                  No live sessions yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Knowledge gap bar chart */}
      <div className="card p-4 border-violet-100">
        <h2 className="font-bold text-slate-800 mb-3">Department Knowledge Gaps</h2>
        <div className="space-y-2">
          {(overview?.department_knowledge_gaps || []).slice(0, 12).map((g, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700">
                  {g.subject_name} — {g.topic_name}
                </span>
                <span className="text-red-600">
                  {g.confused_students} confused / {g.understood_students} ok
                </span>
              </div>
              <div className="bg-slate-100 rounded h-2 overflow-hidden">
                <div
                  className="bg-red-500 h-2"
                  style={{ width: `${(g.confused_students / maxConfused) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {!(overview?.department_knowledge_gaps || []).length && (
            <p className="text-sm text-slate-400 text-center py-4">No knowledge gaps detected 🎉</p>
          )}
        </div>
      </div>

      {/* Top sessions + students needing attention */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4 border-emerald-100">
          <h2 className="font-bold text-slate-800 mb-3">🏆 Top Performing Sessions</h2>
          <ul className="space-y-2 text-sm">
            {(overview?.top_performing_sessions || []).map((s) => (
              <li key={s.session_id} className="flex justify-between border-b pb-1">
                <span className="text-slate-700">{s.title}</span>
                <span className="text-emerald-600 font-semibold">{s.health_score}</span>
              </li>
            ))}
            {!(overview?.top_performing_sessions || []).length && (
              <p className="text-slate-400 text-xs">—</p>
            )}
          </ul>
        </div>
        <div className="card p-4 border-red-100">
          <h2 className="font-bold text-slate-800 mb-3">🚨 Students Needing Attention</h2>
          <ul className="space-y-1 text-sm">
            {(overview?.students_needing_attention || []).map((s) => (
              <li key={s.student_id} className="flex justify-between border-b pb-1">
                <span className="text-slate-700">{s.student_name}</span>
                <span className="text-red-600 text-xs">{s.total_confusions} confusions</span>
              </li>
            ))}
            {!(overview?.students_needing_attention || []).length && (
              <p className="text-slate-400 text-xs">All clear ✓</p>
            )}
          </ul>
        </div>
      </div>

      {/* Teacher details modal */}
      {openTeacher && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setOpenTeacher(null)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-800">
                {details?.teacher_name || 'Teacher'} — Live History
              </h2>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setOpenTeacher(null)}
              >
                ✕
              </button>
            </div>
            {!details && <p className="text-slate-400 text-sm">Loading…</p>}
            {details?.error && <p className="text-red-500 text-sm">Failed to load details</p>}
            {details && !details.error && (
              <>
                {details.ai_pattern_observation && (
                  <div className="bg-violet-50 border border-violet-200 rounded p-3 mb-3 text-sm text-violet-900">
                    🤖 {details.ai_pattern_observation}
                  </div>
                )}
                <h3 className="text-xs uppercase font-semibold text-slate-500 mt-3 mb-2">
                  30-day trend
                </h3>
                <div className="flex gap-1 items-end h-24 bg-slate-50 rounded p-2">
                  {(details.trend_graph || []).map((d, i) => (
                    <div
                      key={i}
                      className="flex-1 flex flex-col items-center"
                      title={`${d.date}: ${d.avg_health_score}`}
                    >
                      <div
                        className="w-full bg-violet-500 rounded-t"
                        style={{ height: `${d.avg_health_score}%` }}
                      />
                    </div>
                  ))}
                  {!(details.trend_graph || []).length && (
                    <p className="text-xs text-slate-400 m-auto">No trend data</p>
                  )}
                </div>
                <h3 className="text-xs uppercase font-semibold text-slate-500 mt-4 mb-2">
                  Recent Sessions
                </h3>
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left">Title</th>
                      <th>Date</th>
                      <th>Mins</th>
                      <th>Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(details.history || []).slice(0, 20).map((h) => (
                      <tr key={h.session_id} className="border-t">
                        <td className="py-1">{h.title}</td>
                        <td className="text-center">
                          {h.started_at ? new Date(h.started_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="text-center">{h.duration_minutes ?? '—'}</td>
                        <td className="text-center">{h.health_score ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
