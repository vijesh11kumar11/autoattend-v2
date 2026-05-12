/**
 * Session Health Report — post-session analytics (Prompt 4 file 3).
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/axios';

const VIOLET = 'from-violet-600 via-purple-600 to-fuchsia-600';

function HealthRing({ score }) {
  const r = 70, c = 2 * Math.PI * r;
  const off = c - (Math.min(score, 100) / 100) * c;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-44 h-44 mx-auto">
      <svg viewBox="0 0 160 160" className="-rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        <circle cx="80" cy="80" r={r} fill="none" stroke={color} strokeWidth="14"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-black" style={{color}}>{score}</span>
        <span className="text-xs text-slate-500 uppercase tracking-wide">Health Score</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, suffix = '%' }) {
  return (
    <div className="bg-white border border-violet-100 rounded-xl p-4 text-center">
      <p className="text-xs text-slate-500 uppercase font-semibold">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value ?? 0}{suffix}</p>
    </div>
  );
}

export default function SessionHealthReport() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sortKey, setSortKey] = useState('attendance');

  useEffect(() => {
    api.get(`/live/sessions/${sessionId}/health-report`)
      .then(r => setReport(r.data))
      .catch(e => setErr(e.response?.data?.detail || 'Failed to load report'))
      .finally(()=>setLoading(false));
  }, [sessionId]);

  if (loading) return <div className="p-10 text-center text-slate-400">Loading health report…</div>;
  if (err) return <div className="bg-red-50 text-red-700 p-4 rounded-lg">{err}</div>;
  if (!report) return null;

  const students = [...(report.per_student || [])].sort((a,b)=>(b[sortKey]||0)-(a[sortKey]||0));
  const events   = report.timeline || report.ai_events || [];
  const moments  = report.confusion_moments || [];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className={`bg-gradient-to-r ${VIOLET} rounded-2xl p-6 text-white shadow-lg`}>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <span className="text-3xl">📊</span> Session Health Report
        </h1>
        <p className="text-white/80 mt-1 text-sm">{report.title || `Session #${sessionId}`}</p>
      </div>

      <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-6">
        <HealthRing score={report.health_score || 0} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <MetricCard label="Attendance"     value={report.attendance_percentage} />
          <MetricCard label="Engagement"     value={report.engagement_score} />
          <MetricCard label="Comprehension"  value={report.comprehension_score} />
          <MetricCard label="Pace"           value={report.pace_score} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-5">
        <h3 className="font-bold text-slate-800 mb-3">⏱️ AI Event Timeline</h3>
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {events.length === 0 && <li className="text-sm text-slate-400">No events recorded.</li>}
          {events.map((e,i) => (
            <li key={i} className="text-sm flex items-start gap-3">
              <span className="text-xs text-slate-400 w-16 flex-shrink-0">
                {(e.time || e.created_at || '').toString().slice(11,16)}
              </span>
              <span className="text-slate-700">{e.message || e.observation || e.type}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800">👥 Per-Student Performance</h3>
          <select value={sortKey} onChange={e=>setSortKey(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1">
            <option value="attendance">Sort: Attendance</option>
            <option value="engagement">Sort: Engagement</option>
            <option value="comprehension">Sort: Comprehension</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase border-b">
              <tr>
                <th className="text-left py-2">Student</th>
                <th className="text-right py-2">Attendance</th>
                <th className="text-right py-2">Engagement</th>
                <th className="text-right py-2">Comprehension</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-slate-400">No data</td></tr>
              )}
              {students.map(s => (
                <tr key={s.student_id} className="border-b border-slate-50">
                  <td className="py-2">{s.name}</td>
                  <td className="py-2 text-right">{s.attendance ?? 0}%</td>
                  <td className="py-2 text-right">{s.engagement ?? 0}%</td>
                  <td className="py-2 text-right">{s.comprehension ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {moments.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5">
          <h3 className="font-bold text-amber-700 mb-2">⚠️ Confusion Moments</h3>
          <ul className="space-y-2 text-sm text-slate-700">
            {moments.map((m,i) => (
              <li key={i}>
                <span className="text-xs text-slate-400 mr-2">{(m.time||'').slice(11,16)}</span>
                {m.description || m.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.next_class_recommendations && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
          <h3 className="font-bold text-violet-800 mb-2">💡 Next-Class Recommendations</h3>
          <p className="text-sm text-slate-700">{report.next_class_recommendations}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button onClick={()=>navigate('/teacher/classpulse')}
          className={`py-3 rounded-xl text-white font-bold bg-gradient-to-r ${VIOLET}`}>
          📦 View Generated Capsule
        </button>
        <button onClick={()=>window.print()}
          className="py-3 rounded-xl bg-slate-100 text-slate-700 font-bold">
          📥 Export PDF
        </button>
      </div>
    </div>
  );
}
