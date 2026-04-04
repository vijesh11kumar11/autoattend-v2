/**
 * AutoAttend AI v2.0 — Principal: Audit Log Page
 *
 * Three sections:
 *  1. Face Change Log       — who re-enrolled / reset a student's face
 *  2. Failed Attendance Audit — suspicious / failed scan attempts
 *  3. TOTP Flagged Users    — staff with repeated OTP failures
 *
 * API: GET /api/principal/audit?dept_id=&date_from=&date_to=
 */

import { useEffect, useRef, useState } from 'react';
import api from '../../api/axios';

const TABS = ['Face Changes', 'Failed Scans', 'TOTP Failures'];

export default function PrincipalAuditPage() {
  const today   = new Date().toISOString().slice(0, 10);
  const _30ago  = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [departments, setDepartments] = useState([]);
  const [deptId,    setDeptId]    = useState('');
  const [dateFrom,  setDateFrom]  = useState(_30ago);
  const [dateTo,    setDateTo]    = useState(today);
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [activeTab, setActiveTab] = useState(0);

  const abortRef = useRef(null);

  // Load dept list
  useEffect(() => {
    api.get('/principal/stats')
      .then((r) => setDepartments(r.data.departments || []))
      .catch(() => {});
  }, []);

  const fetchAudit = () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError('');
    const params = { date_from: dateFrom, date_to: dateTo };
    if (deptId) params.dept_id = deptId;

    api.get('/principal/audit', { params, signal: ctrl.signal })
      .then((r) => setData(r.data))
      .catch((e) => { if (e?.code !== 'ERR_CANCELED' && !e?.message?.includes('aborted') && !e?.message?.includes('canceled')) setError('Failed to load audit log.'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAudit();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const faceLog    = data?.face_change_log    || [];
  const auditLog   = data?.failed_audit_log   || [];
  const totpUsers  = data?.totp_flagged_users || [];

  const counts = [faceLog.length, auditLog.length, totpUsers.length];

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Department</label>
          <select className="input text-sm" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
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
        <button className="btn-primary text-sm" onClick={fetchAudit} disabled={loading}>
          {loading ? 'Loading…' : 'Apply Filters'}
        </button>
      </div>

      {error && <div className="text-red-500 text-sm p-4">{error}</div>}

      {/* ── Tabs ── */}
      <div className="card overflow-hidden">
        <div className="flex border-b border-slate-200">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-3 text-sm font-medium transition-colors flex items-center gap-2
                ${activeTab === i
                  ? 'border-b-2 border-blue-600 text-blue-600 -mb-px bg-white'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
              {tab}
              {counts[i] > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold
                  ${activeTab === i ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                  {counts[i]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab 0: Face Changes ── */}
        {activeTab === 0 && (
          faceLog.length === 0 ? (
            <EmptyState msg="No face changes recorded in this period." />
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Student', 'Changed By', 'Reason', 'Old Person ID', 'New Person ID', 'Date'].map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {faceLog.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-800">{f.student_name}</Td>
                    <Td>{f.changed_by}</Td>
                    <Td className="max-w-xs truncate">{f.reason || <Muted>—</Muted>}</Td>
                    <Td className="font-mono text-xs text-slate-400">{f.old_person_id?.slice(0, 12) || '—'}…</Td>
                    <Td className="font-mono text-xs text-slate-400">{f.new_person_id?.slice(0, 12) || '—'}…</Td>
                    <Td className="text-slate-400 text-xs">{new Date(f.changed_at).toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* ── Tab 1: Failed Scans ── */}
        {activeTab === 1 && (
          auditLog.length === 0 ? (
            <EmptyState msg="No failed attendance scans in this period." />
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Student', 'Failure Reason', 'Face Conf.', 'GPS (m)', 'Device ID', 'IP', 'Attempt At'].map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {auditLog.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-800">{a.student_name}</Td>
                    <Td className="max-w-[200px] truncate">
                      <span className="badge badge-danger text-xs">{a.failure_reason || '—'}</span>
                    </Td>
                    <Td>{a.face_confidence != null ? `${(a.face_confidence * 100).toFixed(1)}%` : <Muted>—</Muted>}</Td>
                    <Td>{a.gps_distance != null ? `${a.gps_distance.toFixed(0)}m` : <Muted>—</Muted>}</Td>
                    <Td className="font-mono text-xs text-slate-400 max-w-[120px] truncate">
                      {a.device_id || <Muted>—</Muted>}
                    </Td>
                    <Td className="font-mono text-xs text-slate-400">{a.ip || <Muted>—</Muted>}</Td>
                    <Td className="text-slate-400 text-xs">{new Date(a.attempt_at).toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* ── Tab 2: TOTP Failures ── */}
        {activeTab === 2 && (
          totpUsers.length === 0 ? (
            <EmptyState msg="No staff with repeated TOTP failures." />
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Name', 'Role', 'Fail Count', 'Locked Until'].map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {totpUsers.map((u) => (
                  <tr key={u.user_id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-800">{u.name}</Td>
                    <Td className="capitalize text-slate-500">{u.role}</Td>
                    <Td>
                      <span className={`badge ${u.fail_count >= 3 ? 'badge-danger' : 'badge-warning'}`}>
                        {u.fail_count} fail{u.fail_count !== 1 ? 's' : ''}
                      </span>
                    </Td>
                    <Td className="text-slate-400 text-xs">
                      {u.locked_until ? new Date(u.locked_until).toLocaleString() : <Muted>Not locked</Muted>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────
function Th({ children }) {
  return (
    <th className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}

function Muted({ children }) {
  return <span className="text-slate-300">{children}</span>;
}

function EmptyState({ msg }) {
  return (
    <div className="p-10 text-center text-slate-400 text-sm">{msg}</div>
  );
}
