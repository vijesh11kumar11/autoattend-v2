/**
 * HOD — Subjects Page
 *
 * Displays all subjects in the department with code, semester,
 * assigned teacher, sessions done, and average attendance %.
 * Data is sourced from /api/hod/dashboard.
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';

const PCT_COLOR = (pct) => {
  if (pct >= 75) return 'text-emerald-600';
  if (pct >= 60) return 'text-amber-500';
  return 'text-red-500';
};

export default function SubjectsPage() {
  const [subjects,  setSubjects]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [semFilter, setSemFilter] = useState('');

  useEffect(() => {
    api.get('/hod/dashboard')
      .then(r => setSubjects(r.data?.subjects ?? []))
      .catch(() => setError('Failed to load subjects.'))
      .finally(() => setLoading(false));
  }, []);

  const semesters = useMemo(() =>
    [...new Set(subjects.map(s => s.semester).filter(Boolean))].sort((a, b) => a - b),
    [subjects]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return subjects.filter(s => {
      const matchSearch = !q
        || s.name.toLowerCase().includes(q)
        || s.code.toLowerCase().includes(q)
        || (s.teacher_name || '').toLowerCase().includes(q);
      const matchSem = !semFilter || String(s.semester) === semFilter;
      return matchSearch && matchSem;
    });
  }, [subjects, search, semFilter]);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="spinner mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading subjects…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-700">📚 Subjects ({subjects.length})</h2>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search subject, code, or teacher…"
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

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No subjects match your search.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-100 border-b">
                {['Code', 'Subject', 'Sem', 'Teacher', 'Sessions', 'Avg %'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-slate-500">{s.code}</td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-700">{s.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{s.semester ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{s.teacher_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{s.sessions_done}</td>
                  <td className={`px-4 py-3 text-sm font-bold ${PCT_COLOR(s.avg_pct)}`}>
                    {s.avg_pct?.toFixed(1) ?? 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
