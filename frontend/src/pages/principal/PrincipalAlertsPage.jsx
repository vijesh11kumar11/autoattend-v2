/**
 * TRACELN v2.0 — Principal: Alerts Page
 *
 * Features:
 *  • Defaulters list with checkboxes (individual + bulk selection)
 *  • "Send WhatsApp alert to parents" (individual row + bulk button)
 *  • Alert history log table
 *
 * API:
 *   GET  /api/principal/alerts
 *   POST /api/principal/send-alert  { student_ids: [], message: "" }
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const DEFAULT_MSG =
  "Dear Parent, your ward's attendance is below 75%. Please take necessary action.";

export default function PrincipalAlertsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get('/principal/alerts')
      .then((r) => setData(r.data))
      .catch(() => setError('Failed to load alerts data.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data) return;
    const allIds = data.defaulters.map((d) => d.student_id);
    setSelected(selected.size === allIds.length ? new Set() : new Set(allIds));
  };

  const sendAlerts = async (studentIds) => {
    if (!studentIds.length) return;
    if (!message.trim()) {
      alert('Message cannot be empty.');
      return;
    }

    setSending(true);
    setSendResult(null);
    try {
      const r = await api.post('/principal/send-alert', { student_ids: studentIds, message });
      setSendResult(r.data);
      setSelected(new Set());
      // Reload to reflect updated history
      setTimeout(load, 800);
    } catch {
      setSendResult({ error: 'Failed to send alerts. Please try again.' });
    } finally {
      setSending(false);
    }
  };

  if (loading)
    return <div className="p-8 text-slate-400 text-sm animate-pulse">Loading alerts…</div>;
  if (error) return <div className="p-8 text-red-500 text-sm">{error}</div>;

  const defaulters = data?.defaulters || [];
  const alertHistory = data?.alert_history || [];
  const selectedArray = [...selected];

  return (
    <div className="space-y-6">
      {/* ── Bulk message composer ── */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Alert Message</h3>
        <textarea
          className="input w-full text-sm resize-none"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={800}
          placeholder="Type the alert message to send to parents…"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="btn-primary text-sm"
            disabled={sending || selected.size === 0}
            onClick={() => sendAlerts(selectedArray)}
          >
            {sending ? 'Sending…' : `📤 Send to ${selected.size} selected`}
          </button>
          <button
            className="btn-secondary text-sm"
            disabled={sending || defaulters.length === 0}
            onClick={() => sendAlerts(defaulters.map((d) => d.student_id))}
          >
            📢 Send to ALL defaulters ({defaulters.length})
          </button>
          {sendResult && !sendResult.error && (
            <span className="text-emerald-600 text-xs font-medium">
              ✓ Sent: {sendResult.sent} | Failed: {sendResult.failed}
            </span>
          )}
          {sendResult?.error && <span className="text-red-500 text-xs">{sendResult.error}</span>}
        </div>
      </div>

      {/* ── Defaulters table ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            Defaulters (&lt; 75% attendance) — {defaulters.length} student
            {defaulters.length !== 1 ? 's' : ''}
          </h3>
          {defaulters.length > 0 && (
            <button className="text-xs text-blue-600 hover:underline" onClick={toggleAll}>
              {selected.size === defaulters.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>

        {defaulters.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            No defaulters found — great attendance!
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-4 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === defaulters.length && defaulters.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                {[
                  'Name',
                  'Roll No.',
                  'Attendance',
                  'Present / Total',
                  'Parent Phone',
                  'Action',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {defaulters.map((d) => (
                <tr
                  key={d.student_id}
                  className={`hover:bg-slate-50 transition-colors ${selected.has(d.student_id) ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(d.student_id)}
                      onChange={() => toggleOne(d.student_id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{d.name}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">
                    {d.roll_number || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`font-bold ${d.pct < 60 ? 'text-red-600' : 'text-amber-500'}`}>
                      {d.pct}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {d.present} / {d.total}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">
                    {d.parent_phone || <span className="text-slate-300">No phone</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                      disabled={sending || !d.parent_phone}
                      onClick={() => sendAlerts([d.student_id])}
                    >
                      Send alert
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Alert history ── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Alert History</h3>
        </div>
        {alertHistory.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No alerts sent yet.</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Student', 'Message', 'Channel', 'Status', 'Sent At'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {alertHistory.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{a.student_name}</td>
                  <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{a.message}</td>
                  <td className="px-4 py-2.5 text-slate-500 capitalize">{a.channel}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`badge ${a.status === 'sent' ? 'badge-success' : 'badge-danger'}`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">
                    {new Date(a.sent_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
