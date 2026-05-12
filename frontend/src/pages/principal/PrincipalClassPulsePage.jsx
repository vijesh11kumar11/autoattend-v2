/**
 * Principal ClassPulse — institution-wide aggregate of HOD analytics.
 *
 * Strategy:
 *   1. Fetch /api/principal/stats → list of departments {id, name}
 *   2. For each dept, call /api/classpulse/hod/department-analytics?department_id=ID
 *   3. Aggregate client-side
 *
 * Sections:
 *   - Institution-wide stats
 *   - Department comparison table (sorted by worst comprehension first)
 *   - Top performing subject (green)
 *   - Most struggling department (red)
 *   - Export full report (CSV download)
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';

const pctText = (p) => p >= 70 ? 'text-emerald-600' : p >= 50 ? 'text-amber-600' : 'text-red-600';

export default function PrincipalClassPulsePage() {
  const [depts,    setDepts]    = useState([]);
  const [reports,  setReports]  = useState({}); // dept_id → analytics
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/api/principal/stats')
      .then(r => {
        if (cancelled) return;
        const deptList = r.data?.departments || [];
        setDepts(deptList);
        return Promise.all(deptList.map(d =>
          api.get(`/api/classpulse/hod/department-analytics?department_id=${d.id}`)
            .then(rep => ({ id: d.id, data: rep.data }))
            .catch(() => ({ id: d.id, data: null }))
        ));
      })
      .then(results => {
        if (cancelled || !results) return;
        const map = {};
        results.forEach(({ id, data }) => { if (data) map[id] = data; });
        setReports(map);
      })
      .catch(e => setErr(e?.response?.data?.detail || 'Failed to load institution analytics'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  // Aggregate
  const agg = useMemo(() => {
    const rows = depts.map(d => {
      const rep = reports[d.id];
      const stats = rep?.department_stats || {};
      const subjects = rep?.subjects_overview || [];
      return {
        dept_id: d.id,
        dept_name: d.name,
        total_capsules: stats.total_capsules || 0,
        avg_engagement: stats.avg_engagement_pct || 0,
        avg_comprehension: stats.avg_comprehension_pct || 0,
        at_risk: stats.students_at_risk_count || 0,
        subjects,
      };
    });
    // institution totals
    const totalCapsules = rows.reduce((a, r) => a + r.total_capsules, 0);
    const totalAtRisk   = rows.reduce((a, r) => a + r.at_risk, 0);
    const counted       = rows.filter(r => r.total_capsules > 0);
    const instEngagement    = counted.length ? Math.round((counted.reduce((a, r) => a + r.avg_engagement, 0) / counted.length) * 10) / 10 : 0;
    const instComprehension = counted.length ? Math.round((counted.reduce((a, r) => a + r.avg_comprehension, 0) / counted.length) * 10) / 10 : 0;
    // top performing subject across institution (highest comprehension with capsules)
    let topSubject = null;
    rows.forEach(r => r.subjects.forEach(s => {
      if ((s.total_capsules || 0) === 0) return;
      if (!topSubject || s.avg_comprehension_pct > topSubject.avg_comprehension_pct) {
        topSubject = { ...s, dept_name: r.dept_name };
      }
    }));
    // most struggling dept
    const struggling = [...rows].filter(r => r.total_capsules > 0).sort((a, b) => a.avg_comprehension - b.avg_comprehension)[0] || null;
    return {
      rows: [...rows].sort((a, b) => a.avg_comprehension - b.avg_comprehension),
      institution: {
        totalCapsules, totalAtRisk, instEngagement, instComprehension,
        deptCount: rows.length,
      },
      topSubject,
      struggling,
    };
  }, [depts, reports]);

  const exportCSV = () => {
    const header = ['Department', 'Capsules', 'Avg Engagement %', 'Avg Comprehension %', 'Students at Risk'];
    const lines = [header.join(',')];
    agg.rows.forEach(r => {
      lines.push([
        `"${r.dept_name}"`, r.total_capsules, r.avg_engagement, r.avg_comprehension, r.at_risk
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `classpulse_institution_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-8 text-slate-400 text-sm animate-pulse">Loading institution analytics…</div>;
  if (err)     return <div className="p-8 text-red-500 text-sm">{err}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">📚 ClassPulse — Institution Overview</h2>
          <p className="text-xs text-slate-500">Aggregated across {agg.institution.deptCount} departments</p>
        </div>
        <button onClick={exportCSV} className="text-xs font-semibold bg-slate-800 hover:bg-slate-900 text-white rounded-lg px-3 py-2">
          ⬇️ Export CSV
        </button>
      </div>

      {/* Institution-wide stats */}
      <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon="📚" label="Total Capsules"     value={agg.institution.totalCapsules} />
        <Tile icon="👀" label="Avg Engagement"     value={`${agg.institution.instEngagement}%`}    tone={pctText(agg.institution.instEngagement)} />
        <Tile icon="🧠" label="Avg Comprehension"  value={`${agg.institution.instComprehension}%`} tone={pctText(agg.institution.instComprehension)} />
        <Tile icon="⚠️" label="Students at Risk"   value={agg.institution.totalAtRisk}             tone={agg.institution.totalAtRisk > 0 ? 'text-red-600' : 'text-slate-700'} />
      </div>

      {/* Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agg.topSubject ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">🌟 Top Performing Subject</p>
            <p className="text-lg font-bold text-emerald-800 mt-1">{agg.topSubject.subject_name}</p>
            <p className="text-xs text-emerald-700">{agg.topSubject.dept_name} · {agg.topSubject.teacher_name || '—'}</p>
            <div className="flex gap-4 mt-2 text-xs text-emerald-700">
              <span>🧠 {agg.topSubject.avg_comprehension_pct}% comprehension</span>
              <span>👀 {agg.topSubject.avg_engagement_pct}% engagement</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm text-slate-500">No top subject yet.</div>
        )}

        {agg.struggling ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">🚨 Most Struggling Department</p>
            <p className="text-lg font-bold text-red-800 mt-1">{agg.struggling.dept_name}</p>
            <div className="flex gap-4 mt-2 text-xs text-red-700">
              <span>🧠 {agg.struggling.avg_comprehension}% comprehension</span>
              <span>⚠️ {agg.struggling.at_risk} at risk</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm text-slate-500">All departments healthy.</div>
        )}
      </div>

      {/* Department comparison table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <h3 className="text-sm font-bold text-slate-800 mb-3">📊 Department Comparison (worst comprehension first)</h3>
        {agg.rows.length === 0 ? (
          <p className="text-sm text-slate-400">No departments.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="py-2 pr-2">Department</th>
                  <th className="py-2 pr-2">Capsules</th>
                  <th className="py-2 pr-2">Avg Engagement</th>
                  <th className="py-2 pr-2">Avg Comprehension</th>
                  <th className="py-2">At Risk</th>
                </tr>
              </thead>
              <tbody>
                {agg.rows.map(r => (
                  <tr key={r.dept_id} className="border-b border-slate-50">
                    <td className="py-2 pr-2 font-semibold text-slate-800">{r.dept_name}</td>
                    <td className="py-2 pr-2">{r.total_capsules}</td>
                    <td className={`py-2 pr-2 font-bold ${pctText(r.avg_engagement)}`}>{r.avg_engagement}%</td>
                    <td className={`py-2 pr-2 font-bold ${pctText(r.avg_comprehension)}`}>{r.avg_comprehension}%</td>
                    <td className={`py-2 font-bold ${r.at_risk > 0 ? 'text-red-600' : 'text-slate-700'}`}>{r.at_risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, value, tone }) {
  return (
    <div className="flex flex-col items-center text-center px-2">
      <span className="text-xl">{icon}</span>
      <span className={`text-xl font-extrabold mt-1 ${tone || 'text-slate-800'}`}>{value}</span>
      <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wide">{label}</span>
    </div>
  );
}
