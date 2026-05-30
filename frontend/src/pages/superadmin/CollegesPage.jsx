/**
 * CollegesPage — /admin/colleges
 *
 * Lists every college on the platform (including soft-deleted ones, which
 * are rendered struck-through). Supports cursor pagination via the
 * `{items, next_cursor, has_more}` envelope from /api/admin/colleges.
 */

import { useCallback, useEffect, useState } from 'react';
import api from '../../api/axios';
import AddPrincipalModal from './AddPrincipalModal';

const PLAN_CHIP = {
  trial:     'bg-yellow-100 text-yellow-800',
  active:    'bg-green-100  text-green-800',
  suspended: 'bg-red-100    text-red-700',
  cancelled: 'bg-slate-200  text-slate-600',
};

const PLAN_OPTIONS = ['trial', 'active', 'suspended', 'cancelled'];

export default function CollegesPage() {
  const [colleges,   setColleges]   = useState([]);
  const [cursor,     setCursor]     = useState(null);
  const [hasMore,    setHasMore]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  const [addOpen,        setAddOpen]        = useState(false);
  const [editing,        setEditing]        = useState(null);   // college obj or null
  const [principalFor,   setPrincipalFor]   = useState(null);   // college obj or null

  const fetchPage = useCallback(async (afterCursor = null, replace = false) => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: 20 };
      if (afterCursor) params.cursor = afterCursor;
      const { data } = await api.get('/admin/colleges', { params });
      setColleges((prev) => (replace ? data.items : [...prev, ...data.items]));
      setCursor(data.next_cursor);
      setHasMore(!!data.has_more);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to load colleges.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPage(null, true); }, [fetchPage]);

  function refresh() { fetchPage(null, true); }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Colleges</h1>
          <p className="text-sm text-slate-500">All tenants on the platform</p>
        </div>
        <button onClick={() => setAddOpen(true)}
          className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400
                     text-slate-900 font-semibold text-sm">
          + Add College
        </button>
      </header>

      {error && (
        <div className="mb-4 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <Th>Name</Th>
              <Th>Domain</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th className="text-right">Users</Th>
              <Th className="text-right">Students</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {colleges.map((c) => (
              <tr key={c.id}
                  className={`border-t border-slate-100 ${c.is_deleted ? 'opacity-60' : ''}`}>
                <Td className={c.is_deleted ? 'line-through' : 'font-medium text-slate-800'}>
                  {c.name}
                </Td>
                <Td className="text-slate-600">{c.domain || '—'}</Td>
                <Td>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    PLAN_CHIP[c.plan] || 'bg-slate-100 text-slate-600'
                  }`}>{c.plan}</span>
                </Td>
                <Td className="text-slate-600">{c.status}</Td>
                <Td className="text-right tabular-nums">{c.user_count}</Td>
                <Td className="text-right tabular-nums">{c.student_count}</Td>
                <Td className="text-slate-500 text-xs">
                  {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                </Td>
                <Td className="text-right">
                  <button onClick={() => setEditing(c)}
                    className="px-2 py-1 text-xs rounded text-slate-700 hover:bg-slate-100">
                    Edit
                  </button>
                  <button onClick={() => setPrincipalFor(c)}
                    disabled={c.is_deleted}
                    className="ml-1 px-2 py-1 text-xs rounded text-amber-700
                               hover:bg-amber-50 disabled:opacity-40 disabled:hover:bg-transparent">
                    + Principal
                  </button>
                </Td>
              </tr>
            ))}

            {!loading && colleges.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-10 text-slate-400 text-sm">
                  No colleges yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-center">
        {hasMore && (
          <button onClick={() => fetchPage(cursor, false)} disabled={loading}
            className="px-4 py-2 rounded border border-slate-300 text-sm
                       hover:bg-slate-100 disabled:opacity-50">
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {loading && !hasMore && <span className="text-xs text-slate-400">Loading…</span>}
      </div>

      {addOpen && <CollegeFormModal onClose={() => setAddOpen(false)} onSaved={refresh} />}
      {editing && (
        <CollegeFormModal college={editing}
                          onClose={() => setEditing(null)}
                          onSaved={refresh} />
      )}
      {principalFor && (
        <AddPrincipalModal college={principalFor}
                           onClose={() => setPrincipalFor(null)}
                           onCreated={refresh} />
      )}
    </div>
  );
}

function Th({ children, className = '' }) {
  return <th className={`px-3 py-2 text-left font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

// ── Combined Create + Edit modal ─────────────────────────────────────
function CollegeFormModal({ college, onClose, onSaved }) {
  const isEdit = !!college;
  const [name,    setName]   = useState(college?.name   || '');
  const [domain,  setDomain] = useState(college?.domain || '');
  const [plan,    setPlan]   = useState(college?.plan   || 'trial');
  const [status,  setStatus] = useState(college?.status || 'active');
  const [error,   setError]  = useState('');
  const [busy,    setBusy]   = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isEdit) {
        await api.patch(`/admin/colleges/${college.id}`, {
          name, domain: domain || null, plan, status,
        });
      } else {
        await api.post('/admin/colleges', {
          name, domain: domain || null, plan,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to save college.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
         onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md"
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">
            {isEdit ? `Edit College — ${college.name}` : 'Add College'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-3">
          {error && (
            <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2}
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm
                         focus:outline-none focus:border-amber-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Domain <span className="text-slate-400">(e.g. example.edu)</span>
            </label>
            <input value={domain} onChange={(e) => setDomain(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm
                         focus:outline-none focus:border-amber-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Plan</label>
              <select value={plan} onChange={(e) => setPlan(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 text-sm bg-white
                           focus:outline-none focus:border-amber-500">
                {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 text-sm bg-white
                             focus:outline-none focus:border-amber-500">
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>
            )}
          </div>

          {isEdit && (plan === 'suspended' || plan === 'cancelled') &&
            college.plan !== plan && (
            <div className="px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              Setting plan to <b>{plan}</b> will soft-delete this college and
              deactivate all its users.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="px-4 py-2 rounded text-sm bg-amber-500 hover:bg-amber-400
                         text-slate-900 font-semibold disabled:opacity-60">
              {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create college')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
