/**
 * AutoAttend AI v2.0 — Principal: College Reports Page
 *
 * Calls GET /api/principal/reports with optional dept_id + date range.
 * Features: filter bar, export CSV, flagged / defaulters per dept.
 */

import { useEffect, useRef, useState } from 'react';
import api from '../../api/axios';

const PCT_COLOR = (pct) => {
  if (pct >= 75) return 'text-emerald-600';
  if (pct >= 60) return 'text-amber-500';
  return 'text-red-500';
};

/* Convert report rows to CSV and trigger browser download */
function downloadCSV(rows, dateFrom, dateTo) {
  const header = ['Department', 'Code', 'Sessions', 'Avg Attendance %', 'Flagged Attempts', 'Defaulters'];
  const csvRows = [
    header.join(','),
    ...rows.map((r) =>
      [r.dept_name, r.dept_code, r.sessions, r.avg_pct, r.flagged_count, r.defaulter_count].join(',')
    ),
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `college-report-${dateFrom}-${dateTo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CollegeReportsPage() {
  // departments list for the dropdown
  const [departments, setDepartments] = useState([]);

  const today   = new Date().toISOString().slice(0, 10);
  const _30ago  = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [deptId,    setDeptId]    = useState('');
  const [dateFrom,  setDateFrom]  = useState(_30ago);
  const [dateTo,    setDateTo]    = useState(today);
  const [report,    setReport]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const abortRef = useRef(null);

  // Load department list for dropdown
  useEffect(() => {
    api.get('/principal/stats')
      .then((r) => setDepartments(r.data.departments || []))
      .catch(() => {});
  }, []);

  const fetchReport = () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError('');
    const params = { date_from: dateFrom, date_to: dateTo };
    if (deptId) params.dept_id = deptId;

    api.get('/principal/reports', { params, signal: ctrl.signal })
      .then((r) => setReport(r.data))
      .catch((e) => { if (e?.code !== 'ERR_CANCELED' && !e?.message?.includes('aborted') && !e?.message?.includes('canceled')) setError('Failed to load report.'); })
      .finally(() => setLoading(false));
  };

  // Auto-fetch on mount
  useEffect(() => {
    fetchReport();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = report?.departments || [];

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Department</label>
          <select
            className="input text-sm"
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">From</label>
          <input className="input text-sm" type="date" value={dateFrom}
                 onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">To</label>
          <input className="input text-sm" type="date" value={dateTo}
                 onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button className="btn-primary text-sm" onClick={fetchReport} disabled={loading}>
          {loading ? 'Loading…' : 'Apply Filters'}
        </button>
        {rows.length > 0 && (
          <button
            className="btn-secondary text-sm ml-auto"
            onClick={() => downloadCSV(rows, dateFrom, dateTo)}
          >
            ⬇️ Export CSV
          </button>
        )}
      </div>

      {error && <div className="text-red-500 text-sm p-4">{error}</div>}

      {/* ── Summary table ── */}
      {rows.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Department', 'Sessions', 'Avg Attendance', 'Flagged', 'Defaulters'].map((h) => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.dept_id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{r.dept_name}</p>
                    <p className="text-xs text-slate-400 font-mono">{r.dept_code}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.sessions}</td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${PCT_COLOR(r.avg_pct)}`}>{r.avg_pct}%</span>
                  </td>
                  <td className="px-4 py-3">
                    {r.flagged_count > 0 ? (
                      <span className="badge badge-danger">{r.flagged_count}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.defaulter_count > 0 ? (
                      <span className="badge badge-danger">{r.defaulter_count}</span>
                    ) : (
                      <span className="text-emerald-600 font-medium">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !loading && (
          <div className="card p-10 text-center text-slate-400 text-sm">
            No report data for selected filters.
          </div>
        )
      )}
    </div>
  );
}

