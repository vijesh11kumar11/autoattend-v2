/**
 * HOD — Students Page
 *
 * Displays the subject-level breakdown from /api/hod/dashboard:
 *   • Subject table with code, semester, assigned teacher, session count, avg attendance %
 *   • Search / filter by semester
 *   • Summary stat cards at the top
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';

const PCT_COLOR = (pct) => {
  if (pct >= 75) return 'text-emerald-600';
  if (pct >= 60) return 'text-amber-500';
  return 'text-red-500';
};

export default function StudentsPage() {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [semFilter, setSemFilter] = useState('');

  useEffect(() => {
    api.get('/hod/dashboard')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load department data.'))
      .finally(() => setLoading(false));
  }, []);

  const semesters = useMemo(() => {
    if (!data?.subjects) return [];
    return [...new Set(data.subjects.map(s => s.semester))].sort((a, b) => a - b);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.subjects) return [];
    return data.subjects.filter(s => {
      const q = search.toLowerCase();
      const matchSearch = !q || s.name.toLowerCase().includes(q)
        || s.code.toLowerCase().includes(q)
        || (s.teacher_name || '').toLowerCase().includes(q);
      const matchSem = !semFilter || String(s.semester) === semFilter;
      return matchSearch && matchSem;
    });
  }, [data, search, semFilter]);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="spinner mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading students data…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-5">
      {/* stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon="🎓" label="Total Students" value={data.student_count} />
        <StatCard icon="📚" label="Subjects"       value={data.subjects?.length ?? 0} />
        <StatCard icon="📈" label="Avg Attendance"  value={`${data.avg_attendance_pct?.toFixed(1) ?? 0}%`} />
        <StatCard icon="⏳" label="Pending Approvals" value={data.pending_approvals} danger={data.pending_approvals > 0} />
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search subject or teacher…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input flex-1 min-w-[200px]"
        />
        <select
          value={semFilter}
          onChange={e => setSemFilter(e.target.value)}
          className="input w-40"
        >
          <option value="">All Semesters</option>
          {semesters.map(s => <option key={s} value={s}>Semester {s}</option>)}
        </select>
      </div>

      {/* table */}
      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No subjects match your search.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Code</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Subject</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Sem</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Teacher</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Sessions</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Avg %</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-slate-500">{s.code}</td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-700">{s.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{s.semester}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{s.teacher_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{s.sessions_done}</td>
                  <td className={`px-4 py-3 text-sm font-bold ${PCT_COLOR(s.avg_pct)}`}>{s.avg_pct?.toFixed(1) ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, danger }) {
  return (
    <div className={`card p-4 flex items-start gap-3 ${danger ? 'border-red-200 bg-red-50' : ''}`}>
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
        <p className={`text-xl font-bold mt-0.5 ${danger ? 'text-red-600' : 'text-slate-800'}`}>{value ?? '—'}</p>
      </div>
    </div>
  );
}
