/**
 * TRACELN v2.0 — HOD Sections Management
 *
 * Features:
 * • Create / edit / delete sections (A, B, C…)
 * • Filter by course + semester
 * • View students in a section
 * • Bulk-assign students by selection or Excel upload
 * • Remove student from section
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

// ── helpers ───────────────────────────────────────────────────────────
const Spinner = () => (
  <div className="card p-10 text-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
    <p className="text-slate-400 text-sm mt-3">Loading…</p>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════
export default function SectionsPage() {
  // ── state ────────────────────────────────────────────────────────
  const [sections, setSections] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // filters
  const [courseFilter, setCourseFilter] = useState('all');
  const [semFilter, setSemFilter] = useState('all');

  // create / edit modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null); // section obj or null
  const [form, setForm] = useState({ course_id: '', semester: '', name: '', max_strength: '' });
  const [formErr, setFormErr] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // student drill-down
  const [viewSection, setViewSection] = useState(null); // section obj
  const [sectionStudents, setSectionStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);

  // bulk assign modal
  const [showAssign, setShowAssign] = useState(false);
  const [assignSection, setAssignSection] = useState(null);
  const [unassigned, setUnassigned] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [assignLoading, setAssignLoading] = useState(false);

  // excel upload
  const [excelFile, setExcelFile] = useState(null);
  const [excelLoading, setExcelLoading] = useState(false);

  // ── load data ────────────────────────────────────────────────────
  const loadSections = () => {
    setLoading(true);
    const params = {};
    if (courseFilter !== 'all') params.course_id = courseFilter;
    if (semFilter !== 'all') params.semester = semFilter;

    api
      .get('/sections', { params })
      .then((r) => setSections(r.data || []))
      .catch(() => setError('Failed to load sections.'))
      .finally(() => setLoading(false));
  };

  const loadCourses = () => {
    api
      .get('/reports/hod/subjects')
      .then((r) => {
        const subjs = r.data || [];
        const map = {};
        subjs.forEach((s) => {
          if (s.course_id && s.course_name) map[s.course_id] = s.course_name;
        });
        setCourses(Object.entries(map).map(([id, name]) => ({ id: Number(id), name })));
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadCourses();
  }, []);
  useEffect(() => {
    loadSections();
  }, [courseFilter, semFilter]);

  // ── create / edit ────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setForm({
      course_id: courseFilter !== 'all' ? courseFilter : '',
      semester: semFilter !== 'all' ? semFilter : '',
      name: '',
      max_strength: '',
    });
    setFormErr('');
    setShowModal(true);
  };

  const openEdit = (sec) => {
    setEditing(sec);
    setForm({
      course_id: sec.course_id,
      semester: sec.semester,
      name: sec.name,
      max_strength: sec.max_strength || '',
    });
    setFormErr('');
    setShowModal(true);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setFormErr('');
    setFormLoading(true);
    try {
      if (editing) {
        await api.put(`/sections/${editing.id}`, {
          name: form.name,
          max_strength: form.max_strength ? Number(form.max_strength) : null,
        });
        setMsg('Section updated.');
      } else {
        await api.post('/sections', {
          course_id: Number(form.course_id),
          semester: Number(form.semester),
          name: form.name,
          max_strength: form.max_strength ? Number(form.max_strength) : null,
        });
        setMsg('Section created.');
      }
      setShowModal(false);
      loadSections();
    } catch (err) {
      setFormErr(err.response?.data?.detail || 'Failed to save section.');
    } finally {
      setFormLoading(false);
    }
  };

  // ── delete ───────────────────────────────────────────────────────
  const handleDelete = async (sec) => {
    if (
      !window.confirm(
        `Delete section "${sec.name}" (${sec.course_name} Sem ${sec.semester})? Students will be unassigned.`
      )
    )
      return;
    try {
      await api.delete(`/sections/${sec.id}`);
      setMsg('Section deleted.');
      loadSections();
      if (viewSection?.id === sec.id) setViewSection(null);
    } catch {
      setMsg('Failed to delete section.');
    }
  };

  // ── view students ────────────────────────────────────────────────
  const openStudents = async (sec) => {
    setViewSection(sec);
    setStudentsLoading(true);
    try {
      const r = await api.get(`/sections/${sec.id}/students`);
      setSectionStudents(r.data || []);
    } catch {
      setSectionStudents([]);
    } finally {
      setStudentsLoading(false);
    }
  };

  const removeStudent = async (studentId) => {
    try {
      await api.post('/sections/remove-student', { student_id: studentId });
      setSectionStudents((prev) => prev.filter((s) => s.id !== studentId));
      loadSections();
    } catch {
      setMsg('Failed to remove student.');
    }
  };

  // ── bulk assign ──────────────────────────────────────────────────
  const openAssign = async (sec) => {
    setAssignSection(sec);
    setSelectedIds(new Set());
    setAssignLoading(true);
    setShowAssign(true);
    try {
      // Get all students in the course+semester who are NOT in this section
      const r = await api.get('/hod/dashboard');
      const allStudents = r.data?.students || [];
      // Filter: same department, unassigned or in different section
      // We'll use sections/{id}/students to get current, then diff
      const inSection = await api.get(`/sections/${sec.id}/students`);
      const inIds = new Set((inSection.data || []).map((s) => s.id));
      setUnassigned(allStudents.filter((s) => !inIds.has(s.id)));
    } catch {
      setUnassigned([]);
    } finally {
      setAssignLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const submitAssign = async () => {
    if (selectedIds.size === 0) return;
    setAssignLoading(true);
    try {
      await api.post('/sections/assign-students', {
        section_id: assignSection.id,
        student_ids: [...selectedIds],
      });
      setMsg(`${selectedIds.size} student(s) assigned to Section ${assignSection.name}.`);
      setShowAssign(false);
      loadSections();
      if (viewSection?.id === assignSection.id) openStudents(assignSection);
    } catch {
      setMsg('Failed to assign students.');
    } finally {
      setAssignLoading(false);
    }
  };

  // ── excel upload ─────────────────────────────────────────────────
  const submitExcel = async (sec) => {
    if (!excelFile) return;
    setExcelLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', excelFile);
      const r = await api.post(`/sections/assign-students-excel?section_id=${sec.id}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const d = r.data;
      setMsg(`Excel: ${d.assigned} assigned. ${d.not_found_rolls?.length || 0} not found.`);
      setExcelFile(null);
      loadSections();
      if (viewSection?.id === sec.id) openStudents(sec);
    } catch (err) {
      setMsg(err.response?.data?.detail || 'Excel upload failed.');
    } finally {
      setExcelLoading(false);
    }
  };

  // ── distinct semesters from sections ─────────────────────────────
  const semesters = [...new Set(sections.map((s) => s.semester))].sort((a, b) => a - b);

  // ── render ───────────────────────────────────────────────────────
  if (loading && sections.length === 0) return <Spinner />;

  return (
    <div className="space-y-6">
      {/* ── success / error banner ──────────────────────────────── */}
      {msg && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{msg}</span>
          <button className="text-emerald-400 hover:text-emerald-600" onClick={() => setMsg('')}>
            ✕
          </button>
        </div>
      )}
      {error && <div className="card p-8 text-center text-red-500">{error}</div>}

      {/* ── header + filters ────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between flex-wrap gap-3">
          <span className="font-semibold text-slate-700">👥 Sections ({sections.length})</span>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              className="text-sm border rounded-lg px-3 py-1.5 text-slate-600"
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
            >
              <option value="all">All Courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="text-sm border rounded-lg px-3 py-1.5 text-slate-600"
              value={semFilter}
              onChange={(e) => setSemFilter(e.target.value)}
            >
              <option value="all">All Semesters</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
            <button
              onClick={openCreate}
              className="px-4 py-1.5 bg-[#1a237e] text-white text-sm rounded-lg hover:bg-[#283593] transition"
            >
              + New Section
            </button>
          </div>
        </div>

        {/* ── table ──────────────────────────────────────────────── */}
        {sections.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-slate-400 uppercase border-b">
                  <th className="px-5 py-2 text-left">Section</th>
                  <th className="px-5 py-2 text-left">Course</th>
                  <th className="px-5 py-2 text-left">Semester</th>
                  <th className="px-5 py-2 text-center">Students</th>
                  <th className="px-5 py-2 text-center">Max</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sections.map((sec) => (
                  <tr key={sec.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-bold text-[#1a237e]">{sec.name}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{sec.course_name}</td>
                    <td className="px-5 py-3 text-sm text-slate-500">Sem {sec.semester}</td>
                    <td className="px-5 py-3 text-sm text-center font-medium">
                      {sec.student_count}
                    </td>
                    <td className="px-5 py-3 text-sm text-center text-slate-400">
                      {sec.max_strength ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right space-x-2">
                      <button
                        onClick={() => openStudents(sec)}
                        className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                      >
                        View
                      </button>
                      <button
                        onClick={() => openAssign(sec)}
                        className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                      >
                        Assign
                      </button>
                      <button
                        onClick={() => openEdit(sec)}
                        className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-600 hover:bg-amber-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(sec)}
                        className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-slate-400 text-sm">
            No sections found. Click <strong>+ New Section</strong> to create one.
          </div>
        )}
      </div>

      {/* ── student list panel ──────────────────────────────────── */}
      {viewSection && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 bg-blue-50 border-b flex items-center justify-between">
            <span className="font-semibold text-blue-800">
              Students in Section {viewSection.name} — {viewSection.course_name} Sem{' '}
              {viewSection.semester}
            </span>
            <div className="flex items-center gap-2">
              {/* excel upload */}
              <input
                type="file"
                accept=".xlsx,.xls"
                id="excel-upload"
                className="hidden"
                onChange={(e) => setExcelFile(e.target.files[0])}
              />
              <label
                htmlFor="excel-upload"
                className="text-xs px-3 py-1.5 rounded bg-purple-50 text-purple-600 hover:bg-purple-100 cursor-pointer"
              >
                📄 Upload Excel
              </label>
              {excelFile && (
                <button
                  onClick={() => submitExcel(viewSection)}
                  disabled={excelLoading}
                  className="text-xs px-3 py-1.5 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {excelLoading ? 'Uploading…' : `Import ${excelFile.name}`}
                </button>
              )}
              <button
                onClick={() => setViewSection(null)}
                className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-500 hover:bg-slate-200"
              >
                Close
              </button>
            </div>
          </div>
          {studentsLoading ? (
            <div className="p-6 text-center text-slate-400 text-sm animate-pulse">
              Loading students…
            </div>
          ) : sectionStudents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-slate-400 uppercase border-b">
                    <th className="px-5 py-2 text-left">Roll No</th>
                    <th className="px-5 py-2 text-left">Name</th>
                    <th className="px-5 py-2 text-left">Email</th>
                    <th className="px-5 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sectionStudents.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-2 text-sm font-mono text-slate-600">
                        {s.roll_number || '—'}
                      </td>
                      <td className="px-5 py-2 text-sm text-slate-700">{s.name}</td>
                      <td className="px-5 py-2 text-sm text-slate-400">{s.email}</td>
                      <td className="px-5 py-2 text-right">
                        <button
                          onClick={() => removeStudent(s.id)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-slate-400 text-sm">
              No students in this section yet.
            </div>
          )}
        </div>
      )}

      {/* ── create / edit modal ─────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b">
              <h3 className="text-lg font-semibold text-slate-700">
                {editing ? 'Edit Section' : 'Create Section'}
              </h3>
            </div>
            <form onSubmit={submitForm} className="p-5 space-y-4">
              {formErr && <div className="text-red-500 text-sm">{formErr}</div>}

              {!editing && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Course</label>
                    <select
                      required
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={form.course_id}
                      onChange={(e) => setForm((f) => ({ ...f, course_id: e.target.value }))}
                    >
                      <option value="">Select course…</option>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      Semester
                    </label>
                    <select
                      required
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={form.semester}
                      onChange={(e) => setForm((f) => ({ ...f, semester: e.target.value }))}
                    >
                      <option value="">Select semester…</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                        <option key={s} value={s}>
                          Semester {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Section Name
                </label>
                <input
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. A, B, C"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Max Strength (optional)
                </label>
                <input
                  type="number"
                  min="1"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. 60"
                  value={form.max_strength}
                  onChange={(e) => setForm((f) => ({ ...f, max_strength: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-4 py-2 text-sm bg-[#1a237e] text-white rounded-lg hover:bg-[#283593] disabled:opacity-50"
                >
                  {formLoading ? 'Saving…' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── bulk assign modal ───────────────────────────────────── */}
      {showAssign && assignSection && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-700">
                Assign Students → Section {assignSection.name}
              </h3>
              <button
                onClick={() => setShowAssign(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {assignLoading ? (
                <div className="text-center text-slate-400 text-sm animate-pulse">
                  Loading students…
                </div>
              ) : unassigned.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400 mb-3">
                    Select students to assign ({selectedIds.size} selected)
                  </p>
                  {unassigned.map((s) => (
                    <label
                      key={s.id}
                      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition
                                      ${selectedIds.has(s.id) ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        className="rounded border-slate-300"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-700 truncate">{s.name}</div>
                        <div className="text-xs text-slate-400">{s.roll_number || s.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-center text-slate-400 text-sm">
                  No unassigned students available.
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowAssign(false)}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={submitAssign}
                disabled={selectedIds.size === 0 || assignLoading}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {assignLoading ? 'Assigning…' : `Assign ${selectedIds.size} Student(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
