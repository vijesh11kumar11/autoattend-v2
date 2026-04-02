/**
 * Teacher — Attendance History Page
 *
 * Shows a list of all past attendance sessions the teacher has conducted.
 * Each row links to a detail view with present/absent breakdown.
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const STATUS_BADGE = {
  active:  'badge-success',
  ended:   'badge-info',
  expired: 'badge-warning',
};

function SessionRow({ s }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (details) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/attendance/session/${s.id}`);
      setDetails(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const pct = s.total_students ? Math.round((s.present_count / s.total_students) * 100) : 0;
  const pctColor = pct >= 75 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500';

  return (
    <>
      <tr className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={toggle}>
        <td className="px-4 py-3 text-sm font-medium text-slate-700">{s.subject_name || s.subject_code}</td>
        <td className="px-4 py-3 text-sm text-slate-500">{s.date}</td>
        <td className="px-4 py-3 text-sm text-slate-500">{s.start_time?.slice(0, 5)}</td>
        <td className="px-4 py-3">
          <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_BADGE[s.status] || 'badge'}`}>
            {s.status}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-slate-500">
          {s.present_count}/{s.total_students}
        </td>
        <td className={`px-4 py-3 text-sm font-bold ${pctColor}`}>{pct}%</td>
        <td className="px-4 py-3 text-slate-400 text-sm">{open ? '▲' : '▼'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-6 py-4">
            {loading ? (
              <p className="text-sm text-slate-400">Loading session details…</p>
            ) : details ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span className="text-slate-500">Total:</span> <strong>{details.total_students}</strong></div>
                <div><span className="text-slate-500">Present:</span> <strong className="text-emerald-600">{details.present_count}</strong></div>
                <div><span className="text-slate-500">Absent:</span> <strong className="text-red-500">{(details.total_students || 0) - (details.present_count || 0)}</strong></div>
                <div><span className="text-slate-500">Status:</span> <strong>{details.status}</strong></div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No details available.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AttendancePage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    api.get('/faculty/my-sessions')
      .then(r => setSessions(r.data?.sessions ?? r.data ?? []))
      .catch(() => setError('Failed to load attendance sessions.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="spinner mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading sessions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center text-red-500">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-700">📋 Attendance History</h2>
        <span className="text-sm text-slate-400">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
      </div>

      {sessions.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          <span className="text-4xl block mb-2">📭</span>
          <p>No attendance sessions found.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Subject</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Date</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Start</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">P/T</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">%</th>
                <th className="px-4 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sessions.map((s) => <SessionRow key={s.id} s={s} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
