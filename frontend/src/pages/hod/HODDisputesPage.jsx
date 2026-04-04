/**
 * HOD DisputesPage — All disputes across department with escalate button.
 * API: GET  /api/hod/disputes/pending
 *      POST /api/hod/disputes/{id}/escalate?action=approve|reject
 */
import { useEffect, useState } from 'react';
import api from '../../api/axios';

const STATUS_STYLE = {
  pending:  'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function HODDisputesPage() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [flash, setFlash]       = useState('');
  const [resolving, setResolving] = useState(null);
  const [action, setAction]       = useState('approve');
  const [note, setNote]           = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadDisputes = () => {
    setLoading(true);
    api.get('/hod/disputes/pending')
      .then(r => setDisputes(r.data || []))
      .catch(() => setError('Failed to load disputes.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDisputes(); }, []);

  const handleResolve = async () => {
    setSubmitting(true);
    try {
      await api.post(
        `/hod/disputes/${resolving}/escalate?action=${action}${note ? `&resolution_note=${encodeURIComponent(note)}` : ''}`
      );
      setFlash(action === 'approve' ? 'Dispute approved — attendance corrected.' : 'Dispute rejected.');
      setResolving(null);
      setNote('');
      loadDisputes();
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to resolve dispute.');
    } finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading disputes…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  const pending = disputes.filter(d => d.status === 'pending');
  const resolved = disputes.filter(d => d.status !== 'pending');

  return (
    <div className="space-y-6">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="card p-5">
        <h2 className="text-lg font-bold text-slate-800">⚖️ Department Attendance Disputes</h2>
        <p className="text-sm text-slate-400 mt-1">
          All disputes across your department. Escalate unresolved disputes that teachers haven't acted on.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{pending.length}</p>
          <p className="text-xs text-slate-400">Pending</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{resolved.filter(d => d.status === 'resolved').length}</p>
          <p className="text-xs text-slate-400">Resolved</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{resolved.filter(d => d.status === 'rejected').length}</p>
          <p className="text-xs text-slate-400">Rejected</p>
        </div>
      </div>

      {/* Disputes Table */}
      {disputes.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">
          <span className="text-3xl block mb-2">✅</span>
          <p>No disputes found in your department.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b">
                <tr>
                  {['Student', 'Subject', 'Teacher', 'Date', 'Reason', 'Status', 'Resolved By', 'Action'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {disputes.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-700">{d.student_name}</p>
                      <p className="text-xs text-slate-400">{d.roll_number}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-sm">{d.subject_name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{d.teacher_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{d.session_date}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{d.reason}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLE[d.status] || 'bg-slate-100 text-slate-500'}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{d.resolved_by || '—'}</td>
                    <td className="px-4 py-3">
                      {d.status === 'pending' ? (
                        <button
                          onClick={() => { setResolving(d.id); setAction('approve'); setNote(''); }}
                          className="text-xs px-3 py-1.5 bg-[#1a237e] text-white rounded-lg hover:bg-[#283593] font-medium"
                        >
                          Escalate
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 italic">{d.resolution_note || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {resolving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="card w-full max-w-md p-6 space-y-4 m-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">Escalate / Resolve Dispute</h3>
              <button onClick={() => setResolving(null)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Decision</label>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setAction('approve')}
                  className={`px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all ${
                    action === 'approve' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                  }`}>
                  ✅ Approve
                </button>
                <button onClick={() => setAction('reject')}
                  className={`px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all ${
                    action === 'reject' ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 text-slate-500'
                  }`}>
                  ❌ Reject
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Resolution Note</label>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder="HOD escalation note…" rows={3} maxLength={500}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e] resize-none" />
            </div>

            {action === 'approve' && (
              <p className="text-xs text-emerald-600 bg-emerald-50 p-2 rounded">
                Approving will mark the student as <strong>present</strong> for this session.
              </p>
            )}

            <button onClick={handleResolve} disabled={submitting}
              className={`w-full py-3 font-bold rounded-xl text-white disabled:opacity-50 ${
                action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
              }`}>
              {submitting ? '⏳ Processing…' : action === 'approve' ? '✅ Approve & Correct' : '❌ Reject Dispute'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
