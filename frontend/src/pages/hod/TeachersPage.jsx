/**
 * HOD — Teachers Page
 *
 * Displays all teachers in the HOD's department using /api/hod/dashboard data.
 * Shows teacher name, email, assigned subjects, and today's live session status.
 * Supports adding new teachers via a modal form.
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';

const SESSION_BADGE = {
  active:  { bg: 'bg-emerald-100 text-emerald-700', label: '🟢 Active' },
  ended:   { bg: 'bg-slate-100 text-slate-600',     label: 'Ended' },
  expired: { bg: 'bg-amber-100 text-amber-700',     label: 'Expired' },
};

export default function TeachersPage() {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [search, setSearch]     = useState('');
  const [flash, setFlash]       = useState('');

  // Add teacher modal
  const [showAdd, setShowAdd]         = useState(false);
  const [addForm, setAddForm]         = useState({ name: '', email: '', phone: '' });
  const [addLoading, setAddLoading]   = useState(false);
  const [addError, setAddError]       = useState('');

  const loadTeachers = () => {
    setLoading(true);
    api.get('/hod/dashboard')
      .then(r => setTeachers(r.data?.teachers ?? []))
      .catch(() => setError('Failed to load teacher list.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTeachers(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return teachers;
    return teachers.filter(t =>
      t.name.toLowerCase().includes(q)
      || t.email.toLowerCase().includes(q)
      || (t.subject_names || []).some(s => s.toLowerCase().includes(q))
    );
  }, [teachers, search]);

  const submitAddTeacher = async () => {
    if (!addForm.name.trim() || !addForm.email.trim()) {
      setAddError('Name and email are required.');
      return;
    }
    setAddLoading(true);
    setAddError('');
    try {
      const r = await api.post('/hod/add-teacher', {
        name: addForm.name.trim(),
        email: addForm.email.trim(),
        phone: addForm.phone.trim() || null,
      });
      setFlash(r.data.message || 'Teacher added successfully.');
      setShowAdd(false);
      setAddForm({ name: '', email: '', phone: '' });
      loadTeachers();
    } catch (err) {
      setAddError(err.response?.data?.detail || 'Failed to add teacher.');
    } finally {
      setAddLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="spinner mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading teachers…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-5">
      {flash && (
        <div className="card px-5 py-3 bg-emerald-50 text-emerald-700 text-sm flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-700">👩‍🏫 Teachers ({teachers.length})</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search name, email, subject…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input w-72"
          />
          <button onClick={() => setShowAdd(true)}
                  className="px-4 py-2 bg-[#1a237e] text-white text-sm rounded-lg hover:bg-[#283593] whitespace-nowrap">
            ➕ Add Teacher
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No teachers match your search.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(t => {
            const sess = t.today_session;
            const badge = sess ? SESSION_BADGE[sess.status] || SESSION_BADGE.ended : null;
            return (
              <div key={t.id} className="card p-5 space-y-3 hover:shadow-md transition-shadow">
                <div>
                  <p className="font-semibold text-slate-700">{t.name}</p>
                  <p className="text-xs text-slate-400 truncate">{t.email}</p>
                </div>

                {/* subjects */}
                <div className="flex flex-wrap gap-1">
                  {(t.subject_names || []).length > 0 ? (
                    t.subject_names.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-full">{s}</span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-300 italic">No subjects assigned</span>
                  )}
                </div>

                {/* today's session */}
                {badge && (
                  <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${badge.bg}`}>
                    <span>{badge.label}</span>
                    <span className="font-semibold">{sess.present_count}/{sess.total_students} present</span>
                  </div>
                )}
                {!badge && (
                  <p className="text-xs text-slate-300 italic">No session today</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Teacher Modal ──────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-slate-700">➕ Add New Teacher</h3>
              <button onClick={() => { setShowAdd(false); setAddError(''); }}
                      className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {addError && (
                <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{addError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Full Name *</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Dr. Rajesh Kumar"
                       value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Email *</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" type="email"
                       placeholder="e.g. rajesh.teacher@svec.edu.in"
                       value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Phone (optional)</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="+91XXXXXXXXXX"
                       value={addForm.phone} onChange={e => setAddForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                Default password: <b>password123</b> — teacher should change it on first login.
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => { setShowAdd(false); setAddError(''); }}
                        className="px-4 py-2 text-sm text-slate-500">Cancel</button>
                <button onClick={submitAddTeacher} disabled={addLoading}
                        className="px-4 py-2 text-sm bg-[#1a237e] text-white rounded-lg hover:bg-[#283593] disabled:opacity-50">
                  {addLoading ? 'Adding…' : 'Add Teacher'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
