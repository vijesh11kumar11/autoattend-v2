import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

export default function TeacherReportsPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');

  useEffect(() => {
    Promise.all([api.get('/faculty/my-sessions'), api.get(`/faculty/${user.id}/classes`)])
      .then(([sesRes, clsRes]) => {
        setSessions(sesRes.data || []);
        setSubjects(clsRes.data || []);
      })
      .catch(() => setError('Failed to load report data.'))
      .finally(() => setLoading(false));
  }, [user.id]);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading reports…</p>
      </div>
    );
  }

  if (error) {
    return <div className="card p-8 text-center text-red-500">{error}</div>;
  }

  const filtered =
    subjectFilter === 'all' ? sessions : sessions.filter((s) => s.subject_code === subjectFilter);

  // Summary stats
  const totalSessions = filtered.length;
  const endedSessions = filtered.filter((s) => s.status === 'ended');
  const totalStudentSlots = endedSessions.reduce((a, s) => a + (s.total_students || 0), 0);
  const totalPresent = endedSessions.reduce((a, s) => a + (s.present_count || 0), 0);
  const avgPct = totalStudentSlots > 0 ? Math.round((totalPresent / totalStudentSlots) * 100) : 0;

  // Per-subject breakdown
  const subjectStats = {};
  for (const s of sessions) {
    const key = s.subject_code || 'Unknown';
    if (!subjectStats[key]) {
      subjectStats[key] = { name: s.subject_name, code: key, sessions: 0, total: 0, present: 0 };
    }
    subjectStats[key].sessions++;
    if (s.status === 'ended') {
      subjectStats[key].total += s.total_students || 0;
      subjectStats[key].present += s.present_count || 0;
    }
  }

  const exportCSV = () => {
    const rows = [['Subject', 'Code', 'Date', 'Time', 'Status', 'Present', 'Total', 'Percentage']];
    for (const s of filtered) {
      const pct = s.total_students ? Math.round((s.present_count / s.total_students) * 100) : 0;
      rows.push([
        s.subject_name,
        s.subject_code,
        s.date,
        s.start_time?.slice(0, 5) || '',
        s.status,
        s.present_count,
        s.total_students,
        `${pct}%`,
      ]);
    }
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{totalSessions}</p>
          <p className="text-sm text-slate-500">Total Sessions</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{totalPresent}</p>
          <p className="text-sm text-slate-500">Total Present</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{totalStudentSlots}</p>
          <p className="text-sm text-slate-500">Total Student Slots</p>
        </div>
        <div className="card p-4 text-center">
          <p
            className={`text-2xl font-bold ${avgPct >= 75 ? 'text-emerald-600' : avgPct >= 60 ? 'text-amber-500' : 'text-red-500'}`}
          >
            {avgPct}%
          </p>
          <p className="text-sm text-slate-500">Avg Attendance</p>
        </div>
      </div>

      {/* Subject-wise Breakdown */}
      {Object.keys(subjectStats).length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">
            📊 Subject-wise Breakdown
          </div>
          <div className="divide-y">
            {Object.values(subjectStats).map((ss) => {
              const pct = ss.total > 0 ? Math.round((ss.present / ss.total) * 100) : 0;
              return (
                <div key={ss.code} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-700">
                      {ss.name} <span className="text-slate-400 text-sm">({ss.code})</span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {ss.sessions} session{ss.sessions !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-32 bg-slate-200 rounded-full h-2 hidden sm:block">
                      <div
                        className={`h-2 rounded-full ${pct >= 75 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span
                      className={`text-sm font-bold min-w-[3rem] text-right ${pct >= 75 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}
                    >
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters + Export */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-700">📋 Session Details</span>
            <select
              className="text-sm border rounded-lg px-3 py-1.5 text-slate-600"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
            >
              <option value="all">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={exportCSV}
            className="px-4 py-1.5 bg-[#1a237e] text-white text-sm font-semibold rounded-lg hover:bg-[#283593]"
          >
            ⬇ Export CSV
          </button>
        </div>

        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-slate-400 uppercase border-b">
                  <th className="px-5 py-2 text-left">Subject</th>
                  <th className="px-5 py-2 text-left">Date</th>
                  <th className="px-5 py-2 text-left">Time</th>
                  <th className="px-5 py-2 text-left">Status</th>
                  <th className="px-5 py-2 text-left">Present</th>
                  <th className="px-5 py-2 text-left">%</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((s) => {
                  const pct = s.total_students
                    ? Math.round((s.present_count / s.total_students) * 100)
                    : 0;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 text-sm font-medium text-slate-700">
                        {s.subject_name} <span className="text-slate-400">({s.subject_code})</span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-500">{s.date}</td>
                      <td className="px-5 py-3 text-sm text-slate-500">
                        {s.start_time?.slice(0, 5)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${
                            s.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : s.status === 'ended'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm">
                        {s.present_count}/{s.total_students}
                      </td>
                      <td
                        className={`px-5 py-3 text-sm font-bold ${pct >= 75 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}
                      >
                        {pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400">No sessions found.</div>
        )}
      </div>
    </div>
  );
}
