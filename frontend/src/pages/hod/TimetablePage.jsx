/**
 * AutoAttend AI v2.0 — HOD Timetable Management Page
 *
 * • Visual weekly grid (days as columns, time slots as rows)
 * • Color-coded cells with teacher, subject, room, section
 * • Click empty cell → create modal; click existing → edit/delete
 * • Upload Excel / Export Excel buttons
 */

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
};
const DAY_COLORS = {
  monday: 'bg-blue-50 border-blue-200',
  tuesday: 'bg-emerald-50 border-emerald-200',
  wednesday: 'bg-purple-50 border-purple-200',
  thursday: 'bg-amber-50 border-amber-200',
  friday: 'bg-red-50 border-red-200',
  saturday: 'bg-slate-50 border-slate-200',
};

const Spinner = () => (
  <div className="p-10 text-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
  </div>
);

export default function TimetablePage() {
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [sections, setSections] = useState([]);
  const [flash, setFlash] = useState('');
  const [flashType, setFlashType] = useState('ok');

  // modal
  const [modal, setModal] = useState(null); // null | { mode: 'create'|'edit', day?, entry? }

  const showFlash = (msg, type = 'ok') => {
    setFlash(msg);
    setFlashType(type);
  };

  const load = () => {
    setLoading(true);
    api
      .get('/timetable/department')
      .then((r) => {
        const byDay = {};
        (r.data.timetable || []).forEach((d) => {
          byDay[d.day.toLowerCase()] = d.entries || [];
        });
        setEntries(byDay);
      })
      .catch(() => showFlash('Failed to load timetable.', 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api
      .get('/hod/dashboard')
      .then((r) => setTeachers(r.data?.teachers || []))
      .catch(() => {});
    api
      .get('/sections')
      .then((r) => setSections(r.data || []))
      .catch(() => {});
    // Subjects come from HOD dashboard too
    api
      .get('/hod/dashboard')
      .then((r) => setSubjects(r.data?.subjects || []))
      .catch(() => {});
  }, []);

  // Upload Excel
  const [uploading, setUploading] = useState(false);
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/timetable/bulk-upload-excel', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showFlash(`Created ${r.data.created} entries. ${r.data.failed_rows?.length || 0} failed.`);
      load();
    } catch (err) {
      showFlash(err.response?.data?.detail || 'Upload failed.', 'err');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Export Excel
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const r = await api.get('/timetable/export-excel', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'timetable.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      showFlash('Export failed.', 'err');
    } finally {
      setExporting(false);
    }
  };

  // Delete entry
  const handleDelete = async (id) => {
    if (!window.confirm('Delete this timetable entry?')) return;
    try {
      await api.delete(`/timetable/entry/${id}`);
      showFlash('Deleted.');
      load();
    } catch {
      showFlash('Delete failed.', 'err');
    }
  };

  // Build time slots for grid
  const allTimes = new Set();
  Object.values(entries)
    .flat()
    .forEach((e) => allTimes.add(e.start_time));
  const timeSlots = [...allTimes].sort();

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      {flash && (
        <div
          className={`card px-5 py-3 text-sm flex items-center justify-between
          ${flashType === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
        >
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-slate-700">📅 Department Timetable</h2>
        <div className="flex items-center gap-2">
          <label
            className={`px-4 py-1.5 text-sm rounded-lg cursor-pointer
            ${uploading ? 'bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'} text-white`}
          >
            {uploading ? 'Uploading…' : '📤 Upload Excel'}
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : '⬇️ Export Excel'}
          </button>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="px-4 py-1.5 bg-[#1a237e] text-white text-sm rounded-lg hover:bg-[#283593]"
          >
            ➕ Add Period
          </button>
        </div>
      </div>

      {/* Weekly Grid */}
      <div className="card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-xs text-slate-400 border bg-slate-50 w-20">Time</th>
              {DAYS.map((d) => (
                <th key={d} className="p-2 text-xs font-semibold text-slate-600 border bg-slate-50">
                  {DAY_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeSlots.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-10 text-center text-slate-400 text-sm">
                  No timetable entries. Click "Add Period" or upload Excel.
                </td>
              </tr>
            ) : (
              timeSlots.map((time) => (
                <tr key={time}>
                  <td className="p-2 text-xs font-mono text-slate-500 border bg-slate-50 text-center align-top">
                    {time}
                  </td>
                  {DAYS.map((day) => {
                    const dayEntries = (entries[day] || []).filter((e) => e.start_time === time);
                    return (
                      <td key={day} className="p-1 border align-top min-w-[120px]">
                        {dayEntries.length > 0 ? (
                          dayEntries.map((e) => (
                            <div
                              key={e.timetable_id}
                              onClick={() => setModal({ mode: 'edit', entry: e })}
                              className={`p-2 rounded-lg border text-xs cursor-pointer mb-1 hover:shadow-md transition ${DAY_COLORS[day]}`}
                              style={
                                e.color_tag
                                  ? { borderLeftColor: e.color_tag, borderLeftWidth: 4 }
                                  : {}
                              }
                            >
                              <p className="font-semibold text-slate-700 truncate">
                                {e.subject_name}
                              </p>
                              <p className="text-slate-400">{e.subject_code}</p>
                              <p className="text-slate-500 mt-1">👨‍🏫 {e.teacher_name}</p>
                              {e.section_name && (
                                <p className="text-slate-400">👥 {e.section_name}</p>
                              )}
                              <div className="flex justify-between mt-1">
                                <span className="font-mono">
                                  {e.start_time}–{e.end_time}
                                </span>
                                <span>🏫 {e.room || '—'}</span>
                              </div>
                              {e.is_lab && (
                                <span className="inline-block mt-1 px-1 py-0.5 bg-purple-100 text-purple-600 rounded text-[10px]">
                                  LAB
                                </span>
                              )}
                            </div>
                          ))
                        ) : (
                          <button
                            onClick={() => setModal({ mode: 'create', day })}
                            className="w-full h-10 rounded border border-dashed border-slate-200 text-slate-300 hover:border-slate-400 hover:text-slate-400 text-xs transition"
                          >
                            +
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {modal && (
        <EntryModal
          modal={modal}
          teachers={teachers}
          subjects={subjects}
          sections={sections}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
          onDeleted={(id) => {
            handleDelete(id);
            setModal(null);
          }}
          showFlash={showFlash}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Create / Edit Modal
// ══════════════════════════════════════════════════════════════════════

function EntryModal({
  modal,
  teachers,
  subjects,
  sections,
  onClose,
  onSaved,
  onDeleted,
  showFlash,
}) {
  const isEdit = modal.mode === 'edit';
  const e = modal.entry || {};

  const [form, setForm] = useState({
    subject_id: e.subject_id || '',
    teacher_id: e.teacher_id || '',
    day_of_week: e.day_of_week || modal.day || 'monday',
    start_time: e.start_time || '',
    end_time: e.end_time || '',
    room: e.room || '',
    section_id: e.section_id || '',
    period_number: e.period_number || '',
    is_lab: e.is_lab || false,
    color_tag: e.color_tag || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!form.subject_id || !form.teacher_id || !form.start_time || !form.end_time) {
      showFlash('Subject, teacher, start time, and end time are required.', 'err');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        subject_id: Number(form.subject_id),
        teacher_id: Number(form.teacher_id),
        section_id: form.section_id ? Number(form.section_id) : null,
        period_number: form.period_number ? Number(form.period_number) : null,
      };
      if (isEdit) {
        await api.put(`/timetable/entry/${e.timetable_id}`, payload);
        showFlash('Entry updated.');
      } else {
        await api.post('/timetable/entry', payload);
        showFlash('Entry created.');
      }
      onSaved();
    } catch (err) {
      showFlash(err.response?.data?.detail || 'Save failed.', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">
            {isEdit ? '✏️ Edit Period' : '➕ Add Period'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Subject</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.subject_id}
                onChange={(e) => set('subject_id', e.target.value)}
              >
                <option value="">Choose…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Teacher</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.teacher_id}
                onChange={(e) => set('teacher_id', e.target.value)}
              >
                <option value="">Choose…</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Day</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.day_of_week}
                onChange={(e) => set('day_of_week', e.target.value)}
              >
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Time</label>
              <input
                type="time"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.start_time}
                onChange={(e) => set('start_time', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End Time</label>
              <input
                type="time"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.end_time}
                onChange={(e) => set('end_time', e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Section</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.section_id}
                onChange={(e) => set('section_id', e.target.value)}
              >
                <option value="">None</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Room</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Room 101"
                value={form.room}
                onChange={(e) => set('room', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Period #</label>
              <input
                type="number"
                min={1}
                max={12}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.period_number}
                onChange={(e) => set('period_number', e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.is_lab}
                onChange={(e) => set('is_lab', e.target.checked)}
                className="rounded"
              />
              Lab session
            </label>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Color</label>
              {/* Default colour for a new timetable slot — picker requires a literal hex.
                  NOTE: input[type=color] cannot consume CSS variables, so this stays a
                  literal hex rather than a design token. */}
              <input
                type="color"
                value={form.color_tag || '#3b82f6'}
                onChange={(e) => set('color_tag', e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0"
              />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <div>
              {isEdit && (
                <button
                  onClick={() => onDeleted(e.timetable_id)}
                  className="px-4 py-2 text-sm text-red-500 hover:text-red-700"
                >
                  🗑️ Delete
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={saving}
                className="px-5 py-2 text-sm bg-[#1a237e] text-white rounded-lg hover:bg-[#283593] disabled:opacity-50"
              >
                {saving ? 'Saving…' : isEdit ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
