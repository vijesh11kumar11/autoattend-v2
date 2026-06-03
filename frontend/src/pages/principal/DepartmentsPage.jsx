/**
 * TRACELN v2.0 — Principal: Departments Page
 *
 * Calls GET /api/principal/stats and renders department cards in a grid.
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const PCT_COLOR = (pct) => {
  if (pct >= 75) return 'text-emerald-600';
  if (pct >= 60) return 'text-amber-500';
  return 'text-red-500';
};

const PCT_BG = (pct) => {
  if (pct >= 75) return 'bg-emerald-500';
  if (pct >= 60) return 'bg-amber-400';
  return 'bg-red-500';
};

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/principal/stats')
      .then((r) => setDepartments(r.data.departments || []))
      .catch(() => setError('Failed to load departments.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return <div className="p-8 text-slate-400 text-sm animate-pulse">Loading departments…</div>;
  if (error) return <div className="p-8 text-red-500 text-sm">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {departments.length} department{departments.length !== 1 ? 's' : ''} in college
        </p>
      </div>

      {departments.length === 0 && (
        <div className="card p-10 text-center text-slate-400 text-sm">No departments found.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {departments.map((dept) => (
          <div key={dept.id} className="card p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-800 text-base">{dept.name}</p>
                <p className="text-xs text-slate-500 font-mono">{dept.code}</p>
              </div>
              <span className={`text-xl font-bold ${PCT_COLOR(dept.avg_attendance_pct)}`}>
                {dept.avg_attendance_pct}%
              </span>
            </div>

            {/* Attendance bar */}
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${PCT_BG(dept.avg_attendance_pct)}`}
                style={{ width: `${Math.min(dept.avg_attendance_pct, 100)}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="font-bold text-slate-800 text-lg">{dept.teacher_count}</p>
                <p className="text-xs text-slate-500">Teachers</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="font-bold text-slate-800 text-lg">{dept.student_count}</p>
                <p className="text-xs text-slate-500">Students</p>
              </div>
              <div
                className={`rounded-lg p-2 ${dept.defaulter_count > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}
              >
                <p
                  className={`font-bold text-lg ${dept.defaulter_count > 0 ? 'text-red-600' : 'text-emerald-600'}`}
                >
                  {dept.defaulter_count}
                </p>
                <p className="text-xs text-slate-500">Defaulters</p>
              </div>
            </div>

            {dept.hod_name && (
              <div className="pt-1 border-t border-slate-100 flex items-center gap-2">
                <span className="text-base">👩‍💼</span>
                <p className="text-xs text-slate-600 font-medium">{dept.hod_name}</p>
                <span className="text-xs text-slate-400 ml-auto">HOD</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
