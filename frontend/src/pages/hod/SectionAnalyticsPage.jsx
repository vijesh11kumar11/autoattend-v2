/**
 * SectionAnalyticsPage — Cards per section with attendance donut,
 * defaulter count, worst subject badge.  API: GET /api/hod/section-analytics
 */
import { useEffect, useState } from 'react';
import api from '../../api/axios';

function DonutRing({ pct, size = 90, strokeWidth = 8 }) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  const color = pct >= 75 ? '#22c55e' : pct >= 65 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700"
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-slate-700 text-sm font-bold"
        transform={`rotate(90 ${size / 2} ${size / 2})`}
      >
        {pct}%
      </text>
    </svg>
  );
}

export default function SectionAnalyticsPage() {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/hod/section-analytics')
      .then((r) => setSections(r.data || []))
      .catch(() => setError('Failed to load section analytics.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading section analytics…</p>
      </div>
    );
  }
  if (error) return <div className="card p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="text-lg font-bold text-slate-800">📊 Section-wise Attendance Analytics</h2>
        <p className="text-sm text-slate-400 mt-1">
          Compare attendance performance across sections in your department.
        </p>
      </div>

      {sections.length === 0 ? (
        <div className="card p-8 text-center text-slate-400">No sections found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {sections.map((sec) => (
            <div
              key={sec.section_id}
              className={`card p-5 border ${sec.avg_pct < 65 ? 'border-red-200 bg-red-50/30' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Section {sec.section_name}</h3>
                  <p className="text-xs text-slate-400">
                    Semester {sec.semester} · {sec.student_count} students
                  </p>
                </div>
                <DonutRing pct={sec.avg_pct} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="text-center bg-slate-50 rounded-lg p-2">
                  <p className="text-xl font-bold text-slate-800">{sec.student_count}</p>
                  <p className="text-[10px] text-slate-400 uppercase">Students</p>
                </div>
                <div
                  className={`text-center rounded-lg p-2 ${sec.defaulter_count > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}
                >
                  <p
                    className={`text-xl font-bold ${sec.defaulter_count > 0 ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    {sec.defaulter_count}
                  </p>
                  <p className="text-[10px] text-slate-400 uppercase">Defaulters</p>
                </div>
              </div>

              {sec.worst_subject && (
                <div className="mt-3 px-3 py-2 bg-amber-50 rounded-lg text-xs">
                  <span className="text-amber-700 font-semibold">⚠️ Worst: </span>
                  <span className="text-amber-600">
                    {sec.worst_subject.subject_name} — {sec.worst_subject.avg_pct}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
