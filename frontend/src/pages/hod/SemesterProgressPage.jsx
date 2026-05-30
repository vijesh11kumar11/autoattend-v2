/**
 * SemesterProgressPage — Syllabus coverage / session progress tracker.
 * API: GET /api/analytics/semester-progress?department_id=
 */
import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

export default function SemesterProgressPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.department_id) return;
    api
      .get('/analytics/semester-progress', { params: { department_id: user.department_id } })
      .then((r) => setRows(r.data || []))
      .catch(() => setError('Failed to load semester progress.'))
      .finally(() => setLoading(false));
  }, [user?.department_id]);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading semester progress…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  const behind = rows.filter((r) => r.behind_schedule);
  const onTrack = rows.filter((r) => !r.behind_schedule);

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="text-lg font-bold text-slate-800">📈 Semester Progress Tracker</h2>
        <p className="text-sm text-slate-400 mt-1">
          Compare planned vs conducted sessions per subject. Identify teachers falling behind
          schedule.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{rows.length}</p>
          <p className="text-xs text-slate-400">Subjects</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{onTrack.length}</p>
          <p className="text-xs text-slate-400">On Track</p>
        </div>
        <div
          className={`card p-4 text-center ${behind.length > 0 ? 'border-red-200 bg-red-50' : ''}`}
        >
          <p
            className={`text-2xl font-bold ${behind.length > 0 ? 'text-red-600' : 'text-slate-400'}`}
          >
            {behind.length}
          </p>
          <p className="text-xs text-slate-400">Behind Schedule</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No subjects found.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  {[
                    'Subject',
                    'Code',
                    'Sem',
                    'Teacher',
                    'Weekly Slots',
                    'Planned',
                    'Conducted',
                    'Progress',
                    'Status',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr
                    key={r.subject_id}
                    className={`hover:bg-slate-50 ${r.behind_schedule ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">{r.subject_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.subject_code}</td>
                    <td className="px-4 py-3 text-slate-500">{r.semester}</td>
                    <td className="px-4 py-3 text-slate-600">{r.teacher_name}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{r.weekly_slots}</td>
                    <td className="px-4 py-3 text-center text-slate-500">{r.planned_sessions}</td>
                    <td className="px-4 py-3 text-center font-semibold text-slate-700">
                      {r.conducted_sessions}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${r.completion_pct >= 80 ? 'bg-emerald-500' : r.completion_pct >= 50 ? 'bg-amber-400' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(r.completion_pct, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-600">
                          {r.completion_pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.behind_schedule ? (
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700">
                          Behind
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700">
                          On Track
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
