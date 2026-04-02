/**
 * AutoAttend AI v2.0 — Principal Dashboard
 *
 * Routes served (within /principal/*):
 *   dashboard   → PrincipalOverview  (this file)
 *   departments → DepartmentsPage
 *   reports     → CollegeReportsPage
 *   alerts      → PrincipalAlertsPage
 *   audit       → PrincipalAuditPage
 */

import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../../api/axios';
import DashboardLayout from '../../components/DashboardLayout';
import CollegeReportsPage  from './CollegeReportsPage';
import DepartmentsPage     from './DepartmentsPage';
import PrincipalAlertsPage from './PrincipalAlertsPage';
import PrincipalAuditPage  from './PrincipalAuditPage';

// ── colour helpers ────────────────────────────────────────────────────
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

const DISTRIBUTION_COLORS = ['#10b981', '#f59e0b', '#ef4444'];

// ── Stat card ─────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, danger }) {
  return (
    <div className={`card p-5 flex items-start gap-4 ${danger ? 'border-red-200 bg-red-50' : ''}`}>
      <span className="text-3xl">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${danger ? 'text-red-600' : 'text-slate-800'}`}>
          {value ?? '—'}
        </p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Department card ───────────────────────────────────────────────────
function DeptCard({ dept }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800">{dept.name}</p>
          <p className="text-xs text-slate-500">{dept.code}</p>
        </div>
        <span className={`text-sm font-bold ${PCT_COLOR(dept.avg_attendance_pct)}`}>
          {dept.avg_attendance_pct}%
        </span>
      </div>

      {/* Attendance bar */}
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${PCT_BG(dept.avg_attendance_pct)}`}
          style={{ width: `${Math.min(dept.avg_attendance_pct, 100)}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-600">
        <div>
          <p className="font-semibold text-slate-800">{dept.teacher_count}</p>
          <p>Teachers</p>
        </div>
        <div>
          <p className="font-semibold text-slate-800">{dept.student_count}</p>
          <p>Students</p>
        </div>
        <div>
          <p className={`font-semibold ${dept.defaulter_count > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
            {dept.defaulter_count}
          </p>
          <p>Defaulters</p>
        </div>
      </div>

      {dept.hod_name && (
        <p className="text-xs text-slate-400 truncate">HOD: {dept.hod_name}</p>
      )}
    </div>
  );
}

// ── Overview page ─────────────────────────────────────────────────────
function PrincipalOverview() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/principal/stats')
      .then((r) => setData(r.data))
      .catch(() => setError('Failed to load dashboard data.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-slate-400 text-sm animate-pulse">Loading overview…</div>;
  if (error)   return <div className="p-8 text-red-500 text-sm">{error}</div>;

  const distData = [
    { name: 'Safe (≥75%)',    value: data.distribution.safe     },
    { name: 'At Risk (60–75%)', value: data.distribution.at_risk },
    { name: 'Detained (<60%)', value: data.distribution.detained },
  ];

  return (
    <div className="space-y-6">
      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard icon="🏛️" label="Departments"      value={data.total_departments} />
        <StatCard icon="👩‍🏫" label="Teachers"         value={data.total_teachers} />
        <StatCard icon="🎓" label="Students"          value={data.total_students} />
        <StatCard icon="✅" label="Overall Attendance" value={`${data.overall_attendance_pct}%`}
                  sub="Ended sessions" />
        <StatCard icon="⚠️" label="Critical Defaulters" value={data.critical_defaulters}
                  danger={data.critical_defaulters > 0} sub={`< ${75}% overall`} />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar chart: dept comparison */}
        <div className="card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Department Attendance Comparison</h3>
          {data.departments.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.departments} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => [`${v}%`, 'Attendance']}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="avg_attendance_pct" name="Attendance %" radius={[4, 4, 0, 0]}>
                  {data.departments.map((dept, i) => (
                    <Cell
                      key={i}
                      fill={dept.avg_attendance_pct >= 75 ? '#10b981' : dept.avg_attendance_pct >= 60 ? '#f59e0b' : '#ef4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-sm text-center py-10">No session data yet</p>
          )}
        </div>

        {/* Pie chart: distribution */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Student Distribution</h3>
          {data.distribution.safe + data.distribution.at_risk + data.distribution.detained > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={distData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                  dataKey="value" nameKey="name" paddingAngle={3}
                >
                  {distData.map((_, i) => (
                    <Cell key={i} fill={DISTRIBUTION_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [v, 'Students']} contentStyle={{ fontSize: 12 }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-sm text-center py-10">No attendance data yet</p>
          )}
        </div>
      </div>

      {/* ── 30-day trend ── */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">30-Day Attendance Trend</h3>
        {data.attendance_trend.length ? (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data.attendance_trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }}
                     tickFormatter={(d) => d.slice(5)} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v) => [`${v}%`, 'Attendance']}
                contentStyle={{ fontSize: 12 }}
                labelFormatter={(d) => `Date: ${d}`}
              />
              <Line type="monotone" dataKey="pct" stroke="#3b82f6" strokeWidth={2}
                    dot={{ r: 2 }} activeDot={{ r: 4 }} name="Attendance %" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-slate-400 text-sm text-center py-6">No trend data yet</p>
        )}
      </div>

      {/* ── Department cards grid ── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Departments</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.departments.map((dept) => (
            <DeptCard key={dept.id} dept={dept} />
          ))}
        </div>
      </div>

      {/* ── Recent alerts ── */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Recent Alerts</h3>
          <a href="/principal/alerts" className="text-xs text-blue-600 hover:underline">
            View all / Send alerts →
          </a>
        </div>
        {data.recent_alerts.length ? (
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="pb-2 pr-3 font-semibold">Student</th>
                <th className="pb-2 pr-3 font-semibold">Message</th>
                <th className="pb-2 pr-3 font-semibold">Channel</th>
                <th className="pb-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.recent_alerts.map((a) => (
                <tr key={a.id} className="text-slate-700">
                  <td className="py-1.5 pr-3">{a.student_name}</td>
                  <td className="py-1.5 pr-3 max-w-xs truncate">{a.message}</td>
                  <td className="py-1.5 pr-3 capitalize">{a.channel}</td>
                  <td className="py-1.5">
                    <span className={`badge ${a.status === 'sent' ? 'badge-success' : 'badge-danger'}`}>
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-slate-400 text-sm text-center py-4">No alerts sent yet</p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Principal Dashboard — Routes tree
// ═══════════════════════════════════════════════════════════════════════

export default function PrincipalDashboard() {
  return (
    <DashboardLayout>
      <Routes>
        <Route path="dashboard"   element={<PrincipalOverview />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="reports"     element={<CollegeReportsPage />} />
        <Route path="alerts"      element={<PrincipalAlertsPage />} />
        <Route path="audit"       element={<PrincipalAuditPage />} />
        <Route path="*"           element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardLayout>
  );
}
