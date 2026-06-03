/**
 * CollegeDetailPage — /admin/colleges/:collegeId
 *
 * Rich, read-only usage analytics for a single tenant, sourced from
 * GET /api/admin/colleges/:id/analytics. Purely additive surface; does
 * not alter any existing college-management behaviour.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/axios';

const PLAN_CHIP = {
  trial: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100  text-green-800',
  suspended: 'bg-red-100    text-red-700',
  cancelled: 'bg-slate-200  text-slate-600',
};

const ROLE_LABEL = {
  principal: 'Principals',
  hod: 'HODs',
  teacher: 'Teachers',
  student: 'Students',
};

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function CollegeDetailPage() {
  const { collegeId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data: payload } = await api.get(`/admin/colleges/${collegeId}/analytics`);
        if (active) setData(payload);
      } catch (err) {
        const detail = err?.response?.data?.detail;
        if (active) setError(typeof detail === 'string' ? detail : 'Failed to load analytics.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [collegeId]);

  if (loading) return <div className="p-6 text-slate-500">Loading…</div>;
  if (error)
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <BackLink />
        <div className="mt-4 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      </div>
    );
  if (!data) return null;

  const { college, users, structure, activity, recent_logins: recentLogins } = data;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <BackLink />

      {/* Header */}
      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            {college.name}
            {college.is_deleted && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">
                deleted
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {college.domain || 'no domain'} ·{' '}
            <span className="font-mono text-xs">{college.college_code || '—'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded text-xs font-semibold ${
              PLAN_CHIP[college.plan] || 'bg-slate-100 text-slate-600'
            }`}
          >
            {college.plan}
          </span>
          <span className="px-2.5 py-1 rounded text-xs font-semibold bg-slate-100 text-slate-600">
            {college.status}
          </span>
        </div>
      </header>

      {/* People KPIs */}
      <SectionTitle>People</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Kpi label="Total Users" value={users.total} accent="text-blue-600" />
        <Kpi label="Active" value={users.active} accent="text-emerald-600" />
        <Kpi label="Inactive" value={users.inactive} accent="text-slate-500" />
        {Object.entries(ROLE_LABEL).map(([key, label]) => (
          <Kpi key={key} label={label} value={users.by_role?.[key] ?? 0} accent="text-slate-800" />
        ))}
      </div>

      {/* Academic structure */}
      <SectionTitle>Academic Structure</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Departments" value={structure.departments} accent="text-amber-600" />
        <Kpi label="Courses" value={structure.courses} accent="text-amber-600" />
        <Kpi label="Sections" value={structure.sections} accent="text-amber-600" />
        <Kpi label="Subjects" value={structure.subjects} accent="text-amber-600" />
      </div>

      {/* Attendance activity */}
      <SectionTitle>Attendance Activity</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5 lg:col-span-1">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Attendance Rate
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-600">
            {activity.attendance_rate}%
          </p>
          <div className="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${Math.min(Math.max(activity.attendance_rate, 0), 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500 tabular-nums">
            {activity.attendance_attended} / {activity.attendance_records} marks present
          </p>
        </div>

        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-2 gap-3">
          <Kpi label="Total Sessions" value={activity.attendance_sessions} accent="text-blue-600" />
          <Kpi
            label="Sessions (30d)"
            value={activity.sessions_last_30d}
            accent="text-indigo-600"
          />
          <MetaCard label="Last Session" value={fmtDate(activity.last_session_date)} />
          <MetaCard label="Last Login" value={fmtDateTime(activity.last_user_login)} />
        </div>
      </div>

      {/* Recent logins */}
      <SectionTitle>Recent Logins</SectionTitle>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-left font-semibold">Email</th>
              <th className="px-3 py-2 text-left font-semibold">Role</th>
              <th className="px-3 py-2 text-left font-semibold">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {recentLogins.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{u.name}</td>
                <td className="px-3 py-2 text-slate-600">{u.email}</td>
                <td className="px-3 py-2 text-slate-600 capitalize">{u.role}</td>
                <td className="px-3 py-2 text-slate-500 text-xs">{fmtDateTime(u.last_login)}</td>
              </tr>
            ))}
            {recentLogins.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-8 text-slate-400 text-sm">
                  No logins recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Tenant created {fmtDate(college.created_at)}.
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/colleges"
      className="text-sm text-slate-500 hover:text-amber-600 transition inline-flex items-center gap-1"
    >
      ← Back to Colleges
    </Link>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
      {children}
    </h2>
  );
}

function Kpi({ label, value, accent = 'text-slate-800' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function MetaCard({ label, value }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className="mt-1.5 text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}
