/**
 * HOD — Timetable Page
 *
 * Shows the subject-session schedule for the HOD's department.
 * Uses the same /api/hod/dashboard data as StudentsPage.
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function TimetablePage() {
  const [subjects, setSubjects]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState('');

  useEffect(() => {
    api.get('/hod/dashboard')
      .then(r => setSubjects(r.data?.subjects ?? []))
      .catch(() => setError('Failed to load department data.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="spinner mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-700">🗓️ Department Timetable</h2>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
          {subjects.length} subject{subjects.length !== 1 ? 's' : ''}
        </span>
      </div>

      {subjects.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          No subjects found in your department.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map(s => (
            <div key={s.id} className="card p-4 space-y-3">
              <div>
                <p className="font-semibold text-slate-800 truncate">{s.name}</p>
                <p className="text-xs text-slate-400 font-mono">{s.code}
                  {s.semester ? ` · Semester ${s.semester}` : ''}</p>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>Teacher</span>
                  <span className="font-medium text-slate-700">{s.teacher_name || '—'}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Sessions done</span>
                  <span className="font-medium text-slate-700">{s.sessions_done}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Avg attendance</span>
                  <span className={`font-bold ${
                    s.avg_pct >= 75 ? 'text-emerald-600'
                    : s.avg_pct >= 60 ? 'text-amber-500'
                    : 'text-red-500'}`}>
                    {s.avg_pct?.toFixed(1) ?? 0}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-4 bg-blue-50 border-blue-200 text-sm text-blue-700">
        📱 Full timetable scheduling (day, time, room) is available in the mobile app.
      </div>
    </div>
  );
}
