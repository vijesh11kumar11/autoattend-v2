/**
 * StatsPage — /admin/stats
 *
 * Platform-wide totals from GET /api/admin/stats.
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const PLAN_CHIP = {
  trial:     'bg-yellow-100 text-yellow-800',
  active:    'bg-green-100  text-green-800',
  suspended: 'bg-red-100    text-red-700',
  cancelled: 'bg-slate-200  text-slate-600',
};

export default function StatsPage() {
  const [stats,   setStats]   = useState(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/admin/stats');
        setStats(data);
      } catch (err) {
        const detail = err?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : 'Failed to load stats.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error)   return <div className="p-6 text-red-600">{error}</div>;
  if (!stats)  return null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Platform Stats</h1>
        <p className="text-sm text-slate-500">Aggregate totals across all tenants</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card label="Total Colleges" value={stats.total_colleges} accent="text-amber-600" />
        <Card label="Total Users"    value={stats.total_users}    accent="text-blue-600" />
        <Card label="Total Students" value={stats.total_students} accent="text-emerald-600" />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Colleges by Plan</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.colleges_by_plan).map(([plan, count]) => (
            <span key={plan}
              className={`px-3 py-1 rounded text-sm font-medium ${
                PLAN_CHIP[plan] || 'bg-slate-100 text-slate-600'
              }`}>
              {plan}: <b className="tabular-nums">{count}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, accent = 'text-slate-800' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}
