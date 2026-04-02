/**
 * HOD — Teachers Page
 *
 * Displays all teachers in the HOD's department using /api/hod/dashboard data.
 * Shows teacher name, email, assigned subjects, and today's live session status.
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';

const SESSION_BADGE = {
  active:  { bg: 'bg-emerald-100 text-emerald-700', label: '🟢 Active' },
  ended:   { bg: 'bg-slate-100 text-slate-600',     label: 'Ended' },
  expired: { bg: 'bg-amber-100 text-amber-700',     label: 'Expired' },
};

export default function TeachersPage() {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');

  useEffect(() => {
    api.get('/hod/dashboard')
      .then(r => setTeachers(r.data?.teachers ?? []))
      .catch(() => setError('Failed to load teacher list.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return teachers;
    return teachers.filter(t =>
      t.name.toLowerCase().includes(q)
      || t.email.toLowerCase().includes(q)
      || (t.subject_names || []).some(s => s.toLowerCase().includes(q))
    );
  }, [teachers, search]);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="spinner mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading teachers…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-700">👩‍🏫 Teachers ({teachers.length})</h2>
        <input
          type="text"
          placeholder="Search name, email, subject…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-72"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No teachers match your search.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(t => {
            const sess = t.today_session;
            const badge = sess ? SESSION_BADGE[sess.status] || SESSION_BADGE.ended : null;
            return (
              <div key={t.id} className="card p-5 space-y-3 hover:shadow-md transition-shadow">
                <div>
                  <p className="font-semibold text-slate-700">{t.name}</p>
                  <p className="text-xs text-slate-400 truncate">{t.email}</p>
                </div>

                {/* subjects */}
                <div className="flex flex-wrap gap-1">
                  {(t.subject_names || []).length > 0 ? (
                    t.subject_names.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-full">{s}</span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-300 italic">No subjects assigned</span>
                  )}
                </div>

                {/* today's session */}
                {badge && (
                  <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${badge.bg}`}>
                    <span>{badge.label}</span>
                    <span className="font-semibold">{sess.present_count}/{sess.total_students} present</span>
                  </div>
                )}
                {!badge && (
                  <p className="text-xs text-slate-300 italic">No session today</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
