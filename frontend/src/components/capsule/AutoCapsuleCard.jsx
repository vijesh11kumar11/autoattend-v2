/**
 * AutoCapsuleCard
 * --------------------------------------------------------------
 * Specialised viewer for auto-generated capsules from live sessions.
 * Renders chapter list, smart-replay search, student-specific note,
 * homework suggestion, and a pre-existing key points list.
 *
 * Mermaid diagrams (if any) render as <pre> placeholder until a
 * mermaid renderer is wired up.
 */
import { useState } from 'react';
import api from '../../api/axios';

const fmt = (s) => {
  s = Math.max(0, Number(s) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

export default function AutoCapsuleCard({ capsule }) {
  const [query, setQuery]   = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  const chapters = capsule.chapters || [];
  const myNote   = capsule.my_specific_note || capsule.student_specific_note;

  const askReplay = async () => {
    if (!query.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api.post(`/api/classpulse/capsules/${capsule.id}/smart-replay`, { query });
      setResult(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Smart replay failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-emerald-50 via-white to-violet-50 border border-emerald-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="text-3xl">🤖</span>
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700">Auto-generated from live session</p>
          <h2 className="text-lg font-bold text-slate-800">{capsule.title}</h2>
          {capsule.description && <p className="text-xs text-slate-500 mt-0.5">{capsule.description}</p>}
        </div>
      </div>

      {capsule.ai_summary && (
        <div className="bg-white/70 rounded-lg p-3 border border-slate-100">
          <p className="text-xs font-semibold text-slate-600 mb-1">Summary</p>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{capsule.ai_summary}</p>
        </div>
      )}

      {(capsule.key_points || []).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-1">Key Points</p>
          <ul className="list-disc pl-5 text-sm text-slate-800 space-y-0.5">
            {capsule.key_points.map((k, i) => <li key={i}>{k}</li>)}
          </ul>
        </div>
      )}

      {chapters.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-1">📑 Chapters</p>
          <ul className="space-y-1 text-sm">
            {chapters.map((c, i) => (
              <li key={i} className="flex gap-2 items-start bg-white/60 rounded p-2 border border-slate-100">
                <span className="text-violet-600 font-mono text-xs flex-shrink-0">{fmt(c.timestamp_seconds || 0)}</span>
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{c.title}</p>
                  {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {capsule.has_recording && chapters.length > 0 && (
        <div className="bg-white/80 rounded-lg p-3 border border-violet-100">
          <p className="text-xs font-semibold text-slate-600 mb-2">🔍 Smart Replay — jump to the moment</p>
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
              placeholder="e.g. 'when did teacher explain Bayes theorem?'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && askReplay()}
            />
            <button
              onClick={askReplay}
              disabled={busy || query.trim().length < 2}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
            >
              {busy ? '…' : 'Ask'}
            </button>
          </div>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          {result && (
            <div className="mt-3 bg-violet-50 border border-violet-200 rounded p-2 text-sm">
              <p className="font-semibold text-violet-800">{result.chapter_title}</p>
              <p className="text-xs text-slate-600">⏱ {fmt(result.start_seconds)} – {fmt(result.end_seconds)} · {result.reason}</p>
              {result.recording_url && (
                <a
                  href={`${result.recording_url}#t=${result.start_seconds}`}
                  target="_blank" rel="noreferrer"
                  className="inline-block mt-1 text-xs text-violet-700 underline"
                >
                  ▶ Open recording at {fmt(result.start_seconds)}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {myNote && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-700 mb-1">📝 Note for you</p>
          <p className="text-sm text-amber-900">{myNote}</p>
        </div>
      )}

      {capsule.homework_suggestion && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-700 mb-1">📚 Homework suggestion</p>
          <p className="text-sm text-blue-900 whitespace-pre-wrap">{capsule.homework_suggestion}</p>
        </div>
      )}

      {capsule.mermaid_diagram && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-1">Diagram</p>
          <pre className="bg-slate-900 text-slate-100 text-xs rounded p-2 overflow-x-auto">{capsule.mermaid_diagram}</pre>
        </div>
      )}
    </div>
  );
}
