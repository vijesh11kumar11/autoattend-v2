/**
 * AddPrincipalModal — POST /api/admin/colleges/{id}/principal
 */

import { useState } from 'react';
import api from '../../api/axios';

export default function AddPrincipalModal({ college, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error,    setError]   = useState('');
  const [loading,  setLoading] = useState(false);
  const [success,  setSuccess] = useState(null);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post(
        `/admin/colleges/${college.id}/principal`,
        { name: form.name, email: form.email, phone: form.phone || null, password: form.password }
      );
      setSuccess({ email: data.email, password: form.password });
      if (onCreated) onCreated(data);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to create principal.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
         onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md"
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Add Principal</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs text-slate-500 mb-4">
            For college: <span className="font-medium text-slate-700">{college.name}</span>
          </p>

          {success ? (
            <div className="space-y-3">
              <div className="px-3 py-2 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
                Principal created successfully. Provisioned credentials:
              </div>
              <div className="font-mono text-xs bg-slate-50 border border-slate-200 rounded p-3 space-y-1">
                <div><b>Email:</b> {success.email}</div>
                <div><b>Password:</b> {success.password}</div>
              </div>
              <p className="text-xs text-slate-500">
                A welcome email was attempted. Please share these credentials securely if it did not arrive.
              </p>
              <button onClick={onClose}
                className="w-full py-2 rounded bg-slate-800 hover:bg-slate-700 text-white text-sm">
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              {error && (
                <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
                  {error}
                </div>
              )}
              <Field label="Name"     value={form.name}     onChange={(v) => set('name', v)} required />
              <Field label="Email"    type="email"          value={form.email}    onChange={(v) => set('email', v)} required />
              <Field label="Phone"    value={form.phone}    onChange={(v) => set('phone', v)} />
              <Field label="Password" type="password"       value={form.password} onChange={(v) => set('password', v)} required minLength={8} />

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 rounded text-sm text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  className="px-4 py-2 rounded text-sm bg-amber-500 hover:bg-amber-400
                             text-slate-900 font-semibold disabled:opacity-60">
                  {loading ? 'Creating…' : 'Create Principal'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required, minLength }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} value={value} required={required} minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded border border-slate-300 text-sm
                   focus:outline-none focus:border-amber-500" />
    </div>
  );
}
