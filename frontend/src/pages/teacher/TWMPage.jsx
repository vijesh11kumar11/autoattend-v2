/**
 * AutoAttend AI v2.0 — TWM (Tutor Ward Meeting) Page
 *
 * Tabs:
 *   Meeting  — Start/manage active TWM session (mark attendance)
 *   Ward Report — Combined attendance from ALL subjects for each ward student
 *   History  — Past TWM sessions
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/axios';

const STATUS_COLORS = {
  safe:     'bg-emerald-100 text-emerald-700',
  warning:  'bg-amber-100 text-amber-700',
  critical: 'bg-orange-100 text-orange-700',
  detained: 'bg-red-100 text-red-700',
};

const TABS = [
  { key: 'meeting', label: '📋 Meeting', },
  { key: 'report',  label: '📊 Ward Report', },
  { key: 'history', label: '📜 History', },
];

// ── Student Card for active session ──────────────────────────────
function StudentCard({ student, onToggle, onNote, disabled }) {
  const isPresent = student.status === 'present' || student.status === 'late';
  return (
    <div className={`card p-4 border-2 transition-all ${
      isPresent ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-700 text-sm truncate">{student.name}</p>
          <p className="text-xs text-slate-400 font-mono">{student.roll_number}</p>
        </div>
        <button
          onClick={() => onToggle(student.student_id, isPresent ? 'absent' : 'present')}
          disabled={disabled}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            isPresent
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
          } disabled:opacity-50`}
        >
          {isPresent ? '✅ Present' : '❌ Absent'}
        </button>
      </div>
      {/* Note input */}
      <input
        type="text"
        placeholder="Add note..."
        value={student.note || ''}
        onChange={e => onNote(student.student_id, e.target.value)}
        disabled={disabled}
        className="mt-2 w-full text-xs px-2 py-1.5 border border-slate-200 rounded-lg
                   focus:outline-none focus:border-[#1a237e] disabled:bg-slate-50"
        maxLength={255}
      />
    </div>
  );
}

// ── Ward Report Row ───────────────────────────────────────────────
function WardStudentRow({ student, selected, onSelect }) {
  const meta = STATUS_COLORS[student.attendance_status] || STATUS_COLORS.safe;
  return (
    <div className={`card p-4 border-l-4 ${
      student.needs_attention ? 'border-l-red-500' : 'border-l-emerald-500'
    }`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-3 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(student.student_id)}
            className="w-4 h-4 accent-[#1a237e]"
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-700 text-sm truncate">{student.name}</p>
            <p className="text-xs text-slate-400">{student.roll_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-lg font-bold ${student.overall_pct >= 75 ? 'text-emerald-600' : student.overall_pct >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
            {student.overall_pct}%
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta}`}>
            {student.attendance_status}
          </span>
        </div>
      </div>
      {/* Per-subject breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-2">
        {(student.subjects || student.per_subject || []).map(subj => (
          <div key={subj.subject_id} className={`text-xs px-2 py-1.5 rounded-lg border ${
            subj.pct >= 75 ? 'bg-emerald-50 border-emerald-200' :
            subj.pct >= 60 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
          }`}>
            <span className="font-medium">{subj.subject_code}</span>
            <span className="ml-1 font-bold">{subj.pct}%</span>
            <span className="text-slate-400 ml-1">({subj.present}/{subj.total})</span>
          </div>
        ))}
      </div>
    </div>
  );
}


export default function TWMPage() {
  const [tab, setTab] = useState('meeting');

  // ── Dashboard data ──
  const [dashboard, setDashboard] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);

  // ── Active session ──
  const [sessionId, setSessionId] = useState(null);
  const [students, setStudents] = useState([]);      // active session students
  const [notes, setNotes] = useState({});             // student_id → note
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [flash, setFlash] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');

  // ── Ward report ──
  const [wardReport, setWardReport] = useState([]);
  const [wardLoading, setWardLoading] = useState(false);
  const [selectedForReport, setSelectedForReport] = useState(new Set());
  const [sendingReport, setSendingReport] = useState(false);

  // ── History ──
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedSession, setExpandedSession] = useState(null);
  const [sessionReport, setSessionReport] = useState(null);

  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  // ── Load dashboard ──
  const loadDashboard = useCallback(() => {
    const params = academicYear ? { academic_year: academicYear } : {};
    api.get('/twm/dashboard', { params })
      .then(r => {
        if (!isMounted.current) return;
        setDashboard(r.data);
        if (r.data.academic_year && !academicYear) {
          setAcademicYear(r.data.academic_year);
        }
      })
      .catch(() => {})
      .finally(() => { if (isMounted.current) setDashLoading(false); });
  }, [academicYear]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // ── Start TWM session ──
  const handleStart = async () => {
    if (!academicYear) { setFlash('Please enter academic year.'); return; }
    setStarting(true);
    try {
      const today = new Date().toLocaleDateString('en-CA');
      const { data } = await api.post('/twm/start', {
        date: today,
        notes: meetingNotes || null,
        academic_year: academicYear,
      });
      setSessionId(data.session_id);
      setStudents(data.ward_students.map(s => ({ ...s, note: '' })));
      setFlash(`TWM session started — ${data.total} students enrolled.`);
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to start session.');
    } finally { setStarting(false); }
  };

  // ── Toggle student attendance ──
  const toggleStudent = async (studentId, newStatus) => {
    if (!sessionId) return;
    try {
      await api.put(`/twm/${sessionId}/mark-student`, {
        student_id: studentId,
        status: newStatus,
        note: notes[studentId] || null,
      });
      setStudents(prev => prev.map(s =>
        s.student_id === studentId ? { ...s, status: newStatus } : s
      ));
    } catch { /* silent */ }
  };

  // ── Update local note ──
  const updateNote = (studentId, note) => {
    setNotes(prev => ({ ...prev, [studentId]: note }));
    setStudents(prev => prev.map(s =>
      s.student_id === studentId ? { ...s, note } : s
    ));
  };

  // ── Mark all present ──
  const markAllPresent = async () => {
    if (!sessionId) return;
    try {
      await api.post(`/twm/${sessionId}/mark-all-present`);
      setStudents(prev => prev.map(s => ({ ...s, status: 'present' })));
      setFlash('All students marked present.');
    } catch { setFlash('Failed to mark all present.'); }
  };

  // ── End session ──
  const handleEnd = async () => {
    if (!sessionId) return;
    setEnding(true);
    try {
      // Bulk save notes
      const records = students.map(s => ({
        student_id: s.student_id,
        status: s.status,
        note: s.note || null,
      }));
      await api.post(`/twm/${sessionId}/mark-bulk`, { records });
      const { data } = await api.post(`/twm/${sessionId}/end`);
      setFlash(`Session ended: ${data.present}/${data.total} present.`);
      setSessionId(null);
      setStudents([]);
      loadDashboard();
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to end session.');
    } finally { setEnding(false); }
  };

  // ── Load ward report ──
  useEffect(() => {
    if (tab !== 'report' || !academicYear) return;
    setWardLoading(true);
    api.get('/twm/ward-combined-report', { params: { academic_year: academicYear } })
      .then(r => { if (isMounted.current) setWardReport(r.data || []); })
      .catch(() => {})
      .finally(() => { if (isMounted.current) setWardLoading(false); });
  }, [tab, academicYear]);

  // ── Send report to selected students ──
  const handleSendReport = async () => {
    if (!selectedForReport.size) { setFlash('Select students to send report.'); return; }

    // Need a session to attach report to — use most recent
    const recentSession = dashboard?.recent_twm_sessions?.[0];
    if (!recentSession) { setFlash('Start a TWM session first before sending reports.'); return; }

    setSendingReport(true);
    try {
      const { data } = await api.post('/twm/send-report-to-ward', {
        session_id: recentSession.session_id,
        student_ids: [...selectedForReport],
      });
      setFlash(`Report sent to ${data.sent}/${data.total_selected} students.`);
      setSelectedForReport(new Set());
    } catch (err) {
      setFlash(err.response?.data?.detail || 'Failed to send reports.');
    } finally { setSendingReport(false); }
  };

  const toggleReportSelect = (id) => {
    setSelectedForReport(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllForReport = () => {
    if (selectedForReport.size === wardReport.length) {
      setSelectedForReport(new Set());
    } else {
      setSelectedForReport(new Set(wardReport.map(s => s.student_id)));
    }
  };

  // ── Load history ──
  useEffect(() => {
    if (tab !== 'history') return;
    setHistoryLoading(true);
    api.get('/twm/history')
      .then(r => { if (isMounted.current) setHistory(r.data || []); })
      .catch(() => {})
      .finally(() => { if (isMounted.current) setHistoryLoading(false); });
  }, [tab]);

  // ── View session detail ──
  const viewSessionReport = async (sid) => {
    if (expandedSession === sid) { setExpandedSession(null); setSessionReport(null); return; }
    setExpandedSession(sid);
    try {
      const { data } = await api.get(`/twm/session/${sid}/report`);
      setSessionReport(data);
    } catch { setSessionReport(null); }
  };

  // ── Derived counts ──
  const presentCount = students.filter(s => s.status === 'present' || s.status === 'late').length;
  const totalCount = students.length;

  if (dashLoading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading TWM dashboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="card bg-gradient-to-r from-[#1a237e] to-[#283593] p-6 text-white">
        <h1 className="text-xl font-bold">Tutor Ward Meeting (TWM)</h1>
        <p className="text-blue-200 text-sm mt-1">
          {dashboard?.summary?.total_ward || 0} ward students
          {dashboard?.summary?.needs_attention > 0 && (
            <span className="ml-2 text-red-300">· {dashboard.summary.needs_attention} need attention</span>
          )}
        </p>
      </div>

      {/* Summary cards */}
      {dashboard?.summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-slate-800">{dashboard.summary.total_ward}</p>
            <p className="text-xs text-slate-500">Total Wards</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{dashboard.summary.safe}</p>
            <p className="text-xs text-slate-500">Safe</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-amber-500">{dashboard.summary.warning}</p>
            <p className="text-xs text-slate-500">Warning</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-orange-500">{dashboard.summary.critical}</p>
            <p className="text-xs text-slate-500">Critical</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{dashboard.summary.detained}</p>
            <p className="text-xs text-slate-500">Detained</p>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex rounded-lg bg-slate-100 p-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-sm font-medium py-2 rounded-md transition ${
              tab === t.key ? 'bg-white text-[#1a237e] shadow-sm' : 'text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════ MEETING TAB ═══════════════════ */}
      {tab === 'meeting' && (
        <div className="space-y-4">
          {!sessionId ? (
            /* Start Meeting Card */
            <div className="card p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-800">Start New TWM Session</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Academic Year</label>
                  <input
                    type="text"
                    value={academicYear}
                    onChange={e => setAcademicYear(e.target.value)}
                    placeholder="e.g. 2025-26"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e]"
                    maxLength={20}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Meeting Notes (optional)</label>
                  <input
                    type="text"
                    value={meetingNotes}
                    onChange={e => setMeetingNotes(e.target.value)}
                    placeholder="e.g. Mid-sem review"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1a237e]"
                    maxLength={500}
                  />
                </div>
              </div>
              <button
                onClick={handleStart}
                disabled={starting || !academicYear}
                className="px-6 py-3 bg-[#1a237e] text-white font-bold rounded-xl hover:bg-[#283593] disabled:opacity-50 text-lg w-full"
              >
                {starting ? '⏳ Starting…' : '▶ Start TWM Session'}
              </button>
            </div>
          ) : (
            /* Active Session */
            <div className="space-y-4">
              <div className="card p-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="animate-pulse text-red-500">🔴</span>
                    <span className="font-bold text-slate-700">TWM Session #{sessionId}</span>
                  </div>
                  <p className="text-sm text-slate-400 mt-0.5">
                    {presentCount}/{totalCount} present ({totalCount > 0 ? Math.round(presentCount / totalCount * 100) : 0}%)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={markAllPresent}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700"
                  >
                    ✅ Mark All Present
                  </button>
                  <button
                    onClick={handleEnd}
                    disabled={ending}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    {ending ? '⏳ Ending…' : '⏹ End Session'}
                  </button>
                </div>
              </div>

              {/* Student grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {students.map(s => (
                  <StudentCard
                    key={s.student_id}
                    student={s}
                    onToggle={toggleStudent}
                    onNote={updateNote}
                    disabled={false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ WARD REPORT TAB ═══════════════════ */}
      {tab === 'report' && (
        <div className="space-y-4">
          <div className="card p-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-bold text-slate-700">Combined Attendance Report</h2>
              <p className="text-xs text-slate-400">Attendance from all subjects for your ward students · AY: {academicYear}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllForReport}
                className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                {selectedForReport.size === wardReport.length ? 'Deselect All' : 'Select All'}
              </button>
              <button
                onClick={handleSendReport}
                disabled={sendingReport || !selectedForReport.size}
                className="px-4 py-2 bg-[#1a237e] text-white text-sm font-semibold rounded-lg hover:bg-[#283593] disabled:opacity-50"
              >
                {sendingReport ? '⏳ Sending…' : `📤 Send Report (${selectedForReport.size})`}
              </button>
            </div>
          </div>

          {wardLoading ? (
            <div className="card p-8 text-center text-slate-400 text-sm">Loading report…</div>
          ) : wardReport.length > 0 ? (
            <div className="space-y-3">
              {[...wardReport].sort((a, b) => a.overall_pct - b.overall_pct).map(s => (
                <WardStudentRow
                  key={s.student_id}
                  student={s}
                  selected={selectedForReport.has(s.student_id)}
                  onSelect={toggleReportSelect}
                />
              ))}
            </div>
          ) : (
            <div className="card p-8 text-center text-slate-400">
              No ward students found. Check academic year.
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ HISTORY TAB ═══════════════════ */}
      {tab === 'history' && (
        <div className="space-y-3">
          {historyLoading ? (
            <div className="card p-8 text-center text-slate-400 text-sm">Loading history…</div>
          ) : history.length > 0 ? (
            history.map(s => (
              <div key={s.session_id} className="card overflow-hidden">
                <button
                  onClick={() => viewSessionReport(s.session_id)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 text-left"
                >
                  <div>
                    <p className="font-semibold text-slate-700">
                      TWM — {s.date}
                      {s.notes && <span className="text-slate-400 text-sm ml-2">({s.notes})</span>}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                      <span>{s.start_time} {s.end_time ? `– ${s.end_time}` : ''}</span>
                      <span>{s.present}/{s.total} present</span>
                      {s.auto_report_sent && <span className="text-emerald-500">📤 Report sent</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    }`}>{s.status}</span>
                    <span className="text-slate-400">{expandedSession === s.session_id ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Expanded session report */}
                {expandedSession === s.session_id && sessionReport && (
                  <div className="border-t divide-y">
                    {sessionReport.students?.map(st => (
                      <div key={st.student_id} className="px-5 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-700">{st.name}</p>
                          <p className="text-xs text-slate-400">{st.roll_number}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            st.twm_status === 'present' ? 'bg-emerald-100 text-emerald-700' :
                            st.twm_status === 'late'    ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>{st.twm_status}</span>
                          <span className={`text-sm font-bold ${
                            st.overall_pct >= 75 ? 'text-emerald-600' :
                            st.overall_pct >= 60 ? 'text-amber-500' : 'text-red-500'
                          }`}>{st.overall_pct}%</span>
                          {st.twm_note && <span className="text-xs text-slate-400 italic">"{st.twm_note}"</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="card p-8 text-center text-slate-400">
              <span className="text-3xl block mb-2">📭</span>
              <p>No TWM sessions yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
