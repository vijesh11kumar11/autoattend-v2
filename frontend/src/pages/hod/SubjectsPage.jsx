import { useEffect, useState } from 'react';
import api from '../../api/axios';

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [semFilter, setSemFilter] = useState('all');

  useEffect(() => {
    api.get('/reports/hod/subjects')
      .then(r => setSubjects(r.data || []))
      .catch(() => setError('Failed to load subjects.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading subjects…</p>
      </div>
    );
  }

  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  const semesters = [...new Set(subjects.map(s => s.semester))].sort((a, b) => a - b);
  const filtered = semFilter === 'all' ? subjects : subjects.filter(s => s.semester === Number(semFilter));

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between flex-wrap gap-3">
          <span className="font-semibold text-slate-700">📚 Department Subjects ({filtered.length})</span>
          <select
            className="text-sm border rounded-lg px-3 py-1.5 text-slate-600"
            value={semFilter}
            onChange={e => setSemFilter(e.target.value)}
          >
            <option value="all">All Semesters</option>
            {semesters.map(s => <option key={s} value={s}>Semester {s}</option>)}
          </select>
        </div>
        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-slate-400 uppercase border-b">
                  <th className="px-5 py-2 text-left">Name</th>
                  <th className="px-5 py-2 text-left">Code</th>
                  <th className="px-5 py-2 text-left">Semester</th>
                  <th className="px-5 py-2 text-left">Course</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-medium text-slate-700">{s.name}</td>
                    <td className="px-5 py-3 text-sm text-slate-500">{s.code}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">
                        Sem {s.semester}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">{s.course_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400">No subjects found.</div>
        )}
      </div>
    </div>
  );
}
