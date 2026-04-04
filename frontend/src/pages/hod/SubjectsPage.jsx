import { useEffect, useState } from 'react';
import api from '../../api/axios';

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [semFilter, setSemFilter] = useState('all');
  const [editing, setEditing] = useState(null);   // subject id being edited
  const [editVal, setEditVal] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/reports/hod/subjects')
      .then(r => setSubjects(r.data || []))
      .catch(() => setError('Failed to load subjects.'))
      .finally(() => setLoading(false));
  }, []);

  const saveTotalLectures = async (id) => {
    const val = parseInt(editVal, 10);
    if (isNaN(val) || val < 0) return;
    setSaving(true);
    try {
      await api.patch(`/hod/subjects/${id}/total-lectures?total_lectures=${val}`);
      setSubjects(prev => prev.map(s => s.id === id ? { ...s, total_lectures: val } : s));
      setEditing(null);
    } catch { /* ignore */ }
    setSaving(false);
  };

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
                  <th className="px-5 py-2 text-left">Total Lectures</th>
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
                    <td className="px-5 py-3">
                      {editing === s.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input type="number" min="0" className="w-20 border rounded px-2 py-1 text-sm"
                            value={editVal} onChange={e => setEditVal(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveTotalLectures(s.id)} autoFocus />
                          <button onClick={() => saveTotalLectures(s.id)} disabled={saving}
                            className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">✓</button>
                          <button onClick={() => setEditing(null)}
                            className="text-xs px-2 py-1 bg-slate-200 text-slate-600 rounded hover:bg-slate-300">✕</button>
                        </span>
                      ) : (
                        <button onClick={() => { setEditing(s.id); setEditVal(String(s.total_lectures || 0)); }}
                          className="text-sm text-indigo-600 hover:underline">
                          {s.total_lectures || <span className="text-slate-400 italic">set</span>}
                        </button>
                      )}
                    </td>
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
