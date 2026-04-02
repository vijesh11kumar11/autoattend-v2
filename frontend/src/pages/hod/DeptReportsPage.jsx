/**
 * DeptReportsPage — HOD reports hub
 *
 * SECTION 1: Four download cards
 *   1. Student Attendance PDF
 *   2. Class Session PDF
 *   3. Defaulters PDF
 *   4. Monthly Excel Matrix
 *
 * SECTION 2: Live Defaulters Table
 *   Filterable by subject / threshold / status
 *   Colour-coded % column
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/axios';

// ── helpers ───────────────────────────────────────────────────────────
const THRESHOLD_DEFAULT = 75;

function pctColor(pct, threshold) {
  if (pct >= threshold)            return 'text-emerald-600';
  if (pct >= threshold - 10)       return 'text-amber-500';
  if (pct >= threshold - 25)       return 'text-red-500';
  return 'text-red-700 font-extrabold';
}

function statusBadge(st) {
  switch (st) {
    case 'warning':  return <span className="badge badge-warning">WARNING</span>;
    case 'critical': return <span className="badge badge-danger">CRITICAL</span>;
    case 'detained': return <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-700 text-white">DETAINED</span>;
    default:         return <span className="badge badge-success">SAFE</span>;
  }
}

// Trigger a browser file-download from a blob response
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── shared select component ───────────────────────────────────────────
function Select({ value, onChange, children, disabled, className = '' }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={`input-field text-sm py-1.5 ${className}`}
    >
      {children}
    </select>
  );
}

// ── Download buttons with loading state ──────────────────────────────
function DownloadBtn({ onClick, loading, label, icon, type = 'pdf' }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg
                  transition disabled:opacity-50
                  ${type === 'excel'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'}`}
    >
      {loading
        ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        : <span>{icon}</span>}
      {loading ? 'Generating…' : label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Report Card 1 — Student Attendance PDF
// ═══════════════════════════════════════════════════════════════════════
function StudentReportCard({ students }) {
  const [studentId, setStudentId] = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  async function download() {
    if (!studentId) { setError('Select a student first.'); return; }
    setError(''); setLoading(true);
    try {
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      const res = await api.get(`/reports/student/${studentId}/pdf`,
        { params, responseType: 'blob' });
      const stu = students.find(s => s.id === +studentId);
      downloadBlob(res.data, `attendance_${stu?.roll_number || studentId}.pdf`);
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">📄</span>
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">Student Attendance Report</h3>
          <p className="text-xs text-slate-400">Full subject-wise PDF for one student</p>
        </div>
      </div>
      <Select value={studentId} onChange={setStudentId}>
        <option value="">Select student…</option>
        {students.map(s => (
          <option key={s.id} value={s.id}>{s.roll_number} — {s.name}</option>
        ))}
      </Select>
      <div className="flex gap-2">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
               className="input-field text-sm py-1.5 flex-1" />
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}
               className="input-field text-sm py-1.5 flex-1" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <DownloadBtn onClick={download} loading={loading} label="Download PDF" icon="⬇️" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Report Card 2 — Class Session PDF
// ═══════════════════════════════════════════════════════════════════════
function ClassSessionCard({ subjects }) {
  const [subjectId,  setSubjectId]  = useState('');
  const [sessions,   setSessions]   = useState([]);
  const [sessionId,  setSessionId]  = useState('');
  const [loadingSess, setLoadingSess] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  async function loadSessions(sid) {
    setSubjectId(sid); setSessionId(''); setSessions([]);
    if (!sid) return;
    setLoadingSess(true);
    try {
      const { data } = await api.get('/reports/hod/sessions', { params: { subject_id: sid } });
      setSessions(data);
    } finally {
      setLoadingSess(false);
    }
  }

  async function download() {
    if (!sessionId) { setError('Select a session first.'); return; }
    setError(''); setLoading(true);
    try {
      const res = await api.get(`/reports/class/${sessionId}/pdf`, { responseType: 'blob' });
      downloadBlob(res.data, `session_${sessionId}.pdf`);
    } catch {
      setError('Download failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🗓️</span>
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">Class Session Report</h3>
          <p className="text-xs text-slate-400">Roll-call PDF for a specific session</p>
        </div>
      </div>
      <Select value={subjectId} onChange={loadSessions} disabled={loadingSess}>
        <option value="">Select subject…</option>
        {subjects.map(s => (
          <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
        ))}
      </Select>
      <Select value={sessionId} onChange={setSessionId} disabled={!sessions.length}>
        <option value="">
          {loadingSess ? 'Loading…' : sessions.length ? 'Select session…' : 'No sessions'}
        </option>
        {sessions.map(s => (
          <option key={s.id} value={s.id}>
            {s.date} — {s.present}/{s.total} present
          </option>
        ))}
      </Select>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <DownloadBtn onClick={download} loading={loading} label="Download PDF" icon="⬇️" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Report Card 3 — Defaulters PDF
// ═══════════════════════════════════════════════════════════════════════
function DefaultersPDFCard({ subjects }) {
  const semesters = [...new Set(subjects.map(s => s.semester).filter(Boolean))].sort();
  const courses   = [...new Map(subjects.map(s => [s.course_name, s])).values()];

  const [courseId,   setCourseId]   = useState('');
  const [semester,   setSemester]   = useState('');
  const [threshold,  setThreshold]  = useState(THRESHOLD_DEFAULT);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  // Map course_name back to course_id — subjects have course_name but not course_id directly.
  // We'll pass course_id as query param; subjects already filtered by dept.
  async function download() {
    setError(''); setLoading(true);
    try {
      const params = { threshold };
      if (courseId) params.course_id = courseId;
      if (semester) params.semester  = semester;
      const res = await api.get('/reports/defaulters/pdf', { params, responseType: 'blob' });
      downloadBlob(res.data, 'defaulters_report.pdf');
    } catch {
      setError('Download failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">⚠️</span>
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">Defaulters Report</h3>
          <p className="text-xs text-slate-400">Students below threshold — PDF</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Select value={semester} onChange={setSemester} className="flex-1">
          <option value="">All semesters</option>
          {semesters.map(s => <option key={s} value={s}>Semester {s}</option>)}
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500 whitespace-nowrap">Threshold %</label>
        <input
          type="number" min={0} max={100} step={5}
          value={threshold}
          onChange={e => setThreshold(+e.target.value)}
          className="input-field text-sm py-1.5 w-20"
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <DownloadBtn onClick={download} loading={loading} label="Download PDF" icon="⬇️" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Report Card 4 — Monthly Excel Matrix
// ═══════════════════════════════════════════════════════════════════════
function MonthlyExcelCard({ subjects }) {
  const now = new Date();
  const [subjectId, setSubjectId] = useState('');
  const [year,      setYear]      = useState(now.getFullYear());
  const [month,     setMonth]     = useState(now.getMonth() + 1);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  async function download() {
    if (!subjectId) { setError('Select a subject first.'); return; }
    setError(''); setLoading(true);
    try {
      const res = await api.get(`/reports/monthly/${subjectId}/excel`,
        { params: { year, month }, responseType: 'blob' });
      const subj = subjects.find(s => s.id === +subjectId);
      downloadBlob(res.data, `attendance_${subj?.code || subjectId}_${year}_${String(month).padStart(2,'0')}.xlsx`);
    } catch {
      setError('Download failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">📊</span>
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">Monthly Excel Matrix</h3>
          <p className="text-xs text-slate-400">Per-student daily matrix for a subject</p>
        </div>
      </div>
      <Select value={subjectId} onChange={setSubjectId}>
        <option value="">Select subject…</option>
        {subjects.map(s => (
          <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
        ))}
      </Select>
      <div className="flex gap-2">
        <Select value={month} onChange={v => setMonth(+v)} className="flex-1">
          {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
        </Select>
        <input type="number" value={year} min={2020} max={2040}
               onChange={e => setYear(+e.target.value)}
               className="input-field text-sm py-1.5 w-24" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <DownloadBtn onClick={download} loading={loading} label="Download Excel"
                   icon="⬇️" type="excel" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Live Defaulters Table
// ═══════════════════════════════════════════════════════════════════════
function DefaultersTable({ subjects }) {
  const [rows,       setRows]      = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [error,      setError]     = useState('');
  const [subjectId,  setSubjectId] = useState('');
  const [threshold,  setThreshold] = useState(THRESHOLD_DEFAULT);
  const [statusFilt, setStatusFilt]= useState('');
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = { threshold };
    if (subjectId)  params.subject_id = subjectId;
    if (statusFilt) params.status     = statusFilt;
    api.get('/reports/hod/defaulters', { params })
      .then(r => { if (isMounted.current) setRows(r.data); })
      .catch(() => { if (isMounted.current) setError('Failed to load defaulters.'); })
      .finally(() => { if (isMounted.current) setLoading(false); });
  }, [subjectId, threshold, statusFilt]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700 mr-auto">Live Defaulters List</h3>

        <Select value={subjectId} onChange={setSubjectId} className="w-48">
          <option value="">All subjects</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </Select>

        <Select value={statusFilt} onChange={setStatusFilt} className="w-32">
          <option value="">All status</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
          <option value="detained">Detained</option>
        </Select>

        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400">Threshold %</label>
          <input type="number" value={threshold} min={0} max={100} step={5}
                 onChange={e => setThreshold(+e.target.value)}
                 className="input-field text-sm py-1 w-16" />
        </div>

        <button onClick={load} className="btn-secondary text-xs px-3 py-1.5">↻ Refresh</button>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="p-8 text-center">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-slate-400 text-sm">
          No defaulters found for current filters. 🎉
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Roll No', 'Student', 'Subject', 'Attendance %', 'Sessions', 'Status', 'Notified'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.roll_number}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.student_name}</td>
                  <td className="px-4 py-2.5">
                    <p className="text-slate-700">{r.subject_name}</p>
                    <p className="text-xs text-slate-400 font-mono">{r.subject_code}</p>
                  </td>
                  <td className={`px-4 py-2.5 font-bold ${pctColor(r.percentage, threshold)}`}>
                    {r.percentage}%
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {r.present}/{r.total_sessions}
                  </td>
                  <td className="px-4 py-2.5">{statusBadge(r.status)}</td>
                  <td className="px-4 py-2.5 text-center">
                    {r.parent_notified
                      ? <span className="text-emerald-500 text-sm">✓</span>
                      : <span className="text-slate-300 text-sm">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-400">
            {rows.length} student{rows.length !== 1 ? 's' : ''} below {threshold}% threshold
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Page root
// ═══════════════════════════════════════════════════════════════════════
export default function DeptReportsPage() {
  const [students, setStudents] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [initLoading, setInitLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/reports/hod/students'),
      api.get('/reports/hod/subjects'),
    ])
      .then(([s, sub]) => { setStudents(s.data); setSubjects(sub.data); })
      .finally(() => setInitLoading(false));
  }, []);

  if (initLoading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-base font-bold text-slate-700">Department Reports</h2>

      {/* Download cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StudentReportCard students={students} />
        <ClassSessionCard  subjects={subjects} />
        <DefaultersPDFCard subjects={subjects} />
        <MonthlyExcelCard  subjects={subjects} />
      </div>

      {/* Live defaulters table */}
      <DefaultersTable subjects={subjects} />
    </div>
  );
}
