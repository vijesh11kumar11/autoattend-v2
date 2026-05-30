/**
 * Teacher Pre-Class Brief — shown 30 min before a live session starts.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/axios';

const VIOLET = 'from-violet-600 via-purple-600 to-fuchsia-600';

export default function TeacherPreClassBrief() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .get('/live/pre-class-brief', { params: { session_id: sessionId } })
      .then((r) => setBrief(r.data))
      .catch((e) => setErr(e.response?.data?.detail || 'Failed to load brief'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div className="p-10 text-center text-slate-400">Loading pre-class brief…</div>;
  }
  if (err) {
    return <div className="bg-red-50 text-red-700 p-4 rounded-lg">{err}</div>;
  }

  const readiness = brief?.readiness_score ?? 0;
  const needs = brief?.students_needing_attention || [];
  const concepts = brief?.predicted_difficult_concepts || [];

  const sendResource = async (studentId) => {
    try {
      await api.post('/notifications/push', {
        user_id: studentId,
        message: 'Pre-class resource sent.',
      });
    } catch {
      /* ignore — endpoint may not exist */
    }
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className={`bg-gradient-to-r ${VIOLET} rounded-2xl p-6 text-white shadow-lg`}>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <span className="text-3xl">📋</span> Pre-Class Brief
        </h1>
        <p className="text-white/80 mt-1 text-sm">
          {brief?.subject_name || ''}{' '}
          {brief?.scheduled_at ? `· ${new Date(brief.scheduled_at).toLocaleString()}` : ''}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-violet-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-700">Class Readiness</span>
          <span className="text-2xl font-black text-violet-700">{readiness}%</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-700"
            style={{ width: `${readiness}%` }}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-sm">
        <h3 className="font-bold text-slate-800 mb-3">⚠️ Needs Attention ({needs.length})</h3>
        {needs.length === 0 && <p className="text-sm text-slate-400">All students look ready.</p>}
        <ul className="divide-y divide-slate-100">
          {needs.map((s) => (
            <li key={s.student_id || s.id} className="py-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm text-slate-800">{s.name}</p>
                <p className="text-xs text-slate-500">
                  {s.reason || s.weakness || 'Needs follow-up'}
                </p>
              </div>
              <button
                onClick={() => sendResource(s.student_id || s.id)}
                className="text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded font-semibold"
              >
                Send resource
              </button>
            </li>
          ))}
        </ul>
      </div>

      {brief?.ai_suggestion && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
          <h3 className="font-bold text-violet-800">💡 AI Suggestion</h3>
          <p className="text-sm text-slate-700 mt-1">{brief.ai_suggestion}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-violet-100 p-5 shadow-sm">
        <h3 className="font-bold text-slate-800 mb-3">📚 Predicted Difficult Concepts</h3>
        <ul className="space-y-2">
          {concepts.length === 0 && (
            <li className="text-sm text-slate-400">AI hasn't flagged any concepts yet.</li>
          )}
          {concepts.map((c, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">• {c.name || c.concept || c}</span>
              <span>{(c.difficulty || 'medium') === 'high' ? '⚠️' : '✅'}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={() => navigate('/teacher/live')}
        className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold"
      >
        ← Back to Live Dashboard
      </button>
    </div>
  );
}
