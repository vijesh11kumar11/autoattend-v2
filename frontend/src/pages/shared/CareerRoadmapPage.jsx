/**
 * AutoAttend AI v2.0 — Career Roadmap Generator
 * Shared across all roles with role-specific content.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';

/* ═══════════════════════════════════════════════════════════════════════
   ROLE CONFIG
   ═══════════════════════════════════════════════════════════════════════ */
const ROLE_CFG = {
  student: {
    banner: { title: '🎯 Your Career Roadmap', sub: 'Plan your path from student to tech professional', bg: 'from-[#1a237e] to-[#283593]' },
    goals: ['Full Stack Developer','Data Scientist','AI/ML Engineer','DevOps Engineer','Cybersecurity Analyst','Mobile App Developer','Cloud Architect','Blockchain Developer','UI/UX Designer','Product Manager','Game Developer','Embedded Systems Engineer'],
    skillHints: ['Python','JavaScript','React','Java','SQL','Git','HTML/CSS','Node.js','C++','Machine Learning'],
    hoursLabel: 'Study hours',
    levels: [
      { key:'beginner', icon:'🌱', label:'Beginner', desc:'Just starting my tech journey' },
      { key:'intermediate', icon:'🔥', label:'Intermediate', desc:'Built some projects already' },
      { key:'advanced', icon:'🚀', label:'Advanced', desc:'Ready for industry-level work' },
    ],
    loadingSteps: ['Analysing your subjects...','Checking your attendance data...','Consulting Gemini AI...','Building your roadmap...'],
    phaseKey: 'projects',
    phaseLabel: 'Projects',
  },
  teacher: {
    banner: { title: '🏆 Your Growth Roadmap', sub: 'Advance your academic and professional career', bg: 'from-[#4a148c] to-[#6a1b9a]' },
    goals: ['Senior Professor','Research Scientist','EdTech Entrepreneur','Academic Dean','Curriculum Designer','Education Consultant','PhD Research Scholar','Corporate Trainer','Technical Author','Education Policy Advisor'],
    skillHints: ['Curriculum Design','Research','Python','Data Analysis','Online Teaching','Publication Writing','Pedagogy','EdTech Tools'],
    hoursLabel: 'Self-development hours',
    levels: [
      { key:'beginner', icon:'🌱', label:'Beginner', desc:'Teaching for a few years' },
      { key:'intermediate', icon:'🔥', label:'Intermediate', desc:'Established educator' },
      { key:'advanced', icon:'🚀', label:'Advanced', desc:'Senior academic professional' },
    ],
    loadingSteps: ['Reviewing your teaching profile...','Analysing your class performance...','Consulting Gemini AI...','Building your growth roadmap...'],
    phaseKey: 'initiatives',
    phaseLabel: 'Initiatives',
  },
  hod: {
    banner: { title: '🌟 Leadership Roadmap', sub: 'Chart your path to academic leadership excellence', bg: 'from-[#004d40] to-[#00695c]' },
    goals: ['University Dean','Academic Director','Education Researcher','Autonomous College Principal','NAAC Coordinator','Education Ministry Advisor','International Collaboration Lead','Accreditation Expert','Higher Education Consultant'],
    skillHints: ['Academic Administration','Policy Making','NAAC','Research Management','Strategic Planning','Team Leadership','Accreditation'],
    hoursLabel: 'Professional development hours',
    levels: [
      { key:'beginner', icon:'🌱', label:'Beginner', desc:'Leading a department' },
      { key:'intermediate', icon:'🔥', label:'Intermediate', desc:'Experienced department head' },
      { key:'advanced', icon:'🚀', label:'Advanced', desc:'Ready for institutional leadership' },
    ],
    loadingSteps: ['Reviewing your department metrics...','Analysing team performance...','Consulting Gemini AI...','Building your leadership roadmap...'],
    phaseKey: 'initiatives',
    phaseLabel: 'Initiatives',
  },
  principal: {
    banner: { title: '👑 Executive Roadmap', sub: 'Shape the future of education leadership', bg: 'from-[#4a0000] to-[#880e4f]' },
    goals: ['University Vice Chancellor','Education Board Member','NAAC Peer Team Member','National Education Policy Contributor','International University Collaboration Expert','Education Research Publisher'],
    skillHints: ['Institutional Management','Accreditation','Strategic Planning','Policy Development','International Relations','Research Publishing'],
    hoursLabel: 'Leadership development hours',
    levels: [
      { key:'beginner', icon:'🌱', label:'Beginner', desc:'Running an institution' },
      { key:'intermediate', icon:'🔥', label:'Intermediate', desc:'Experienced institutional leader' },
      { key:'advanced', icon:'🚀', label:'Advanced', desc:'National-level influence' },
    ],
    loadingSteps: ['Reviewing institutional data...','Analysing leadership scope...','Consulting Gemini AI...','Building your executive roadmap...'],
    phaseKey: 'initiatives',
    phaseLabel: 'Initiatives',
  },
};

const GOAL_ICONS = {
  'Full Stack Developer':'💻','Data Scientist':'📊','AI/ML Engineer':'🤖','DevOps Engineer':'⚙️',
  'Cybersecurity Analyst':'🔒','Mobile App Developer':'📱','Cloud Architect':'☁️','Blockchain Developer':'🔗',
  'UI/UX Designer':'🎨','Product Manager':'📋','Game Developer':'🎮','Embedded Systems Engineer':'🔌',
  'Senior Professor':'🎓','Research Scientist':'🔬','EdTech Entrepreneur':'💡','Academic Dean':'🏛️',
  'Curriculum Designer':'📐','Education Consultant':'🧠','PhD Research Scholar':'📚','Corporate Trainer':'👔',
  'Technical Author':'✍️','Education Policy Advisor':'📜','University Dean':'🏛️','Academic Director':'📋',
  'Education Researcher':'🔬','Autonomous College Principal':'🏫','NAAC Coordinator':'✅',
  'Education Ministry Advisor':'🏛️','International Collaboration Lead':'🌍','Accreditation Expert':'📋',
  'Higher Education Consultant':'🎓','University Vice Chancellor':'👑','Education Board Member':'📋',
  'NAAC Peer Team Member':'✅','National Education Policy Contributor':'📜',
  'International University Collaboration Expert':'🌍','Education Research Publisher':'📚',
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */
export default function CareerRoadmapPage() {
  const { user } = useAuth();
  const role = user?.role || 'student';
  const cfg = ROLE_CFG[role] || ROLE_CFG.student;

  // Form state
  const [goal, setGoal] = useState('');
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState('');
  const [hours, setHours] = useState(10);
  const [level, setLevel] = useState('beginner');

  // Results state
  const [roadmap, setRoadmap] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('roadmap');

  // Saved
  const [saved, setSaved] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [viewingSaved, setViewingSaved] = useState(null);

  // Load saved roadmaps
  useEffect(() => {
    api.get('/career/saved').then(r => setSaved(r.data)).catch(() => {});
  }, []);

  // Loading animation
  useEffect(() => {
    if (!loading) return;
    setLoadingStep(0);
    const steps = cfg.loadingSteps;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i < steps.length) setLoadingStep(i);
      else clearInterval(iv);
    }, 2500);
    return () => clearInterval(iv);
  }, [loading]);

  const addSkill = () => {
    const s = skillInput.trim();
    if (s && !skills.includes(s) && skills.length < 15) {
      setSkills(prev => [...prev, s]);
      setSkillInput('');
    }
  };

  const removeSkill = (s) => setSkills(prev => prev.filter(x => x !== s));

  const generate = async () => {
    if (!goal) { setError('Please select a career goal'); return; }
    setError('');
    setLoading(true);
    setRoadmap(null);
    setActiveTab('roadmap');
    try {
      const r = await api.post('/career/generate', {
        career_goal: goal,
        current_skills: skills,
        hours_per_week: hours,
        experience_level: level,
      });
      setRoadmap(r.data.roadmap);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to generate roadmap. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const saveRoadmap = async () => {
    if (!roadmap) return;
    setSaving(true);
    try {
      await api.post('/career/save', { career_goal: goal, roadmap_data: roadmap });
      setToast('Roadmap saved successfully!');
      const r = await api.get('/career/saved');
      setSaved(r.data);
      setTimeout(() => setToast(''), 3000);
    } catch {
      setToast('Failed to save');
      setTimeout(() => setToast(''), 3000);
    } finally {
      setSaving(false);
    }
  };

  const shareRoadmap = () => {
    if (!roadmap) return;
    const text = `🎯 Career Roadmap: ${roadmap.career_title}\n${roadmap.role_context}\n\n${roadmap.overview}\n\nPhases:\n${(roadmap.phases || []).map(p => `${p.phase_number}. ${p.title} (${p.duration})`).join('\n')}\n\nGenerated by AutoAttend AI`;
    navigator.clipboard.writeText(text);
    setToast('Copied to clipboard!');
    setTimeout(() => setToast(''), 3000);
  };

  const resetForm = () => {
    setRoadmap(null);
    setGoal('');
    setSkills([]);
    setLevel('beginner');
    setHours(10);
    setViewingSaved(null);
  };

  const viewSavedRoadmap = (s) => {
    setRoadmap(s.roadmap_data);
    setGoal(s.career_goal);
    setViewingSaved(s.id);
    setActiveTab('roadmap');
  };

  const data = roadmap; // alias

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm animate-fade-in">
          {toast}
        </div>
      )}

      {/* ── Banner ── */}
      <div className={`bg-gradient-to-r ${cfg.banner.bg} rounded-2xl p-6 md:p-8 text-white`}>
        <h1 className="text-2xl md:text-3xl font-bold">{cfg.banner.title}</h1>
        <p className="text-white/70 mt-1 text-sm">{cfg.banner.sub}</p>
      </div>

      {/* ── Saved Roadmaps ── */}
      {saved.length > 0 && !data && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Saved Roadmaps</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {saved.map(s => (
              <button key={s.id} onClick={() => viewSavedRoadmap(s)}
                className={`flex-shrink-0 bg-white border rounded-xl p-3 text-left hover:shadow-md transition-all min-w-[220px]
                  ${viewingSaved === s.id ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">{s.user_role}</span>
                  <span className="text-[10px] text-slate-400">{new Date(s.generated_at).toLocaleDateString()}</span>
                </div>
                <p className="text-sm font-semibold text-slate-700 truncate">{s.career_goal}</p>
              </button>
            ))}
          </div>
        </div>
      )}
      {saved.length === 0 && !data && (
        <div className="bg-white rounded-xl border border-slate-100 p-4 text-center text-sm text-slate-400">
          No saved roadmaps yet. Generate your first one!
        </div>
      )}

      {/* ── FORM (show when no roadmap result) ── */}
      {!data && !loading && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-6">
          {/* Goal selection */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-3">Choose Your Career Goal</label>
            {error && <p className="text-red-500 text-xs mb-2">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cfg.goals.map(g => (
                <button key={g} onClick={() => { setGoal(g); setError(''); }}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all duration-200
                    hover:-translate-y-0.5 hover:shadow-md
                    ${goal === g
                      ? 'border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-100'
                      : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                  <span className="text-2xl">{GOAL_ICONS[g] || '🎯'}</span>
                  <span className={`text-sm font-medium ${goal === g ? 'text-indigo-700' : 'text-slate-700'}`}>{g}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Skills */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Current Skills / Expertise</label>
            <div className="flex gap-2 mb-2">
              <input value={skillInput} onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); }}}
                placeholder="Type a skill and press Enter"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <button onClick={addSkill} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200">Add</button>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {skills.map(s => (
                <span key={s} className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">
                  {s}
                  <button onClick={() => removeSkill(s)} className="hover:text-red-500">×</button>
                </span>
              ))}
            </div>
            {skills.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-slate-400 mr-1">Suggestions:</span>
                {cfg.skillHints.slice(0, 6).map(h => (
                  <button key={h} onClick={() => !skills.includes(h) && setSkills(p => [...p, h])}
                    className="text-xs px-2.5 py-1 bg-slate-50 text-slate-500 rounded-full hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                    + {h}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Hours slider */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              {cfg.hoursLabel}: <span className="text-indigo-600">{hours} hrs/week</span>
            </label>
            <input type="range" min={5} max={30} value={hours} onChange={e => setHours(+e.target.value)}
              className="w-full accent-indigo-600" />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>5 hrs</span><span>15 hrs</span><span>30 hrs</span>
            </div>
          </div>

          {/* Experience level */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-3">Current Level</label>
            <div className="grid grid-cols-3 gap-3">
              {cfg.levels.map(l => (
                <button key={l.key} onClick={() => setLevel(l.key)}
                  className={`p-3 rounded-xl border-2 text-center transition-all duration-200
                    ${level === l.key
                      ? 'border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-100'
                      : 'border-slate-100 hover:border-slate-200'}`}>
                  <span className="text-2xl block mb-1">{l.icon}</span>
                  <p className={`text-sm font-semibold ${level === l.key ? 'text-indigo-700' : 'text-slate-700'}`}>{l.label}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{l.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button onClick={generate}
            className={`w-full py-3.5 rounded-xl text-white font-semibold text-sm bg-gradient-to-r ${cfg.banner.bg}
              hover:opacity-90 transition-all shadow-lg shadow-indigo-200/50`}>
            ✨ Generate My Roadmap
          </button>
        </div>
      )}

      {/* ── LOADING ── */}
      {loading && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center space-y-6">
          <div className="w-16 h-16 mx-auto border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
          <div className="space-y-3 max-w-xs mx-auto">
            {cfg.loadingSteps.map((step, i) => (
              <div key={i} className={`flex items-center gap-3 text-sm transition-all duration-500
                ${i <= loadingStep ? 'opacity-100' : 'opacity-20'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                  ${i < loadingStep ? 'bg-emerald-500 text-white' : i === loadingStep ? 'bg-indigo-600 text-white animate-pulse' : 'bg-slate-200 text-slate-400'}`}>
                  {i < loadingStep ? '✓' : i + 1}
                </span>
                <span className={i <= loadingStep ? 'text-slate-700' : 'text-slate-400'}>{step}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">This may take 10–20 seconds</p>
        </div>
      )}

      {/* ── RESULTS ── */}
      {data && !loading && (
        <div className="space-y-6 animate-fade-in">
          {/* Hero */}
          <div className={`bg-gradient-to-r ${cfg.banner.bg} rounded-2xl p-6 md:p-8 text-white`}>
            <h2 className="text-2xl md:text-3xl font-bold mb-1">{data.career_title}</h2>
            <p className="text-white/70 text-sm mb-4">{data.role_context}</p>
            <div className="flex flex-wrap gap-2">
              {data.market_demand?.demand_level && (
                <span className="px-3 py-1 bg-white/20 rounded-full text-xs font-medium backdrop-blur-sm">
                  📈 {data.market_demand.demand_level} Demand
                </span>
              )}
              {data.market_demand?.avg_salary_india && (
                <span className="px-3 py-1 bg-white/20 rounded-full text-xs font-medium backdrop-blur-sm">
                  💰 {data.market_demand.avg_salary_india}
                </span>
              )}
              {data.estimated_timeline && (
                <span className="px-3 py-1 bg-white/20 rounded-full text-xs font-medium backdrop-blur-sm">
                  ⏱ {data.estimated_timeline}
                </span>
              )}
              {data.difficulty && (
                <span className="px-3 py-1 bg-white/20 rounded-full text-xs font-medium backdrop-blur-sm">
                  🎯 {data.difficulty}
                </span>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {[
              { key:'roadmap', label:'Roadmap', icon:'🗺️' },
              { key:'market', label:'Market Insights', icon:'📊' },
              { key:'certs', label:'Opportunities', icon:'🏆' },
              { key:'tips', label:'Personalized Tips', icon:'💡' },
            ].map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all
                  ${activeTab === t.key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                <span>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Roadmap ── */}
          {activeTab === 'roadmap' && (
            <div className="space-y-1">
              <p className="text-sm text-slate-500 mb-4">{data.overview}</p>
              <div className="relative pl-8">
                {/* Vertical timeline line */}
                <div className="absolute left-3.5 top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-400 via-indigo-300 to-slate-200" />
                {(data.phases || []).map((phase, i) => (
                  <div key={i} className="relative mb-8 last:mb-0">
                    {/* Timeline dot */}
                    <div className="absolute -left-8 top-0 w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-md shadow-indigo-200 z-10">
                      {phase.phase_number || i + 1}
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-bold text-slate-800">{phase.title}</h3>
                        <span className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-full font-medium">{phase.duration}</span>
                      </div>
                      <p className="text-sm text-slate-500 mb-4">{phase.description}</p>
                      {/* Skills */}
                      {phase.skills?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Skills</p>
                          <div className="flex flex-wrap gap-1.5">
                            {phase.skills.map((s, j) => (
                              <span key={j} className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Projects / Initiatives */}
                      {(phase[cfg.phaseKey] || phase.projects || phase.initiatives)?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-400 uppercase mb-1.5">{cfg.phaseLabel}</p>
                          <div className="space-y-1.5">
                            {(phase[cfg.phaseKey] || phase.projects || phase.initiatives).map((p, j) => (
                              <div key={j} className="flex items-start gap-2 text-sm text-slate-600">
                                <span className="text-indigo-400 mt-0.5 flex-shrink-0">▸</span>
                                <span>{p}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Resources */}
                      {phase.resources?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase mb-1.5">Resources</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {phase.resources.map((r, j) => (
                              <a key={j} href={r.url} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-indigo-50 transition-colors text-sm">
                                <span className="text-base">{r.type === 'YouTube' ? '📺' : r.type === 'Course' ? '🎓' : r.type === 'Book' ? '📕' : '🌐'}</span>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-slate-700 truncate">{r.name}</p>
                                  <p className="text-[10px] text-slate-400">{r.type}</p>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Tab: Market Insights ── */}
          {activeTab === 'market' && data.market_demand && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Average Package in India</p>
                <p className="text-3xl font-bold text-slate-800">{data.market_demand.avg_salary_india}</p>
                {data.market_demand.avg_package_or_increment && (
                  <p className="text-sm text-emerald-600 mt-1">📈 {data.market_demand.avg_package_or_increment}</p>
                )}
              </div>
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Market Demand</p>
                <span className={`inline-block px-4 py-2 rounded-full text-sm font-bold
                  ${data.market_demand.demand_level === 'High' ? 'bg-emerald-100 text-emerald-700' :
                    data.market_demand.demand_level === 'Medium' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'}`}>
                  {data.market_demand.demand_level} Demand
                </span>
              </div>
              <div className="sm:col-span-2 bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-3">Top Organizations</p>
                <div className="flex flex-wrap gap-2">
                  {(data.market_demand.top_organizations || []).map((org, i) => (
                    <span key={i} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 font-medium">
                      🏢 {org}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: Opportunities / Certifications ── */}
          {activeTab === 'certs' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(data.certifications || []).map((c, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-slate-800 text-sm flex-1 pr-2">{c.name}</h4>
                    <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold
                      ${c.priority === 'Must-Have' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                      {c.priority}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">{c.provider}</p>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium
                      ${c.cost === 'Free' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {c.cost}
                    </span>
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                        View →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Tab: Personalized Tips ── */}
          {activeTab === 'tips' && (
            <div className="space-y-4">
              {/* Role-specific advantages */}
              {data.role_specific_advantages?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">⭐ Your Existing Advantages</h3>
                  <div className="space-y-2">
                    {data.role_specific_advantages.map((a, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <span className="text-emerald-500 mt-0.5">✅</span>
                        <p className="text-sm text-emerald-800">{a}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Current gaps */}
              {data.current_gap?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">⚠️ Areas to Improve</h3>
                  <div className="space-y-2">
                    {data.current_gap.map((g, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <span className="text-amber-500 mt-0.5">⚠️</span>
                        <p className="text-sm text-amber-800">{g}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Personalized tips */}
              {data.personalized_tips?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">💡 Personalized Tips</h3>
                  <div className="space-y-2">
                    {data.personalized_tips.map((t, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                        <span className="text-blue-500 mt-0.5">💡</span>
                        <p className="text-sm text-blue-800">{t}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bottom Actions */}
          <div className="flex flex-wrap gap-3">
            <button onClick={saveRoadmap} disabled={saving || viewingSaved}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium
                hover:bg-emerald-700 transition-colors disabled:opacity-40">
              💾 {saving ? 'Saving...' : 'Save Roadmap'}
            </button>
            <button onClick={resetForm}
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium
                text-slate-600 hover:bg-slate-50 transition-colors">
              🔄 Generate New Roadmap
            </button>
            <button onClick={shareRoadmap}
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium
                text-slate-600 hover:bg-slate-50 transition-colors">
              📤 Share Roadmap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
