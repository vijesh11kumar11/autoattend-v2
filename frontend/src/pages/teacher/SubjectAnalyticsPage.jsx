/**
 * TRACELN v2.0 — Subject Analytics Page (PROMPT 6)
 *
 * • Per-student attendance table with weekly trend sparkline
 * • Day-of-week attendance pattern
 * • Anomaly flags
 * • Forecast for defaulters
 * • Smart follow-up suggestions
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';

const TREND_DOT = (pct) => {
  if (pct == null) return 'bg-slate-200';
  if (pct >= 75) return 'bg-green-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-red-500';
};

function MiniTrend({ weekly_trend }) {
  if (!weekly_trend?.length) return null;
  return (
    <div className="flex items-end gap-0.5 h-4">
      {weekly_trend.map((v, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full ${TREND_DOT(v)}`}
          style={{ height: v != null ? `${Math.max(15, v)}%` : '15%' }}
          title={v != null ? `Week ${i + 1}: ${v}%` : 'No data'}
        />
      ))}
    </div>
  );
}

export default function SubjectAnalyticsPage() {
  const { subjectId } = useParams();
  const navigate = useNavigate();

  const [analytics, setAnalytics] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [followup, setFollowup] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('students');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get(`/teacher/subject/${subjectId}/analytics`),
      api.get(`/analytics/anomalies?subject_id=${subjectId}`),
      api.get(`/teacher/subject/${subjectId}/suggest-followup`),
      api.get(`/analytics/subject-health/${subjectId}`),
    ])
      .then(([anRes, anomRes, fuRes, hRes]) => {
        if (cancelled) return;
        setAnalytics(anRes.data);
        setAnomalies(anomRes.data);
        setFollowup(Array.isArray(fuRes.data) ? fuRes.data : []);
        setHealth(hRes.data);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load analytics.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading analytics…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  const subj = analytics?.subject || {};
  const students = analytics?.per_student || [];
  const dayPattern = analytics?.day_pattern || [];
  const defaulters = analytics?.defaulter_list || [];
  const anomalyList = anomalies?.anomalies || [];
  const followupList = followup || [];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/teacher/dashboard')}
            className="text-sm text-slate-400 hover:text-slate-600 mb-1"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-xl font-bold text-slate-800">{subj.name}</h1>
          <p className="text-sm text-slate-400 font-mono">
            {subj.code} · Semester {subj.semester}
          </p>
        </div>
        {/* Health Score Badge */}
        {health?.health_score != null && (
          <div
            className={`text-center px-5 py-3 rounded-xl ${
              health.health_score >= 75
                ? 'bg-green-50 text-green-700'
                : health.health_score >= 50
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-red-50 text-red-700'
            }`}
          >
            <p className="text-3xl font-black">{health.health_score}</p>
            <p className="text-xs font-medium">Health Score</p>
          </div>
        )}
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{analytics?.total_sessions ?? 0}</p>
          <p className="text-xs text-slate-400">Sessions</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">{students.length}</p>
          <p className="text-xs text-slate-400">Students</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-slate-800">
            {analytics?.avg_session_duration ?? '—'}
          </p>
          <p className="text-xs text-slate-400">Avg Duration (min)</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{defaulters.length}</p>
          <p className="text-xs text-slate-400">Recent Defaulters</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{anomalyList.length}</p>
          <p className="text-xs text-slate-400">Anomalies</p>
        </div>
      </div>

      {/* ── Health Score Breakdown ── */}
      {health?.breakdown && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">Health Score Breakdown</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                label: 'Avg Attendance',
                value: health.breakdown.avg_attendance,
                max: 100,
                weight: '40%',
              },
              {
                label: 'Consistency',
                value: health.breakdown.consistency_score,
                max: 100,
                weight: '20%',
              },
              { label: 'Trend', value: health.breakdown.trend_score, max: 100, weight: '20%' },
              {
                label: 'Low Defaulters',
                value: health.breakdown.defaulter_score,
                max: 100,
                weight: '20%',
              },
            ].map((m) => (
              <div key={m.label} className="text-center">
                <div className="relative w-14 h-14 mx-auto mb-1">
                  <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9"
                      fill="none"
                      stroke={m.value >= 70 ? '#22c55e' : m.value >= 40 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="3"
                      strokeDasharray={`${m.value} 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                    {Math.round(m.value)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500">
                  {m.label} ({m.weight})
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Day-of-Week Pattern ── */}
      {dayPattern.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">
            📊 Day-of-Week Attendance Pattern
          </p>
          <div className="flex items-end gap-3 h-32">
            {dayPattern.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center">
                <span className="text-xs font-bold text-slate-700 mb-1">{d.avg_pct}%</span>
                <div
                  className={`w-full rounded-t-lg ${d.avg_pct >= 75 ? 'bg-green-400' : d.avg_pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ height: `${Math.max(10, d.avg_pct)}%` }}
                />
                <span className="text-[10px] text-slate-400 mt-1">{d.day.slice(0, 3)}</span>
                <span className="text-[9px] text-slate-300">{d.sessions}s</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {[
          { key: 'students', label: `Students (${students.length})` },
          { key: 'anomalies', label: `Anomalies (${anomalyList.length})` },
          { key: 'followup', label: `Follow-up (${followupList.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-sm rounded-md font-medium transition ${
              tab === t.key
                ? 'bg-white shadow text-slate-800'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Students ── */}
      {tab === 'students' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b bg-slate-50">
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Student</th>
                <th className="px-4 py-2 text-left">Roll No</th>
                <th className="px-4 py-2 text-center">Present</th>
                <th className="px-4 py-2 text-center">Total</th>
                <th className="px-4 py-2 text-center">%</th>
                <th className="px-4 py-2 text-center">4-Week Trend</th>
                <th className="px-4 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {students.map((s, i) => (
                <tr
                  key={s.student_id}
                  className={`hover:bg-slate-50 ${s.needs_attention ? 'bg-red-50/30' : ''}`}
                >
                  <td className="px-4 py-2 text-xs text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2 text-sm font-medium text-slate-700">{s.name}</td>
                  <td className="px-4 py-2 text-sm text-slate-500 font-mono">{s.roll_number}</td>
                  <td className="px-4 py-2 text-sm text-center">{s.present}</td>
                  <td className="px-4 py-2 text-sm text-center">{s.total}</td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className={`text-sm font-bold ${s.pct >= 75 ? 'text-green-600' : 'text-red-600'}`}
                    >
                      {s.pct}%
                    </span>
                  </td>
                  <td className="px-4 py-2 flex justify-center">
                    <MiniTrend weekly_trend={s.weekly_trend} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    {s.needs_attention ? (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-semibold">
                        At Risk
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px] font-semibold">
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {students.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-sm">No student data yet.</div>
          )}
        </div>
      )}

      {/* ── Tab: Anomalies ── */}
      {tab === 'anomalies' && (
        <div className="space-y-3">
          {anomalyList.length === 0 ? (
            <div className="card p-8 text-center text-slate-400 text-sm">
              No anomalies detected. All clear!
            </div>
          ) : (
            anomalyList.map((a, i) => (
              <div
                key={i}
                className={`card p-4 border-l-4 ${
                  a.severity === 'high' ? 'border-red-500' : 'border-amber-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        a.severity === 'high'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {a.type.replace('_', ' ')}
                    </span>
                    {a.date && <span className="text-xs text-slate-400">{a.date}</span>}
                  </div>
                  <span
                    className={`text-[10px] font-semibold ${
                      a.severity === 'high' ? 'text-red-500' : 'text-amber-500'
                    }`}
                  >
                    {a.severity.toUpperCase()}
                  </span>
                </div>
                <p className="text-sm text-slate-700 mt-1">{a.detail}</p>
                {a.students && (
                  <p className="text-xs text-slate-400 mt-1">Involved: {a.students.join(', ')}</p>
                )}
                {a.student && (
                  <p className="text-xs text-slate-400 mt-1">
                    Student: {a.student} {a.roll_number && `(${a.roll_number})`}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Tab: Follow-up Suggestions ── */}
      {tab === 'followup' && (
        <div className="space-y-3">
          {followupList.length === 0 ? (
            <div className="card p-8 text-center text-slate-400 text-sm">
              No follow-up suggestions for this week.
            </div>
          ) : (
            followupList.map((f, i) => (
              <div
                key={i}
                className={`card p-4 border-l-4 ${
                  f.priority === 'high'
                    ? 'border-red-500'
                    : f.priority === 'medium'
                      ? 'border-amber-400'
                      : 'border-blue-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-800">{f.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{f.roll_number}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      f.priority === 'high'
                        ? 'bg-red-100 text-red-700'
                        : f.priority === 'medium'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {f.priority}
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-2">{f.reason_guess}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                  <span>
                    Absent {f.absent_count}/{f.total_sessions} sessions
                  </span>
                  {f.has_approved_leave && (
                    <span className="text-green-600">✓ Has approved leave</span>
                  )}
                </div>
                {f.absent_dates?.length > 0 && (
                  <p className="text-[10px] text-slate-300 mt-1">
                    Dates: {f.absent_dates.join(', ')}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
