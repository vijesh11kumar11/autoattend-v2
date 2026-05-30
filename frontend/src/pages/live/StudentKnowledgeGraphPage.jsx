/**
 * StudentKnowledgeGraphPage — student's per-subject learning profile (Prompt 5).
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

const VIOLET = 'from-violet-600 via-purple-600 to-fuchsia-600';

function Dots({ value }) {
  const filled = Math.round(value / 20);
  return (
    <span className="font-mono text-sm">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < filled ? 'text-violet-600' : 'text-slate-300'}>
          ●
        </span>
      ))}
    </span>
  );
}

export default function StudentKnowledgeGraphPage() {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState([]);
  const [activeSubject, setActiveSubject] = useState(null);
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .get('/student/portal/dashboard')
      .then((r) => {
        const subs = (r.data?.attendance_summary || []).map((s) => ({
          id: s.subject_id,
          name: s.subject_name,
        }));
        setSubjects(subs);
        if (subs[0]) setActiveSubject(subs[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeSubject) return;
    setLoading(true);
    api
      .get('/live/students/my-knowledge-graph', { params: { subject_id: activeSubject } })
      .then((r) => setGraph(r.data))
      .catch((e) => setErr(e.response?.data?.detail || 'Failed to load graph'))
      .finally(() => setLoading(false));
  }, [activeSubject]);

  const strong = useMemo(
    () => (graph?.topics || []).filter((t) => (t.mastery || 0) >= 75),
    [graph]
  );
  const weak = useMemo(() => (graph?.topics || []).filter((t) => (t.mastery || 0) < 75), [graph]);

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className={`bg-gradient-to-r ${VIOLET} rounded-2xl p-6 text-white shadow-lg`}>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <span className="text-3xl">🧠</span> My Learning Profile
        </h1>
        <p className="text-white/80 text-sm mt-1">
          AI tracks your mastery across topics in each subject.
        </p>
      </div>

      {subjects.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {subjects.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSubject(s.id)}
              className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${
                activeSubject === s.id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="text-center text-slate-400 py-6">Loading…</p>}
      {err && <div className="bg-red-50 text-red-700 p-4 rounded-lg">{err}</div>}

      {graph && !loading && (
        <>
          <div className="bg-white rounded-2xl border border-emerald-200 p-5 shadow-sm">
            <h3 className="font-bold text-emerald-700 mb-3">✅ Strong ({strong.length} topics)</h3>
            {strong.length === 0 && (
              <p className="text-sm text-slate-400">Keep going — you're building a base.</p>
            )}
            <ul className="space-y-2">
              {strong.map((t, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-800">{t.name || t.topic}</span>
                  <span className="flex items-center gap-2">
                    <Dots value={t.mastery || 0} /> {t.mastery || 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-sm">
            <h3 className="font-bold text-amber-700 mb-3">⚠️ Needs Work ({weak.length} topics)</h3>
            {weak.length === 0 && (
              <p className="text-sm text-slate-400">No weak spots detected. Great!</p>
            )}
            <ul className="space-y-3">
              {weak.map((t, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-800 font-semibold">{t.name || t.topic}</span>
                    <span className="flex items-center gap-2">
                      <Dots value={t.mastery || 0} /> {t.mastery || 0}%
                    </span>
                  </div>
                  {t.note && <p className="text-xs text-slate-500 mt-1">{t.note}</p>}
                  {t.capsule_id && (
                    <button
                      onClick={() => navigate(`/student/classpulse?capsule=${t.capsule_id}`)}
                      className="mt-2 text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded font-semibold"
                    >
                      📦 Open Capsule
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white rounded-2xl border border-violet-100 p-5 shadow-sm grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 uppercase">Streak</p>
              <p className="text-2xl font-bold text-orange-600">🔥 {graph.streak || 0} sessions</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase">Improvement</p>
              <p className="text-2xl font-bold text-emerald-600">
                📈 +{graph.improvement_pct || 0}%
              </p>
            </div>
          </div>

          {graph.ai_insight && (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
              <h3 className="font-bold text-violet-800">💡 AI Insight</h3>
              <p className="text-sm text-slate-700 mt-1">{graph.ai_insight}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
