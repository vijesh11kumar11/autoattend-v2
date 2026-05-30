/**
 * TeacherPerformancePage — Per-teacher stats table, sortable.
 * API: GET /api/hod/teacher-performance
 */
import { useEffect, useState } from 'react';
import api from '../../api/axios';

const SORT_KEYS = [
  { key: 'name', label: 'Name' },
  { key: 'subjects_count', label: 'Subjects' },
  { key: 'sessions_conducted_this_month', label: 'Sessions/Mo' },
  { key: 'avg_attendance_pct', label: 'Avg %' },
  { key: 'pending_disputes', label: 'Disputes' },
];

export default function TeacherPerformancePage() {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('avg_attendance_pct');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    api
      .get('/hod/teacher-performance')
      .then((r) => setTeachers(r.data || []))
      .catch(() => setError('Failed to load teacher performance.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  const sorted = [...teachers].sort((a, b) => {
    const av = a[sortBy],
      bv = b[sortBy];
    if (typeof av === 'string')
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading teacher performance…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="text-lg font-bold text-slate-800">👩‍🏫 Teacher Performance</h2>
        <p className="text-sm text-slate-400 mt-1">
          Per-teacher statistics for your department. Click headers to sort.
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No teachers found.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  {SORT_KEYS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase cursor-pointer hover:text-slate-800 select-none"
                    >
                      {col.label}
                      {sortBy === col.key && (
                        <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">
                    Email
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((t) => (
                  <tr key={t.teacher_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{t.subjects_count}</td>
                    <td className="px-4 py-3 text-center text-slate-600">
                      {t.sessions_conducted_this_month}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${t.avg_attendance_pct >= 75 ? 'bg-emerald-500' : t.avg_attendance_pct >= 60 ? 'bg-amber-400' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(t.avg_attendance_pct, 100)}%` }}
                          />
                        </div>
                        <span
                          className={`text-xs font-bold ${t.avg_attendance_pct >= 75 ? 'text-emerald-600' : t.avg_attendance_pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}
                        >
                          {t.avg_attendance_pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {t.pending_disputes > 0 ? (
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-700">
                          {t.pending_disputes}
                        </span>
                      ) : (
                        <span className="text-slate-300">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{t.email}</td>
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
