/**
 * AlertsPage — HOD Alerts hub
 *
 * SECTION 1: Send Bulk WhatsApp Alerts (to all dept defaulters)
 * SECTION 2: Send Custom Alert (single student)
 * SECTION 3: Alert History Table
 *
 * APIs:
 *   GET  /api/alerts/hod/defaulters/count
 *   POST /api/alerts/hod/send-bulk    { message }
 *   GET  /api/reports/hod/students    (for student search)
 *   POST /api/alerts/hod/send-custom  { student_id, message }
 *   GET  /api/alerts/hod/history
 */

import { useCallback, useEffect, useState } from 'react';
import api from '../../api/axios';

// ── Status badge ──────────────────────────────────────────────────────
function StatusBadge({ status }) {
  switch (status) {
    case 'sent':
      return <span className="badge badge-success">Sent</span>;
    case 'failed':
      return <span className="badge badge-danger">Failed</span>;
    case 'pending':
      return <span className="badge badge-warning">Pending</span>;
    default:
      return <span className="badge badge-secondary capitalize">{status}</span>;
  }
}

// ── Confirm dialog ────────────────────────────────────────────────────
function ConfirmDialog({ count, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
        <h3 className="text-base font-bold text-slate-800">Confirm Bulk Alert</h3>
        <p className="text-sm text-slate-600">
          This will send a WhatsApp message to the parents of{' '}
          <span className="font-bold text-red-600">
            {count} student{count !== 1 ? 's' : ''}
          </span>{' '}
          currently below the attendance threshold.
        </p>
        <p className="text-xs text-slate-400">
          This action cannot be undone. Each message is logged in the alert history.
        </p>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel} className="btn-secondary flex-1 text-sm">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn-primary  flex-1 text-sm bg-red-600 hover:bg-red-700"
          >
            Send {count} Alerts
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Progress indicator ────────────────────────────────────────────────
function BulkProgress({ result }) {
  if (!result) return null;
  const { sent, failed, results = [] } = result;
  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50">
      <div className="flex gap-6 text-sm font-semibold">
        <span className="text-emerald-600">✓ Sent: {sent}</span>
        <span className="text-red-500">✗ Failed: {failed}</span>
      </div>
      {results.filter((r) => r.status === 'failed').length > 0 && (
        <div className="max-h-32 overflow-y-auto text-xs text-red-500 space-y-0.5">
          {results
            .filter((r) => r.status === 'failed')
            .map((r, i) => (
              <p key={i}>
                {r.student_name || `Student #${r.student_id}`}: {r.reason || 'Unknown error'}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1 — Bulk Alert
// ═══════════════════════════════════════════════════════════════════════
function BulkAlertSection() {
  const DEFAULT_MSG =
    "Dear Parent, your ward's attendance has fallen below the required threshold. " +
    'Please ensure regular attendance to avoid detention. — TRACELN';

  const [count, setCount] = useState(null);
  const [message, setMessage] = useState(DEFAULT_MSG);
  const [showDlg, setShowDlg] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/alerts/hod/defaulters/count')
      .then((r) => setCount(r.data.count))
      .catch(() => setCount(0));
  }, [result]); // Re-fetch after a bulk send

  async function handleConfirm() {
    setShowDlg(false);
    setResult(null);
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/alerts/hod/send-bulk', { message });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Bulk send failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800">Send Bulk WhatsApp Alerts</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Sends to parents of all students currently below the attendance threshold.
          </p>
        </div>
        {count !== null && (
          <span
            className={`text-sm font-bold px-3 py-1 rounded-full
                           ${count > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
          >
            {count > 0 ? `⚠️ ${count} defaulter${count !== 1 ? 's' : ''}` : '✓ No defaulters'}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <label className="label-text">Message to parents</label>
        <textarea
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1600}
          className="input-field text-sm resize-none"
        />
        <p className="text-xs text-slate-400 text-right">{message.length}/1600</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <BulkProgress result={result} />

      <button
        disabled={loading || !count || count === 0}
        onClick={() => {
          setResult(null);
          setShowDlg(true);
        }}
        className="btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{' '}
            Sending…
          </>
        ) : (
          `📲 Send Bulk Alert to ${count ?? '…'} students`
        )}
      </button>

      {showDlg && (
        <ConfirmDialog count={count} onConfirm={handleConfirm} onCancel={() => setShowDlg(false)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2 — Custom Alert
// ═══════════════════════════════════════════════════════════════════════
function CustomAlertSection({ students }) {
  const [query, setQuery] = useState('');
  const [studentId, setStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const filtered = query.trim()
    ? students
        .filter(
          (s) =>
            s.name.toLowerCase().includes(query.toLowerCase()) ||
            (s.roll_number || '').toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 8)
    : [];

  function selectStudent(s) {
    setStudentId(s.id);
    setQuery(`${s.roll_number} — ${s.name}`);
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!studentId) {
      setError('Select a student first.');
      return;
    }
    if (!message.trim()) {
      setError('Message cannot be empty.');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const { data } = await api.post('/alerts/hod/send-custom', {
        student_id: studentId,
        message: message.trim(),
      });
      setSuccess(
        data.status === 'sent'
          ? `✓ Message sent to ${data.student_name}'s parent.`
          : `Alert logged but delivery failed: ${data.reason}`
      );
      setMessage('');
      setStudentId('');
      setQuery('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Send failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">Send Custom Alert</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Send a personalised WhatsApp to one student's parent.
        </p>
      </div>

      <form onSubmit={handleSend} className="space-y-3">
        {/* Student search */}
        <div className="relative">
          <label className="label-text">Student</label>
          <input
            type="text"
            placeholder="Search by name or roll number…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setStudentId('');
            }}
            className="input-field text-sm"
          />
          {filtered.length > 0 && (
            <div
              className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-xl
                            shadow-lg max-h-48 overflow-y-auto"
            >
              {filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectStudent(s)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50
                             flex justify-between items-center"
                >
                  <span className="font-medium text-slate-800">{s.name}</span>
                  <span className="text-xs text-slate-400 font-mono">{s.roll_number}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message */}
        <div>
          <label className="label-text">Message</label>
          <textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1600}
            placeholder="Type your message…"
            className="input-field text-sm resize-none"
          />
          <p className="text-xs text-slate-400 text-right mt-0.5">{message.length}/1600</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-emerald-600">{success}</p>}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{' '}
              Sending…
            </>
          ) : (
            '📩 Send Alert'
          )}
        </button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3 — Alert History
// ═══════════════════════════════════════════════════════════════════════
function AlertHistorySection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilt, setTypeFilt] = useState('');
  const [statFilt, setStatFilt] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const load = useCallback(() => {
    setLoading(true);
    const params = { limit: 200 };
    if (typeFilt) params.alert_type = typeFilt;
    if (statFilt) params.status = statFilt;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    api
      .get('/alerts/hod/history', { params })
      .then((r) => setRows(r.data))
      .catch(() => setError('Failed to load alert history.'))
      .finally(() => setLoading(false));
  }, [typeFilt, statFilt, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700 mr-auto">Alert History</h3>

        <select
          value={typeFilt}
          onChange={(e) => setTypeFilt(e.target.value)}
          className="input-field text-sm py-1.5 w-36"
        >
          <option value="">All types</option>
          <option value="low_attendance">Low Attendance</option>
          <option value="custom">Custom</option>
        </select>

        <select
          value={statFilt}
          onChange={(e) => setStatFilt(e.target.value)}
          className="input-field text-sm py-1.5 w-28"
        >
          <option value="">All status</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="input-field text-sm py-1.5 w-36"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="input-field text-sm py-1.5 w-36"
        />

        <button onClick={load} className="btn-secondary text-xs px-3 py-1.5">
          ↻ Refresh
        </button>
      </div>

      {error && <div className="px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="p-8 flex justify-center">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-slate-400 text-sm">No alerts found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Date', 'Student', 'Type', 'Channel', 'Status', 'Message Preview'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {formatDate(r.sent_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800 whitespace-nowrap">{r.student_name}</p>
                    <p className="text-xs text-slate-400 font-mono">{r.roll_number}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 capitalize whitespace-nowrap">
                    {r.alert_type.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 capitalize whitespace-nowrap">
                    {r.channel === 'whatsapp' ? '💬 WhatsApp' : r.channel}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 max-w-xs">
                    <p className="text-xs text-slate-500 truncate" title={r.message}>
                      {r.message}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-400">
            {rows.length} record{rows.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Page root
// ═══════════════════════════════════════════════════════════════════════
export default function AlertsPage() {
  const [students, setStudents] = useState([]);
  const [initLoading, setInitLoading] = useState(true);

  useEffect(() => {
    api
      .get('/reports/hod/students')
      .then((r) => setStudents(r.data))
      .finally(() => setInitLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-base font-bold text-slate-700">Alerts &amp; Notifications</h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <BulkAlertSection />
        <CustomAlertSection students={students} />
      </div>

      <AlertHistorySection />
    </div>
  );
}
