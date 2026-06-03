/**
 * AutoAttend AI v2.0 — Leave Requests Page (Teacher / HOD)
 *
 * Tabs: Pending | Approved | Rejected | All
 * Each request card: student info, dates, reason, leave type badge
 * Approve/Reject with note, shows attendance impact preview
 */

import { useCallback, useEffect, useState } from 'react';
import api from '../../api/axios';

const TABS = [
  { key: 'pending', label: '⏳ Pending' },
  { key: 'approved', label: '✅ Approved' },
  { key: 'rejected', label: '❌ Rejected' },
  { key: 'all', label: '📋 All' },
];

const LEAVE_TYPE_STYLE = {
  medical: 'bg-blue-100 text-blue-700',
  duty: 'bg-purple-100 text-purple-700',
  personal: 'bg-slate-100 text-slate-700',
  emergency: 'bg-red-100 text-red-700',
  sports: 'bg-amber-100 text-amber-700',
  other: 'bg-gray-100 text-gray-600',
};

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

function LeaveCard({ lr, onAction, showActions }) {
  const [note, setNote] = useState('');
  const [impact, setImpact] = useState(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [acting, setActing] = useState('');

  const fetchImpact = useCallback(() => {
    if (impact !== null || lr.status !== 'pending') return;
    setLoadingImpact(true);
    api
      .get(`/leave/attendance-impact/${lr.id}`)
      .then((r) => setImpact(r.data))
      .catch(() => {})
      .finally(() => setLoadingImpact(false));
  }, [lr.id, lr.status, impact]);

  useEffect(() => {
    if (showActions && lr.status === 'pending') fetchImpact();
  }, [showActions, lr.status, fetchImpact]);

  const handleAction = async (action) => {
    setActing(action);
    try {
      await onAction(lr.id, action, note);
    } finally {
      setActing('');
    }
  };

  return (
    <div className="card p-5 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800">{lr.student_name}</p>
          <p className="text-xs text-slate-400 font-mono">{lr.student_roll}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEAVE_TYPE_STYLE[lr.leave_type] || ''}`}
          >
            {lr.leave_type}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[lr.status] || ''}`}
          >
            {lr.status}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-slate-400 uppercase font-semibold">Dates</p>
          <p className="text-slate-700">
            {lr.from_date} → {lr.to_date}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase font-semibold">Days</p>
          <p className="text-slate-700 font-bold">{lr.days}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase font-semibold">Applied</p>
          <p className="text-slate-500 text-xs">{lr.created_at?.slice(0, 10)}</p>
        </div>
      </div>

      {/* Reason */}
      <div>
        <p className="text-xs text-slate-400 uppercase font-semibold mb-1">Reason</p>
        <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg">{lr.reason}</p>
      </div>

      {/* Document */}
      {lr.document_url && (
        <a
          href={lr.document_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline"
        >
          📎 View attached document
        </a>
      )}

      {/* Attendance impact */}
      {showActions && lr.status === 'pending' && (
        <div className="text-xs text-slate-500 bg-blue-50 px-3 py-2 rounded-lg">
          {loadingImpact
            ? '⏳ Checking attendance impact…'
            : impact
              ? impact.records_affected > 0
                ? `⚡ Approving will update ${impact.records_affected} absent attendance record(s) to ${lr.leave_type === 'medical' ? 'medical_leave' : lr.leave_type === 'duty' || lr.leave_type === 'sports' ? 'duty_leave' : 'no change (personal/other/emergency)'}.`
                : impact.note || 'No attendance records will be affected.'
              : 'Could not load impact preview.'}
        </div>
      )}

      {/* Tutor note (for reviewed requests) */}
      {lr.tutor_note && lr.status !== 'pending' && (
        <div className="text-sm">
          <span className="text-xs text-slate-400 uppercase font-semibold">Reviewer Note: </span>
          <span className="text-slate-600 italic">"{lr.tutor_note}"</span>
          {lr.reviewer_name && (
            <span className="text-xs text-slate-400 ml-2">— {lr.reviewer_name}</span>
          )}
        </div>
      )}

      {/* Attendance updated badge */}
      {lr.attendance_updated && (
        <div className="text-xs text-emerald-600 font-medium">✅ Attendance records updated</div>
      )}

      {/* Actions */}
      {showActions && lr.status === 'pending' && (
        <div className="space-y-3 border-t pt-3">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)…"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e]"
            maxLength={1000}
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleAction('approve')}
              disabled={!!acting}
              className="flex-1 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm"
            >
              {acting === 'approve' ? '⏳ Approving…' : '✅ Approve'}
            </button>
            <button
              onClick={() => handleAction('reject')}
              disabled={!!acting}
              className="flex-1 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm"
            >
              {acting === 'reject' ? '⏳ Rejecting…' : '❌ Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeaveRequestsPage() {
  const [tab, setTab] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState('');
  const [summary, setSummary] = useState(null);

  // Load requests based on tab
  const loadRequests = useCallback(() => {
    setLoading(true);
    const endpoint = tab === 'pending' ? '/leave/pending' : '/leave/history';
    const params = tab !== 'pending' && tab !== 'all' ? { status: tab } : {};
    api
      .get(endpoint, { params })
      .then((r) => setRequests(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Load summary on mount
  useEffect(() => {
    api
      .get('/leave/summary')
      .then((r) => setSummary(r.data))
      .catch(() => {});
  }, []);

  const handleAction = async (leaveId, action, note) => {
    try {
      const { data } = await api.post(`/leave/${leaveId}/${action}`, { note: note || null });
      if (action === 'approve' && data.attendance_records_updated) {
        setFlash(
          `Leave approved. ${data.attendance_records_updated} attendance record(s) updated.`
        );
      } else if (action === 'approve') {
        setFlash('Leave approved.');
      } else {
        setFlash('Leave rejected.');
      }
      loadRequests();
      // Refresh summary
      api
        .get('/leave/summary')
        .then((r) => setSummary(r.data))
        .catch(() => {});
    } catch (err) {
      setFlash(err.response?.data?.detail || `Failed to ${action}.`);
    }
  };

  return (
    <div className="space-y-6">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="card bg-gradient-to-r from-[#1a237e] to-[#283593] p-6 text-white">
        <h1 className="text-xl font-bold">Leave Requests</h1>
        <p className="text-blue-200 text-sm mt-1">Review and manage student leave applications</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-amber-500">{summary.total_pending}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{summary.total_approved}</p>
            <p className="text-xs text-slate-500">Approved</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-red-500">{summary.total_rejected}</p>
            <p className="text-xs text-slate-500">Rejected</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-slate-800">
              {(summary.total_pending || 0) +
                (summary.total_approved || 0) +
                (summary.total_rejected || 0)}
            </p>
            <p className="text-xs text-slate-500">Total</p>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex rounded-lg bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-sm font-medium py-2 rounded-md transition ${
              tab === t.key ? 'bg-white text-[#1a237e] shadow-sm' : 'text-slate-500'
            }`}
          >
            {t.label}
            {t.key === 'pending' && summary?.total_pending > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {summary.total_pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="card p-10 text-center">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-sm mt-3">Loading…</p>
        </div>
      ) : requests.length > 0 ? (
        <div className="space-y-4">
          {requests.map((lr) => (
            <LeaveCard
              key={lr.id}
              lr={lr}
              onAction={handleAction}
              showActions={tab === 'pending'}
            />
          ))}
        </div>
      ) : (
        <div className="card p-8 text-center text-slate-400">
          <span className="text-3xl block mb-2">📭</span>
          <p>No {tab === 'all' ? '' : tab + ' '}leave requests.</p>
        </div>
      )}
    </div>
  );
}
