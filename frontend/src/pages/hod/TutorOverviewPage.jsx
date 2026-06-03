/**
 * TutorOverviewPage — Tutor cards with ward count, defaulter count,
 * TWM activity indicator.  API: GET /api/hod/tutor-overview
 */
import { useEffect, useState } from 'react';
import api from '../../api/axios';

export default function TutorOverviewPage() {
  const [tutors, setTutors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/hod/tutor-overview')
      .then((r) => setTutors(r.data || []))
      .catch(() => setError('Failed to load tutor overview.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading tutor overview…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="text-lg font-bold text-slate-800">📝 Tutor Overview</h2>
        <p className="text-sm text-slate-400 mt-1">
          All tutor–ward assignments in your department with activity indicators.
        </p>
      </div>

      {tutors.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No tutor assignments found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {tutors.map((t) => (
            <div key={t.tutor_id} className="card p-5 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {(t.tutor_name || 'T')
                    .split(' ')
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{t.tutor_name}</p>
                  <p className="text-xs text-slate-400 truncate">{t.email}</p>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-blue-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-blue-700">{t.ward_count}</p>
                  <p className="text-[10px] text-blue-500 uppercase">Wards</p>
                </div>
                <div
                  className={`rounded-lg p-2 text-center ${t.defaulter_count > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}
                >
                  <p
                    className={`text-lg font-bold ${t.defaulter_count > 0 ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    {t.defaulter_count}
                  </p>
                  <p className="text-[10px] text-slate-500 uppercase">Defaulters</p>
                </div>
                <div
                  className={`rounded-lg p-2 text-center ${t.pending_leaves > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}
                >
                  <p
                    className={`text-lg font-bold ${t.pending_leaves > 0 ? 'text-amber-600' : 'text-slate-400'}`}
                  >
                    {t.pending_leaves}
                  </p>
                  <p className="text-[10px] text-slate-500 uppercase">Pending Leaves</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-purple-600">{t.twm_sessions_this_month}</p>
                  <p className="text-[10px] text-purple-500 uppercase">TWM/Month</p>
                </div>
              </div>

              {/* Activity Indicator */}
              {t.twm_sessions_this_month === 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg font-medium">
                  ⚠️ No TWM sessions conducted this month
                </p>
              )}
              {t.defaulter_count > 0 && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg font-medium">
                  🚨 {t.defaulter_count} ward{t.defaulter_count > 1 ? 's' : ''} below {75}%
                  threshold
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
