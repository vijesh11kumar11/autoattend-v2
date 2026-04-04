/**
 * AutoAttend AI v2.0 — HOD Tutor Management Page
 *
 * Three tabs:
 *   1. Assignments  — view / filter / delete existing tutor→student mappings
 *   2. Assign       — manual (pick tutor + students), roll range, section, Excel
 *   3. Unassigned   — students with no tutor for the selected year
 *
 * Export Excel button top-right.
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const CURRENT_YEAR = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() < 5 ? `${y - 1}-${String(y).slice(-2)}` : `${y}-${String(y + 1).slice(-2)}`;
})();

const TABS = ['Assignments', 'Assign', 'Unassigned Students'];

const Spinner = () => (
  <div className="p-10 text-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
    <p className="text-slate-400 text-sm mt-3">Loading…</p>
  </div>
);

export default function TutorManagementPage() {
  const [tab, setTab]     = useState(0);
  const [year, setYear]   = useState(CURRENT_YEAR);
  const [msg, setMsg]     = useState('');
  const [msgType, setMsgType] = useState('ok'); // ok | err

  const flash = (text, type = 'ok') => { setMsg(text); setMsgType(type); };

  return (
    <div className="space-y-5">
      {/* banner */}
      {msg && (
        <div className={`card px-5 py-3 text-sm flex items-center justify-between
          ${msgType === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          <span>{msg}</span>
          <button className="opacity-50 hover:opacity-100" onClick={() => setMsg('')}>✕</button>
        </div>
      )}

      {/* header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-slate-700">🎓 Tutor Management</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-500">Year:</label>
          <input className="border rounded-lg px-3 py-1.5 text-sm w-28" value={year}
                 onChange={e => setYear(e.target.value)} placeholder="2025-26" />
          <ExportButton year={year} flash={flash} />
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition
                    ${tab === i ? 'border-[#1a237e] text-[#1a237e]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* tab content */}
      {tab === 0 && <AssignmentsTab year={year} flash={flash} />}
      {tab === 1 && <AssignTab year={year} flash={flash} />}
      {tab === 2 && <UnassignedTab year={year} flash={flash} />}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// Export button
// ═══════════════════════════════════════════════════════════════════════
function ExportButton({ year, flash }) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const r = await api.post(`/tutor/export-assignments-excel?academic_year=${encodeURIComponent(year)}`, null, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a'); a.href = url;
      a.download = `tutor_assignments_${year}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      flash('Excel exported.');
    } catch { flash('Export failed.', 'err'); }
    finally { setLoading(false); }
  };

  return (
    <button onClick={handleExport} disabled={loading}
            className="px-4 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50">
      {loading ? 'Exporting…' : '⬇️ Export Excel'}
    </button>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// Tab 1 — Assignments
// ═══════════════════════════════════════════════════════════════════════
function AssignmentsTab({ year, flash }) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  const load = () => {
    setLoading(true);
    api.get('/tutor/assignments', { params: { academic_year: year } })
      .then(r => setData(r.data || []))
      .catch(() => flash('Failed to load assignments.', 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [year]);

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this tutor assignment?')) return;
    try {
      await api.delete(`/tutor/remove/${id}`);
      flash('Assignment removed.');
      load();
    } catch { flash('Failed to remove.', 'err'); }
  };

  const filtered = data.filter(a =>
    !search ||
    a.tutor_name.toLowerCase().includes(search.toLowerCase()) ||
    a.student_name.toLowerCase().includes(search.toLowerCase()) ||
    (a.student_roll || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.section_name || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <Spinner />;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between flex-wrap gap-3">
        <span className="text-sm text-slate-500">{filtered.length} assignment(s)</span>
        <input className="border rounded-lg px-3 py-1.5 text-sm w-64" placeholder="Search tutor, student, roll…"
               value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {filtered.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b">
                <th className="px-4 py-2 text-left">Tutor</th>
                <th className="px-4 py-2 text-left">Student</th>
                <th className="px-4 py-2 text-left">Roll</th>
                <th className="px-4 py-2 text-left">Section</th>
                <th className="px-4 py-2 text-left">Year</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(a => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-sm text-slate-700">{a.tutor_name}</td>
                  <td className="px-4 py-2 text-sm text-slate-700">{a.student_name}</td>
                  <td className="px-4 py-2 text-sm font-mono text-slate-500">{a.student_roll || '—'}</td>
                  <td className="px-4 py-2 text-sm text-slate-500">{a.section_name || '—'}</td>
                  <td className="px-4 py-2 text-sm text-slate-400">{a.academic_year}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDelete(a.id)}
                            className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-10 text-center text-slate-400 text-sm">No assignments for {year}.</div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// Tab 2 — Assign (4 modes)
// ═══════════════════════════════════════════════════════════════════════
function AssignTab({ year, flash }) {
  const [mode, setMode] = useState('manual'); // manual | roll | section | excel
  const [teachers, setTeachers] = useState([]);
  const [sections, setSections] = useState([]);
  const [students, setStudents] = useState([]);

  // shared
  const [tutorId, setTutorId] = useState('');
  const [note, setNote]       = useState('');
  const [force, setForce]     = useState(false);
  const [loading, setLoading] = useState(false);

  // manual
  const [selectedIds, setSelectedIds] = useState(new Set());

  // roll range
  const [rollStart, setRollStart] = useState('');
  const [rollEnd, setRollEnd]     = useState('');

  // section
  const [sectionId, setSectionId]       = useState('');
  const [skipExisting, setSkipExisting] = useState(true);

  // excel
  const [excelFile, setExcelFile] = useState(null);

  useEffect(() => {
    // Load teacher list
    api.get('/hod/dashboard')
      .then(r => {
        setTeachers(r.data?.teachers || []);
        setStudents(r.data?.students || []);
      })
      .catch(() => {});
    // Load sections
    api.get('/sections').then(r => setSections(r.data || [])).catch(() => {});
  }, []);

  const toggleStudent = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const submitManual = async () => {
    if (!tutorId || selectedIds.size === 0) return;
    setLoading(true);
    try {
      const r = await api.post('/tutor/assign', {
        tutor_id: Number(tutorId), student_ids: [...selectedIds],
        academic_year: year, note: note || null, force,
      });
      const d = r.data;
      let msg = `Assigned ${d.assigned} student(s) to ${d.tutor_name}.`;
      if (d.conflicts?.length) msg += ` ${d.conflicts.length} conflict(s).`;
      flash(msg);
      setSelectedIds(new Set());
    } catch (err) { flash(err.response?.data?.detail || 'Failed.', 'err'); }
    finally { setLoading(false); }
  };

  const submitRollRange = async () => {
    if (!tutorId || !rollStart || !rollEnd) return;
    setLoading(true);
    try {
      const r = await api.post('/tutor/assign-by-roll-range', {
        tutor_id: Number(tutorId), roll_start: rollStart, roll_end: rollEnd,
        academic_year: year, note: note || null, force,
      });
      const d = r.data;
      flash(`Assigned ${d.assigned} student(s).` + (d.conflicts?.length ? ` ${d.conflicts.length} conflict(s).` : ''));
    } catch (err) { flash(err.response?.data?.detail || 'Failed.', 'err'); }
    finally { setLoading(false); }
  };

  const submitSection = async () => {
    if (!tutorId || !sectionId) return;
    setLoading(true);
    try {
      const r = await api.post('/tutor/assign-by-section', {
        tutor_id: Number(tutorId), section_id: Number(sectionId),
        academic_year: year, note: note || null, skip_existing: skipExisting,
      });
      const d = r.data;
      flash(`Assigned ${d.assigned} to ${d.tutor_name} in section ${d.section_name}. ${d.skipped} skipped.`);
    } catch (err) { flash(err.response?.data?.detail || 'Failed.', 'err'); }
    finally { setLoading(false); }
  };

  const submitExcel = async () => {
    if (!excelFile) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', excelFile);
      const r = await api.post('/tutor/import-excel', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const d = r.data;
      flash(`Excel: ${d.success_count} assigned, ${d.skipped_count} skipped, ${d.failed_rows?.length || 0} failed.`);
      setExcelFile(null);
    } catch (err) { flash(err.response?.data?.detail || 'Upload failed.', 'err'); }
    finally { setLoading(false); }
  };

  return (
    <div className="card overflow-hidden">
      {/* mode selector */}
      <div className="px-5 py-3 bg-slate-50 border-b flex items-center gap-3 flex-wrap">
        {['manual', 'roll', 'section', 'excel'].map(m => (
          <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1 text-sm rounded-full transition
                    ${mode === m ? 'bg-[#1a237e] text-white' : 'bg-white text-slate-500 border hover:bg-slate-100'}`}>
            {m === 'manual' ? '👆 Manual' : m === 'roll' ? '🔢 Roll Range' : m === 'section' ? '👥 By Section' : '📄 Excel'}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {/* shared: tutor picker + note */}
        {mode !== 'excel' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Select Tutor</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={tutorId} onChange={e => setTutorId(e.target.value)}>
                <option value="">Choose teacher…</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Note (optional)</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Section A rows 1–30"
                     value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <div className="flex items-end gap-4">
              {mode !== 'section' && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="rounded" />
                  Force reassign
                </label>
              )}
            </div>
          </div>
        )}

        {/* ── Manual mode ──────────────────────────────────────── */}
        {mode === 'manual' && (
          <>
            <div className="border rounded-lg max-h-72 overflow-y-auto p-3 space-y-1">
              {students.length > 0 ? students.map(s => (
                <label key={s.id} className={`flex items-center gap-3 p-1.5 rounded cursor-pointer
                  ${selectedIds.has(s.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={selectedIds.has(s.id)}
                         onChange={() => toggleStudent(s.id)} className="rounded border-slate-300" />
                  <span className="text-sm text-slate-700">{s.name}</span>
                  <span className="text-xs text-slate-400">{s.roll_number || s.email}</span>
                </label>
              )) : <p className="text-sm text-slate-400">No students loaded.</p>}
            </div>
            <button onClick={submitManual} disabled={loading || !tutorId || selectedIds.size === 0}
                    className="px-5 py-2 bg-[#1a237e] text-white text-sm rounded-lg hover:bg-[#283593] disabled:opacity-50">
              {loading ? 'Assigning…' : `Assign ${selectedIds.size} Student(s)`}
            </button>
          </>
        )}

        {/* ── Roll Range mode ──────────────────────────────────── */}
        {mode === 'roll' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Roll Start</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="21CSE001"
                       value={rollStart} onChange={e => setRollStart(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Roll End</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="21CSE030"
                       value={rollEnd} onChange={e => setRollEnd(e.target.value)} />
              </div>
            </div>
            <button onClick={submitRollRange} disabled={loading || !tutorId || !rollStart || !rollEnd}
                    className="px-5 py-2 bg-[#1a237e] text-white text-sm rounded-lg hover:bg-[#283593] disabled:opacity-50">
              {loading ? 'Assigning…' : 'Assign Roll Range'}
            </button>
          </div>
        )}

        {/* ── Section mode ─────────────────────────────────────── */}
        {mode === 'section' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Section</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"
                        value={sectionId} onChange={e => setSectionId(e.target.value)}>
                  <option value="">Choose section…</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>{s.name} — {s.course_name} Sem {s.semester}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={skipExisting} onChange={e => setSkipExisting(e.target.checked)} className="rounded" />
                  Skip already assigned
                </label>
              </div>
            </div>
            <button onClick={submitSection} disabled={loading || !tutorId || !sectionId}
                    className="px-5 py-2 bg-[#1a237e] text-white text-sm rounded-lg hover:bg-[#283593] disabled:opacity-50">
              {loading ? 'Assigning…' : 'Assign Entire Section'}
            </button>
          </div>
        )}

        {/* ── Excel mode ───────────────────────────────────────── */}
        {mode === 'excel' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Upload an Excel file with columns: <code className="bg-slate-100 px-1 rounded">roll_number</code>,{' '}
              <code className="bg-slate-100 px-1 rounded">tutor_email</code>,{' '}
              <code className="bg-slate-100 px-1 rounded">academic_year</code>
            </p>
            <input type="file" accept=".xlsx,.xls" onChange={e => setExcelFile(e.target.files[0])}
                   className="block text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-[#1a237e] file:text-white hover:file:bg-[#283593]" />
            {excelFile && (
              <button onClick={submitExcel} disabled={loading}
                      className="px-5 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {loading ? 'Uploading…' : `Import ${excelFile.name}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// Tab 3 — Unassigned Students
// ═══════════════════════════════════════════════════════════════════════
function UnassignedTab({ year, flash }) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState([]);
  const [tutorId, setTutorId] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [assigning, setAssigning] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/tutor/unassigned-students', { params: { academic_year: year } })
      .then(r => setData(r.data || []))
      .catch(() => flash('Failed to load unassigned students.', 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get('/hod/dashboard').then(r => setTeachers(r.data?.teachers || [])).catch(() => {});
  }, [year]);

  const toggle = (id) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const assignNow = async () => {
    if (!tutorId || selectedIds.size === 0) return;
    setAssigning(true);
    try {
      const r = await api.post('/tutor/assign', {
        tutor_id: Number(tutorId), student_ids: [...selectedIds],
        academic_year: year,
      });
      flash(`Assigned ${r.data.assigned} student(s).`);
      setSelectedIds(new Set());
      load();
    } catch (err) { flash(err.response?.data?.detail || 'Failed.', 'err'); }
    finally { setAssigning(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 bg-amber-50 border-b flex items-center justify-between flex-wrap gap-3">
        <span className="text-sm text-amber-700 font-medium">⚠️ {data.length} student(s) without a tutor for {year}</span>
        <div className="flex items-center gap-2">
          <select className="text-sm border rounded-lg px-3 py-1.5" value={tutorId}
                  onChange={e => setTutorId(e.target.value)}>
            <option value="">Select tutor…</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={assignNow} disabled={assigning || !tutorId || selectedIds.size === 0}
                  className="px-3 py-1.5 bg-[#1a237e] text-white text-xs rounded-lg hover:bg-[#283593] disabled:opacity-50">
            {assigning ? '…' : `Assign ${selectedIds.size}`}
          </button>
        </div>
      </div>
      {data.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b">
                <th className="px-4 py-2 text-left w-8">
                  <input type="checkbox"
                         checked={selectedIds.size === data.length && data.length > 0}
                         onChange={() => setSelectedIds(prev =>
                           prev.size === data.length ? new Set() : new Set(data.map(s => s.id))
                         )} className="rounded border-slate-300" />
                </th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Roll</th>
                <th className="px-4 py-2 text-left">Section</th>
                <th className="px-4 py-2 text-left">Semester</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.map(s => (
                <tr key={s.id} className={`hover:bg-slate-50 ${selectedIds.has(s.id) ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={selectedIds.has(s.id)}
                           onChange={() => toggle(s.id)} className="rounded border-slate-300" />
                  </td>
                  <td className="px-4 py-2 text-sm text-slate-700">{s.name}</td>
                  <td className="px-4 py-2 text-sm font-mono text-slate-500">{s.roll_number || '—'}</td>
                  <td className="px-4 py-2 text-sm text-slate-500">{s.section_name || '—'}</td>
                  <td className="px-4 py-2 text-sm text-slate-400">{s.semester ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-10 text-center text-emerald-500 text-sm">✅ All students have a tutor assigned for {year}.</div>
      )}
    </div>
  );
}
