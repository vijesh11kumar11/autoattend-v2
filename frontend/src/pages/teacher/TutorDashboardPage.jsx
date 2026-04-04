/**
 * AutoAttend AI v2.0 — Teacher Tutor Dashboard
 *
 * • Summary cards: Total wards, Needs Attention, Pending (placeholder)
 * • Searchable student table with color-coded attendance badges
 * • "View Full Report" slide-over panel per student
 * • "Notify Selected" and "Notify All Defaulters" buttons
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const CURRENT_YEAR = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() < 5 ? `${y - 1}-${String(y).slice(-2)}` : `${y}-${String(y + 1).slice(-2)}`;
})();

const BADGE = {
  safe:     'bg-emerald-100 text-emerald-700',
  warning:  'bg-amber-100 text-amber-700',
  critical: 'bg-orange-100 text-orange-700',
  detained: 'bg-red-100 text-red-700',
};

export default function TutorDashboardPage() {
  const [wards, setWards]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [year, setYear]         = useState(CURRENT_YEAR);

  // slide-over
  const [reportStudent, setReportStudent] = useState(null);
  const [report, setReport]               = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  // notify
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showNotify, setShowNotify]   = useState(false);
  const [notifyMsg, setNotifyMsg]     = useState('');
  const [channels, setChannels]       = useState(['push']);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [flash, setFlash]             = useState('');

  // load
  const loadWards = () => {
    setLoading(true);
    api.get('/tutor/my-ward-students', { params: { academic_year: year } })
      .then(r => setWards(r.data || []))
      .catch(() => setError('Failed to load ward students.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadWards(); }, [year]);

  // search filter
  const filtered = wards.filter(w =>
    !search ||
    w.name.toLowerCase().includes(search.toLowerCase()) ||
    (w.roll_number || '').toLowerCase().includes(search.toLowerCase()) ||
    (w.section_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const needsAttention = wards.filter(w => w.needs_attention).length;

  // view full report
  const openReport = async (studentId) => {
    setReportStudent(studentId);
    setReportLoading(true);
    setReport(null);
    try {
      const r = await api.get(`/tutor/ward-student/${studentId}/full-report`, {
        params: { academic_year: year },
      });
      setReport(r.data);
    } catch { setReport(null); }
    finally { setReportLoading(false); }
  };

  // toggle select
  const toggle = (id) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // notify selected
  const openNotifySelected = () => {
    if (selectedIds.size === 0) return;
    setShowNotify(true);
  };

  // notify all defaulters
  const notifyDefaulters = () => {
    const ids = wards.filter(w => w.needs_attention).map(w => w.student_id);
    if (ids.length === 0) { setFlash('No defaulters found.'); return; }
    setSelectedIds(new Set(ids));
    setShowNotify(true);
  };

  const submitNotify = async () => {
    if (!notifyMsg.trim()) return;
    setNotifyLoading(true);
    try {
      const r = await api.post('/tutor/notify-ward', {
        student_ids: [...selectedIds],
        message: notifyMsg,
        channels,
      });
      setFlash(`Sent: ${r.data.sent}, Failed: ${r.data.failed}`);
      setShowNotify(false);
      setNotifyMsg('');
      setSelectedIds(new Set());
    } catch (err) { setFlash(err.response?.data?.detail || 'Notification failed.'); }
    finally { setNotifyLoading(false); }
  };

  const toggleChannel = (ch) => setChannels(prev =>
    prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
  );

  // render
  if (loading) return (
    <div className="card p-10 text-center">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
      <p className="text-slate-400 text-sm mt-3">Loading ward students…</p>
    </div>
  );

  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  if (wards.length === 0) return (
    <div className="card p-10 text-center text-slate-400">
      <p className="text-lg mb-2">📭 No Ward Students</p>
      <p className="text-sm">You have no tutor assignments for {year}.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Summary cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-xs text-slate-400 uppercase mb-1">Total Wards</p>
          <p className="text-2xl font-bold text-[#1a237e]">{wards.length}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-400 uppercase mb-1">Needs Attention</p>
          <p className={`text-2xl font-bold ${needsAttention > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
            {needsAttention}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-400 uppercase mb-1">Academic Year</p>
          <p className="text-2xl font-bold text-slate-600">{year}</p>
        </div>
      </div>

      {/* ── Actions bar ────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <input className="border rounded-lg px-3 py-1.5 text-sm w-64" placeholder="Search name, roll, section…"
               value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-2">
          <button onClick={openNotifySelected} disabled={selectedIds.size === 0}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40">
            📩 Notify Selected ({selectedIds.size})
          </button>
          <button onClick={notifyDefaulters}
                  className="px-4 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">
            ⚠️ Notify All Defaulters
          </button>
        </div>
      </div>

      {/* ── Student table ──────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b">
                <th className="px-4 py-2 w-8">
                  <input type="checkbox"
                         checked={selectedIds.size === filtered.length && filtered.length > 0}
                         onChange={() => setSelectedIds(prev =>
                           prev.size === filtered.length ? new Set() : new Set(filtered.map(w => w.student_id))
                         )} className="rounded border-slate-300" />
                </th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Roll</th>
                <th className="px-4 py-2 text-left">Section</th>
                <th className="px-4 py-2 text-center">Attendance</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(w => (
                <tr key={w.student_id} className={`hover:bg-slate-50 ${w.needs_attention ? 'bg-red-50/30' : ''}`}>
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={selectedIds.has(w.student_id)}
                           onChange={() => toggle(w.student_id)} className="rounded border-slate-300" />
                  </td>
                  <td className="px-4 py-2 text-sm font-medium text-slate-700">{w.name}</td>
                  <td className="px-4 py-2 text-sm font-mono text-slate-500">{w.roll_number || '—'}</td>
                  <td className="px-4 py-2 text-sm text-slate-500">{w.section_name || '—'}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`font-bold text-sm ${w.overall_attendance_pct >= 75 ? 'text-emerald-600' : w.overall_attendance_pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                      {w.overall_attendance_pct}%
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BADGE[w.attendance_label] || BADGE.safe}`}>
                      {w.attendance_label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => openReport(w.student_id)}
                            className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">
                      View Report
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Slide-over: Full Report ────────────────────────────── */}
      {reportStudent && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setReportStudent(null)} />
          <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white px-5 py-4 border-b flex items-center justify-between z-10">
              <h3 className="font-semibold text-slate-700">📋 Full Student Report</h3>
              <button onClick={() => setReportStudent(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            {reportLoading ? (
              <div className="p-10 text-center text-slate-400 text-sm animate-pulse">Loading report…</div>
            ) : report ? (
              <div className="p-5 space-y-5">
                {/* student info */}
                <div className="space-y-1">
                  <p className="text-lg font-bold text-slate-700">{report.name}</p>
                  <p className="text-sm text-slate-400">{report.roll_number} · Section {report.section_name || '—'} · Sem {report.semester}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`text-2xl font-bold ${report.overall_attendance_pct >= 75 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {report.overall_attendance_pct}%
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BADGE[report.attendance_label] || ''}`}>
                      {report.attendance_label}
                    </span>
                  </div>
                </div>

                {/* per-subject */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-600 mb-2">Per-Subject Breakdown</h4>
                  <div className="space-y-2">
                    {(report.per_subject || []).map((s, i) => (
                      <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-slate-700">{s.subject_name}</p>
                          <p className="text-xs text-slate-400">{s.subject_code}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${s.pct >= 75 ? 'text-emerald-600' : s.pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                            {s.pct}%
                          </p>
                          <p className="text-xs text-slate-400">{s.present}/{s.total}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* session history */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-600 mb-2">Last 30 Days History</h4>
                  {(report.session_history_30d || []).length > 0 ? (
                    <div className="max-h-60 overflow-y-auto border rounded-lg">
                      <table className="w-full">
                        <thead>
                          <tr className="text-xs text-slate-400 border-b">
                            <th className="px-3 py-1.5 text-left">Date</th>
                            <th className="px-3 py-1.5 text-left">Subject</th>
                            <th className="px-3 py-1.5 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {report.session_history_30d.map((h, i) => (
                            <tr key={i} className="text-xs">
                              <td className="px-3 py-1.5 text-slate-500">{h.date}</td>
                              <td className="px-3 py-1.5 text-slate-600">{h.subject_name}</td>
                              <td className="px-3 py-1.5 text-center">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium
                                  ${h.status === 'present' || h.status === 'late' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                  {h.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No sessions in the last 30 days.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-10 text-center text-red-400 text-sm">Failed to load report.</div>
            )}
          </div>
        </div>
      )}

      {/* ── Notify modal ───────────────────────────────────────── */}
      {showNotify && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-slate-700">📩 Notify {selectedIds.size} Student(s)</h3>
              <button onClick={() => setShowNotify(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Message</label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-24 resize-none"
                          placeholder="Type your message…"
                          value={notifyMsg} onChange={e => setNotifyMsg(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-2">Channels</label>
                <div className="flex gap-3">
                  {['push', 'whatsapp', 'sms'].map(ch => (
                    <label key={ch} className="flex items-center gap-1.5 text-sm text-slate-600">
                      <input type="checkbox" checked={channels.includes(ch)}
                             onChange={() => toggleChannel(ch)} className="rounded" />
                      {ch === 'push' ? '📱 Push' : ch === 'whatsapp' ? '💬 WhatsApp' : '📨 SMS'}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowNotify(false)}
                        className="px-4 py-2 text-sm text-slate-500">Cancel</button>
                <button onClick={submitNotify} disabled={notifyLoading || !notifyMsg.trim()}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {notifyLoading ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
