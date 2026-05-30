/**
 * AutoAttend AI v2.0 — ClassPulse (Student)
 *
 * Two-panel session-aware learning hub for students:
 *   • Left  — subject list with attendance + capsule/wall counts
 *   • Right — Tabs:  📦 Capsules   |   💬 Class Wall
 *
 * Capsules tab opens a full-screen <CapsuleViewer/> with PDF.js
 * rendering, anti-screenshot protections, AI summary, voice memo,
 * comprehension quiz, doubt-asking, and watermarked download.
 *
 * Wall tab lets the student post anonymously, resonate on shared
 * doubts, and read AI-suggested + teacher answers.
 *
 * All API calls hit /api/classpulse/student/* and
 * /api/student/portal/dashboard (subject list).
 *
 * PDF.js is loaded from CDN at runtime so the page works even if the
 * `pdfjs-dist` npm dep hasn't been installed yet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';

/* ═══════════════════════════════════════════════════════════════════════
   PDF.js loader (CDN, single shared promise)
   ═══════════════════════════════════════════════════════════════════════ */
const PDFJS_VERSION = '4.6.82';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

let _pdfjsPromise = null;
function loadPdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = import(/* @vite-ignore */ PDFJS_CDN)
    .then((mod) => {
      const lib = mod.default || mod;
      if (lib?.GlobalWorkerOptions) {
        lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      }
      return lib;
    })
    .catch((err) => {
      _pdfjsPromise = null;
      throw err;
    });
  return _pdfjsPromise;
}

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════ */

const TYPE_ICON = {
  notes: '📝',
  slides: '🎞️',
  video: '🎬',
  audio: '🎙️',
  quiz: '🧠',
  link: '🔗',
};

const ACCESS_BANNER = {
  accessible: null,
  read_only: { tone: 'violet', icon: '👁️', label: 'Read-only access (no download)' },
  summary_only: { tone: 'violet', icon: '📄', label: 'Summary-only — full content gated' },
  session_only_open: { tone: 'green', icon: '✅', label: 'Live session active — open now' },
  session_only_window: { tone: 'orange', icon: '⏰', label: 'Available during live class only' },
  attend_first: { tone: 'blue', icon: '✋', label: 'Mark your attendance to unlock' },
  locked_attend_first: { tone: 'blue', icon: '✋', label: 'Mark your attendance to unlock' },
  attendance_gated: { tone: 'violet', icon: '🎟️', label: 'Attendance gated' },
  locked_no_attendance: { tone: 'red', icon: '⛔', label: 'Locked — attendance below required' },
  locked_session_ended: { tone: 'red', icon: '⛔', label: 'Locked — session window closed' },
  capsule_inactive: { tone: 'red', icon: '⛔', label: 'Capsule has been hidden by teacher' },
  not_enrolled: { tone: 'red', icon: '⛔', label: 'You are not enrolled in this subject' },
  wrong_section: { tone: 'red', icon: '⛔', label: 'Capsule restricted to another section' },
};

const DENY_STATUSES = new Set([
  'locked_attend_first',
  'locked_no_attendance',
  'locked_session_ended',
  'capsule_inactive',
  'not_enrolled',
  'wrong_section',
  'attend_first',
]);

const WALL_FILTERS = [
  { key: 'all', label: 'All', icon: '📋' },
  { key: 'hot', label: 'Hot', icon: '🔥' },
  { key: 'mine', label: 'My Questions', icon: '👤' },
  { key: 'answered', label: 'Answered', icon: '✅' },
  { key: 'open', label: 'Open', icon: '❓' },
];

const HEARTBEAT_MS = 30_000;
const SUBJECT_POLL_MS = 60_000;

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════ */
export default function StudentClassPulsePage() {
  const [subjects, setSubjects] = useState([]);
  const [activeSubjectId, setActiveSubjectId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('capsules');
  const [perSubjectMeta, setPerSubjectMeta] = useState({}); // {sid: {capsule_count, unread, doubts}}
  const [toast, setToast] = useState(null);
  const [progress, setProgress] = useState(null); // {learning_streak_days, overall, per_subject}

  // Subject list
  const loadSubjects = useCallback(async () => {
    try {
      const r = await api.get('/student/portal/dashboard');
      const list = r.data.attendance_summary || [];
      setSubjects(list);
      if (!activeSubjectId && list.length) {
        setActiveSubjectId(list[0].subject_id);
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load your subjects');
    } finally {
      setLoading(false);
    }
  }, [activeSubjectId]);

  const loadProgress = useCallback(async () => {
    try {
      const r = await api.get('/classpulse/student/my-progress');
      setProgress(r.data);
    } catch {
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    loadSubjects();
    loadProgress();
  }, []); // eslint-disable-line

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const updateSubjectMeta = useCallback((sid, patch) => {
    setPerSubjectMeta((prev) => ({ ...prev, [sid]: { ...(prev[sid] || {}), ...patch } }));
  }, []);

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 rounded-2xl p-5 md:p-6 text-white shadow-lg">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <span>📚</span> ClassPulse
            </h1>
            <p className="text-white/80 text-xs md:text-sm mt-1">
              Catch up on lectures · ask doubts anonymously · earn comprehension badges
            </p>
          </div>
          {progress && (
            <div className="flex items-center gap-3 bg-white/15 backdrop-blur rounded-xl px-4 py-2">
              <div className="text-3xl">🔥</div>
              <div className="leading-tight">
                <div className="text-2xl font-bold">{progress.learning_streak_days || 0}</div>
                <div className="text-[11px] uppercase tracking-wide text-white/85">day streak</div>
              </div>
              {progress.overall && (
                <div className="border-l border-white/30 pl-3 ml-1 leading-tight">
                  <div className="text-sm font-semibold">
                    {progress.overall.completion_pct ?? 0}% read
                    <span className="opacity-70 ml-1">
                      · {progress.overall.comprehension_pct ?? 0}% pass
                    </span>
                  </div>
                  <div className="text-[11px] text-white/85">
                    {progress.overall.capsules_opened || 0}/{progress.overall.capsules_total || 0}{' '}
                    capsules
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4">
          {error}
        </div>
      )}

      {loading && <div className="card p-10 text-center text-slate-400 text-sm">Loading…</div>}

      {!loading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
          {/* LEFT — subject list */}
          <SubjectList
            subjects={subjects}
            activeId={activeSubjectId}
            onSelect={setActiveSubjectId}
            meta={perSubjectMeta}
          />

          {/* RIGHT — content */}
          <div className="min-w-0 space-y-3">
            {!activeSubjectId ? (
              <EmptyState
                icon="📚"
                title="No subjects yet"
                desc="Once you're enrolled in a subject, ClassPulse activates."
              />
            ) : (
              <>
                <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                  <TabBtn
                    active={tab === 'capsules'}
                    onClick={() => setTab('capsules')}
                    icon="📦"
                    label="Capsules"
                  />
                  <TabBtn
                    active={tab === 'wall'}
                    onClick={() => setTab('wall')}
                    icon="💬"
                    label="Class Wall"
                  />
                </div>
                {tab === 'capsules' && (
                  <CapsulesTab
                    subjectId={activeSubjectId}
                    showToast={showToast}
                    onMeta={(m) => updateSubjectMeta(activeSubjectId, m)}
                  />
                )}
                {tab === 'wall' && (
                  <WallTab
                    subjectId={activeSubjectId}
                    showToast={showToast}
                    onMeta={(m) => updateSubjectMeta(activeSubjectId, m)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm shadow-2xl animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1.5
        ${active ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500 hover:text-slate-700'}`}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SUBJECT LIST (left panel)
   ═══════════════════════════════════════════════════════════════════════ */
function SubjectList({ subjects, activeId, onSelect, meta }) {
  if (!subjects.length) {
    return <div className="card p-4 text-xs text-slate-400 text-center">No subjects assigned.</div>;
  }
  return (
    <aside className="bg-white rounded-2xl border border-slate-100 shadow-sm p-2 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
        Your subjects
      </div>
      <div className="space-y-1">
        {subjects.map((s) => {
          const m = meta[s.subject_id] || {};
          const pct = s.percentage ?? 0;
          const pctColor =
            pct >= 75 ? 'text-emerald-600' : pct >= 65 ? 'text-amber-600' : 'text-red-600';
          const active = activeId === s.subject_id;
          return (
            <button
              key={s.subject_id}
              onClick={() => onSelect(s.subject_id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition group
                ${active ? 'bg-violet-50 border-violet-200' : 'border-transparent hover:bg-slate-50 hover:border-slate-200'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{s.subject_name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{s.subject_code || ''}</p>
                </div>
                <span className={`text-xs font-bold ${pctColor} flex-shrink-0`}>{pct}%</span>
              </div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {m.capsule_count !== undefined && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                    {m.capsule_count} 📦
                  </span>
                )}
                {m.unread > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                    {m.unread} new
                  </span>
                )}
                {m.unanswered > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                    {m.unanswered} 💬
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CAPSULES TAB
   ═══════════════════════════════════════════════════════════════════════ */
function CapsulesTab({ subjectId, showToast, onMeta }) {
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openCapsuleId, setOpenCapsuleId] = useState(null);
  const [expandedSummary, setExpandedSummary] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/classpulse/student/subject/${subjectId}/capsules`);
      const list = r.data.capsules || [];
      setCapsules(list);
      const unread = list.filter((c) => !c.my_interaction?.opened).length;
      onMeta?.({ capsule_count: list.length, unread });
    } catch {
      setCapsules([]);
    } finally {
      setLoading(false);
    }
  }, [subjectId, onMeta]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every 60s for session_active changes
  useEffect(() => {
    const id = setInterval(load, SUBJECT_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const handleCardClick = (c) => {
    if (DENY_STATUSES.has(c.access_status)) {
      const banner = ACCESS_BANNER[c.access_status];
      showToast(`🔒 ${banner?.label || 'Access not allowed yet'}`);
      return;
    }
    setOpenCapsuleId(c.capsule_id);
  };

  if (loading) return <SkeletonCards />;
  if (!capsules.length) {
    return (
      <EmptyState
        icon="📦"
        title="No capsules yet"
        desc="Your teacher hasn't published any learning material for this subject."
      />
    );
  }

  const featured = capsules.filter((c) => c.featured);

  return (
    <div className="space-y-3">
      {featured.length > 0 && (
        <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-2xl p-4">
          <div className="text-xs font-bold text-amber-700 mb-2 flex items-center gap-1">
            ⭐ FEATURED BY HOD
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {featured.map((c) => (
              <CapsuleCard
                key={`feat-${c.capsule_id}`}
                capsule={c}
                expanded={expandedSummary === c.capsule_id}
                onToggleSummary={() =>
                  setExpandedSummary(expandedSummary === c.capsule_id ? null : c.capsule_id)
                }
                onOpen={() => handleCardClick(c)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {capsules.map((c) => (
          <CapsuleCard
            key={c.capsule_id}
            capsule={c}
            expanded={expandedSummary === c.capsule_id}
            onToggleSummary={() =>
              setExpandedSummary(expandedSummary === c.capsule_id ? null : c.capsule_id)
            }
            onOpen={() => handleCardClick(c)}
          />
        ))}
      </div>

      {openCapsuleId && (
        <CapsuleViewer
          capsuleId={openCapsuleId}
          subjectId={subjectId}
          onClose={() => {
            setOpenCapsuleId(null);
            load();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

/* ────────────── Capsule card ────────────── */
function CapsuleCard({ capsule, expanded, onToggleSummary, onOpen }) {
  const banner = ACCESS_BANNER[capsule.access_status];
  const denied = DENY_STATUSES.has(capsule.access_status);
  const i = capsule.my_interaction || {};

  // Status pill
  let statusPill = null;
  if (!i.opened) statusPill = <Pill tone="violet">✨ New</Pill>;
  else if (!i.quiz_attempted) statusPill = <Pill tone="amber">📝 Quiz pending</Pill>;
  else if (i.quiz_passed) statusPill = <Pill tone="emerald">✅ Comprehension verified</Pill>;
  else statusPill = <Pill tone="red">❌ Review needed</Pill>;

  return (
    <div
      className={`bg-white rounded-2xl border border-slate-100 shadow-sm transition-all relative overflow-hidden
        ${denied ? 'opacity-70' : 'hover:shadow-lg hover:-translate-y-0.5 cursor-pointer'}`}
      onClick={denied ? onOpen : onOpen}
    >
      {/* Banner */}
      {banner && <AccessBanner banner={banner} capsule={capsule} />}

      {/* Locked overlay */}
      {denied && (
        <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="bg-white/90 rounded-full p-3 shadow-lg text-2xl">🔒</div>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center text-xl flex-shrink-0">
            {TYPE_ICON[capsule.capsule_type] || '📄'}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-800 leading-tight truncate">{capsule.title}</h3>
            <p className="text-[11px] text-slate-500 truncate">
              {capsule.teacher_name || 'Teacher'} · {fmtDate(capsule.created_at)}
            </p>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {capsule.is_auto_generated && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                  🤖 Auto
                </span>
              )}
              {capsule.has_recording && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                  📹 Recording
                </span>
              )}
              {(capsule.chapters_count || 0) > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  📑 {capsule.chapters_count}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Attendance ring for gated mode */}
        {capsule.access_status === 'attendance_gated' ||
        capsule.access_status === 'locked_no_attendance' ||
        capsule.access_status === 'read_only' ? (
          <AttendanceRingRow capsule={capsule} />
        ) : null}

        {/* AI summary toggle */}
        {(capsule.ai_summary || (capsule.key_points && capsule.key_points.length > 0)) && (
          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onToggleSummary}
              className="text-[11px] px-2 py-1 rounded-md bg-violet-50 text-violet-700 hover:bg-violet-100 font-medium"
            >
              🤖 AI Summary {expanded ? '▴' : '▾'}
            </button>
            {expanded && (
              <div className="mt-2 bg-violet-50/50 border border-violet-100 rounded-lg p-3 text-xs text-slate-700 space-y-1.5">
                {capsule.ai_summary && <p className="text-slate-700">{capsule.ai_summary}</p>}
                {capsule.key_points?.length > 0 && (
                  <ul className="space-y-1">
                    {capsule.key_points.map((kp, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-violet-500">•</span>
                        <span>{kp}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {capsule.estimated_read_time_min && (
                  <p className="text-[11px] text-slate-500">
                    ⏱️ ~{capsule.estimated_read_time_min} min read
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          {statusPill}
          {!denied && <span className="text-[11px] text-violet-700 font-medium">Open →</span>}
        </div>
      </div>
    </div>
  );
}

function AccessBanner({ banner, capsule }) {
  const tones = {
    green: 'bg-emerald-50  text-emerald-700 border-emerald-200',
    orange: 'bg-amber-50    text-amber-700   border-amber-200',
    blue: 'bg-blue-50     text-blue-700    border-blue-200',
    violet: 'bg-violet-50   text-violet-700  border-violet-200',
    red: 'bg-red-50      text-red-700     border-red-200',
  };
  const cls = tones[banner.tone] || tones.violet;
  let extra = '';
  if (
    capsule.access_status === 'attendance_gated' ||
    capsule.access_status === 'locked_no_attendance'
  ) {
    const yours = capsule.access_meta?.attendance_pct;
    const need = capsule.access_meta?.min_required;
    if (need !== undefined) extra = ` · need ${need}%`;
    if (yours !== undefined) extra += ` · yours ${yours}%`;
  }
  return (
    <div
      className={`px-3 py-1.5 border-b text-[11px] font-medium flex items-center gap-1.5 ${cls}`}
    >
      <span>{banner.icon}</span>
      <span className="truncate">
        {banner.label}
        {extra}
      </span>
    </div>
  );
}

function AttendanceRingRow({ capsule }) {
  const yours = Math.max(0, Math.min(100, capsule.access_meta?.attendance_pct ?? 0));
  const need = capsule.access_meta?.min_required ?? 75;
  const ok = yours >= need;
  const sessionsShort = capsule.access_meta?.classes_short;

  return (
    <div className="mt-2 flex items-center gap-3 bg-slate-50 rounded-lg p-2">
      <Ring pct={yours} target={need} ok={ok} />
      <div className="text-xs text-slate-600 leading-tight">
        <p>
          Required: <span className="font-semibold text-slate-800">{need}%</span>
        </p>
        <p>
          Yours:{' '}
          <span className={`font-semibold ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {yours}%
          </span>
        </p>
        {!ok && sessionsShort > 0 && (
          <p className="mt-0.5 text-[11px] text-violet-700">
            📈 Attend {sessionsShort} more class{sessionsShort > 1 ? 'es' : ''} to unlock
          </p>
        )}
      </div>
    </div>
  );
}

function Ring({ pct, target = 75, ok = false, size = 44, stroke = 5 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(pct, 100) / 100) * c;
  const color = ok ? '#10b981' : pct >= target - 10 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-[11px] font-bold"
        style={{ color }}
      >
        {pct}%
      </div>
    </div>
  );
}

function Pill({ tone, children }) {
  const tones = {
    violet: 'bg-violet-50  text-violet-700  border-violet-200',
    amber: 'bg-amber-50   text-amber-700   border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50     text-red-700     border-red-200',
    slate: 'bg-slate-100  text-slate-600   border-slate-200',
  };
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded border font-medium ${tones[tone] || tones.slate}`}
    >
      {children}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CAPSULE VIEWER (full-screen overlay)
   ═══════════════════════════════════════════════════════════════════════ */
function CapsuleViewer({ capsuleId, subjectId, onClose, showToast }) {
  const [openData, setOpenData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [maxPagesViewed, setMaxPagesViewed] = useState(1);
  const [timeSpent, setTimeSpent] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [contextMenu, setContextMenu] = useState(null); // {x, y, page}
  const [askDoubt, setAskDoubt] = useState(null); // {page}
  const [downloading, setDownloading] = useState(false);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const heartbeatPausedRef = useRef(false);
  const [sessionExpiringSoon, setSessionExpiringSoon] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const isPdf =
    (openData?.file_mime_type || '').toLowerCase() === 'application/pdf' ||
    (openData?.file_url || '').toLowerCase().endsWith('.pdf') ||
    (openData?.signed_view_url || '').toLowerCase().includes('serve');
  const totalPages = pdfDoc?.numPages || 0;
  const interaction = openData?.interaction || {};
  const downloadAllowed =
    interaction.download_allowed && (openData?.signed_download_url || openData?.file_url);
  const hasQuiz = (openData?.ai_quiz_json || []).length > 0;

  const refreshSession = useCallback(() => {
    setLoading(true);
    setError('');
    setSessionExpired(false);
    setSessionExpiringSoon(false);
    api
      .post(`/classpulse/student/capsule/${capsuleId}/open`)
      .then((r) => {
        setOpenData(r.data);
      })
      .catch((e) => {
        const detail = e.response?.data?.detail;
        const reason = detail?.reason || detail || 'Could not open capsule';
        setError(typeof reason === 'string' ? reason : 'Access denied');
      })
      .finally(() => setLoading(false));
  }, [capsuleId]);

  /* ── 1. open capsule ─────────────────────────── */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .post(`/classpulse/student/capsule/${capsuleId}/open`)
      .then((r) => {
        if (alive) setOpenData(r.data);
      })
      .catch((e) => {
        if (!alive) return;
        const detail = e.response?.data?.detail;
        const reason = detail?.reason || detail || 'Could not open capsule';
        setError(typeof reason === 'string' ? reason : 'Access denied');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [capsuleId]);

  /* ── 2. load PDF ─────────────────────────── */
  useEffect(() => {
    if (!openData || !isPdf) return;
    if (!openData.signed_view_url && !openData.file_url) return;
    let alive = true;
    setPdfLoading(true);
    (async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        let pdfData;
        if (openData.signed_view_url) {
          // Signed URL — no auth header, fetch directly so PDF.js gets bytes
          const resp = await fetch(openData.signed_view_url, { credentials: 'omit' });
          if (!resp.ok) throw new Error('signed url fetch failed');
          pdfData = new Uint8Array(await resp.arrayBuffer());
        } else {
          const fileRes = await api.get(`/classpulse/student/capsule/${capsuleId}/file`, {
            responseType: 'arraybuffer',
          });
          pdfData = new Uint8Array(fileRes.data);
        }
        const task = pdfjsLib.getDocument({ data: pdfData });
        const doc = await task.promise;
        if (alive) {
          setPdfDoc(doc);
          setPage(1);
        }
      } catch (e) {
        if (alive) showToast('⚠️ Could not load PDF — check your connection');
      } finally {
        if (alive) setPdfLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [openData, isPdf, capsuleId, showToast]);

  /* ── 3. render current page ─────────────────────────── */
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    let renderTask = null;
    (async () => {
      try {
        const pg = await pdfDoc.getPage(page);
        const viewport = pg.getViewport({ scale: zoom * (window.devicePixelRatio || 1) });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
        canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`;
        const ctx = canvas.getContext('2d');
        renderTask = pg.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException' && !cancelled) {
          showToast('⚠️ Page render failed');
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [pdfDoc, page, zoom, showToast]);

  /* ── 4. heartbeat every 30s (paused when tab hidden) ─────────── */
  useEffect(() => {
    if (!openData) return;
    const id = setInterval(() => {
      if (heartbeatPausedRef.current) return;
      api
        .post(`/classpulse/student/capsule/${capsuleId}/heartbeat`, {
          pages_viewed: maxPagesViewed,
          total_pages: totalPages || 1,
        })
        .then((r) => {
          setTimeSpent(r.data.total_time_spent_sec || 0);
        })
        .catch(() => {
          /* offline-tolerant */
        });
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [openData, capsuleId, maxPagesViewed, totalPages]);

  /* ── 4b. pause heartbeat while tab is hidden ─────────── */
  useEffect(() => {
    const handleVisibility = () => {
      heartbeatPausedRef.current = document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  /* ── 4c. signed-URL session expiry watcher ─────────── */
  useEffect(() => {
    const expIso = openData?.signed_url_expires_at;
    if (!expIso) return;
    const expiresAt = new Date(expIso).getTime();
    const tick = () => {
      const msLeft = expiresAt - Date.now();
      if (msLeft <= 0) {
        setSessionExpired(true);
        setSessionExpiringSoon(false);
        return;
      }
      if (msLeft <= 5 * 60 * 1000 && !sessionExpiringSoon) {
        setSessionExpiringSoon(true);
        showToast(`⏳ Session expiring in ${Math.max(1, Math.ceil(msLeft / 60000))} minutes`);
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [openData, sessionExpiringSoon, showToast]);

  /* ── 5. block save / print / select-all / view-source / screenshot ── */
  useEffect(() => {
    const block = (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'a', 'u'].includes(k)) {
        e.preventDefault();
        showToast('⚠️ Saving/printing is disabled for this content');
      }
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        showToast('📋 Screenshots disabled for protected content');
      }
      if (e.key === 'Escape') {
        if (contextMenu) setContextMenu(null);
        else if (askDoubt) setAskDoubt(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', block);
    return () => window.removeEventListener('keydown', block);
  }, [showToast, onClose, contextMenu, askDoubt]);

  /* ── 5b. block image drag-out from canvas ─────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blockDrag = (e) => e.preventDefault();
    canvas.addEventListener('dragstart', blockDrag);
    canvas.setAttribute('draggable', 'false');
    return () => canvas.removeEventListener('dragstart', blockDrag);
  }, [pdfDoc]);

  /* ── page tracking ─────────────────────────── */
  useEffect(() => {
    setMaxPagesViewed((p) => Math.max(p, page));
  }, [page]);

  const showQuizTrigger = useMemo(() => {
    if (!hasQuiz) return false;
    if (!totalPages) return true;
    return maxPagesViewed / totalPages >= 0.5;
  }, [hasQuiz, totalPages, maxPagesViewed]);

  const handleContext = (e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    setContextMenu({
      x: e.clientX - (rect?.left || 0),
      y: e.clientY - (rect?.top || 0),
      page,
    });
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // Prefer signed URL → no auth header, server handles watermarking.
      if (openData?.signed_download_url) {
        const resp = await fetch(openData.signed_download_url, { credentials: 'omit' });
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(txt || 'Download not allowed yet');
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${openData?.title || 'capsule'}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('🔒 Watermarked with your name — happy reading!');
        return;
      }
      const r = await api.post(`/classpulse/student/capsule/${capsuleId}/download`, null, {
        responseType: 'blob',
      });
      const blob = new Blob([r.data], { type: r.headers['content-type'] || 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${openData?.title || 'capsule'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('🔒 Watermarked with your name — happy reading!');
    } catch (e) {
      const detail = e.response?.data?.detail;
      showToast('⛔ ' + (detail?.reason || e.message || 'Download not allowed yet'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/95 flex flex-col select-none">
      {/* HEADER */}
      <header className="flex items-center gap-3 px-4 py-3 bg-slate-900 text-white border-b border-white/10">
        <button onClick={onClose} className="text-white/80 hover:text-white text-xl">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate">{openData?.title || 'Loading…'}</h2>
          <p className="text-[11px] text-white/60 truncate">
            {openData?.capsule_type
              ? `${TYPE_ICON[openData.capsule_type]} ${openData.capsule_type}`
              : ''}
          </p>
        </div>
        {totalPages > 0 && (
          <div className="text-[11px] text-white/70 hidden md:block">
            Page {page} / {totalPages}
          </div>
        )}
        <div className="text-[11px] text-white/70 hidden md:block">⏱️ {fmtTime(timeSpent)}</div>
        {interaction.quiz_attempted && (
          <Pill tone={interaction.quiz_passed ? 'emerald' : 'red'}>
            {interaction.quiz_passed ? '✅ Quiz passed' : '❌ Quiz failed'}
          </Pill>
        )}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-md text-white"
        >
          {sidebarOpen ? '→ hide' : '☰ panel'}
        </button>
      </header>

      {/* BODY */}
      <div className="flex-1 flex min-h-0">
        {loading && (
          <div className="flex-1 flex items-center justify-center text-white/70 text-sm">
            Opening capsule…
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-6 max-w-md text-center">
              <div className="text-4xl mb-2">⛔</div>
              <p className="font-semibold">Access denied</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* PDF panel */}
            <div
              ref={containerRef}
              onContextMenu={handleContext}
              className="flex-1 overflow-auto bg-slate-800 relative"
              style={{ userSelect: 'none' }}
            >
              {sessionExpired && (
                <div className="absolute inset-x-0 top-0 z-10 bg-red-600/95 text-white text-xs flex items-center gap-3 px-4 py-2 shadow">
                  <span>🔄 Your secure viewing session expired.</span>
                  <button
                    onClick={refreshSession}
                    className="ml-auto px-3 py-1 rounded-md bg-white text-red-700 text-xs font-semibold hover:bg-red-50"
                  >
                    Refresh session
                  </button>
                </div>
              )}
              {sessionExpiringSoon && !sessionExpired && (
                <div className="absolute inset-x-0 top-0 z-10 bg-amber-500/95 text-slate-900 text-xs px-4 py-1.5 text-center shadow">
                  ⏳ Session expiring soon — keep reading or refresh to continue.
                </div>
              )}
              {!isPdf && (
                <div className="h-full flex flex-col items-center justify-center text-white/80 text-center p-6">
                  <div className="text-6xl mb-3">{TYPE_ICON[openData?.capsule_type] || '📄'}</div>
                  <p className="font-semibold">{openData?.title}</p>
                  <p className="text-sm text-white/60 mt-1">
                    Non-PDF capsule. Use the panel on the right for the AI summary, voice memo and
                    quiz.
                  </p>
                </div>
              )}
              {isPdf && pdfLoading && (
                <div className="h-full flex items-center justify-center text-white/60 text-sm animate-pulse">
                  📄 Rendering PDF…
                </div>
              )}
              {isPdf && !pdfLoading && pdfDoc && (
                <div className="flex justify-center p-6">
                  <canvas
                    ref={canvasRef}
                    className="bg-white shadow-2xl rounded"
                    onContextMenu={(e) => e.preventDefault()}
                    onDragStart={(e) => e.preventDefault()}
                  />
                </div>
              )}

              {contextMenu && (
                <div
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                  className="absolute z-10 bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px]"
                  onMouseLeave={() => setContextMenu(null)}
                >
                  <button
                    className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-violet-50 flex items-center gap-2"
                    onClick={() => {
                      setAskDoubt({ page: contextMenu.page });
                      setContextMenu(null);
                    }}
                  >
                    💬 Ask a doubt about page {contextMenu.page}
                  </button>
                </div>
              )}
            </div>

            {/* SIDEBAR */}
            {sidebarOpen && (
              <ViewerSidebar
                openData={openData}
                page={page}
                showQuizTrigger={showQuizTrigger}
                interaction={interaction}
                showToast={showToast}
                onQuizDone={(result) => {
                  setOpenData(
                    (d) =>
                      d && {
                        ...d,
                        interaction: {
                          ...d.interaction,
                          quiz_attempted: true,
                          quiz_passed: result.passed,
                          quiz_score: result.score,
                          download_allowed: result.download_allowed,
                        },
                      }
                  );
                }}
              />
            )}
          </>
        )}
      </div>

      {/* CONTROLS */}
      {!loading && !error && (
        <footer className="bg-slate-900 border-t border-white/10 px-4 py-2.5 flex items-center gap-2 text-white">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-xs"
          >
            ← Prev
          </button>
          <input
            type="number"
            min={1}
            max={totalPages || 1}
            value={page}
            onChange={(e) =>
              setPage(Math.max(1, Math.min(totalPages || 1, Number(e.target.value) || 1)))
            }
            className="w-14 px-2 py-1 bg-white/10 rounded text-xs text-center"
          />
          <span className="text-xs text-white/60">/ {totalPages || '–'}</span>
          <button
            disabled={!totalPages || page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded text-xs"
          >
            Next →
          </button>

          <div className="hidden md:flex gap-1 ml-2">
            {[0.75, 1, 1.25, 1.5].map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`px-2 py-1 text-[11px] rounded ${zoom === z ? 'bg-violet-500 text-white' : 'bg-white/10 hover:bg-white/20'}`}
              >
                {Math.round(z * 100)}%
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setAskDoubt({ page })}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 rounded-lg text-xs font-medium flex items-center gap-1.5"
          >
            💬 Ask Doubt
          </button>

          <div className="relative group">
            <button
              onClick={handleDownload}
              disabled={!downloadAllowed || downloading}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5
                ${downloadAllowed ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-white/10 cursor-not-allowed opacity-50'}`}
            >
              📥 {downloading ? 'Downloading…' : 'Download'}
            </button>
            {downloadAllowed && (
              <div className="absolute bottom-full right-0 mb-1 px-2 py-1 bg-slate-700 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap">
                🔒 Watermarked with your name
              </div>
            )}
          </div>
        </footer>
      )}

      {askDoubt && (
        <AskDoubtModal
          subjectId={subjectId}
          capsuleId={capsuleId}
          page={askDoubt.page}
          onClose={() => setAskDoubt(null)}
          onPosted={() => {
            setAskDoubt(null);
            showToast('💬 Posted anonymously to the class wall');
          }}
        />
      )}
    </div>
  );
}

/* ────────────── Viewer sidebar ────────────── */
function ViewerSidebar({ openData, page, showQuizTrigger, interaction, showToast, onQuizDone }) {
  const [openSection, setOpenSection] = useState('summary');
  const summary = openData?.ai_summary || {};
  const summaryText = typeof summary === 'string' ? summary : summary.summary;
  const keyPoints = summary.key_points || [];
  const estRead = summary.estimated_read_time_min;
  const difficulty = summary.difficulty;
  const voiceUrl = openData?.voice_memo_url ? `voice://${openData.capsule_id}` : null;

  return (
    <aside className="w-[360px] flex-shrink-0 bg-white border-l border-slate-200 overflow-y-auto">
      {/* AI Summary */}
      <Section
        id="summary"
        open={openSection}
        setOpen={setOpenSection}
        icon="🤖"
        title="AI Summary"
      >
        {summaryText ? (
          <div className="space-y-2 text-xs text-slate-700">
            <p className="whitespace-pre-wrap">{summaryText}</p>
            {keyPoints.length > 0 && (
              <ul className="space-y-1.5 mt-2">
                {keyPoints.map((kp, i) => (
                  <CheckablePoint key={i} text={kp} />
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 pt-1">
              {estRead && <Pill tone="violet">⏱️ ~{estRead} min</Pill>}
              {difficulty && <Pill tone="slate">📊 {difficulty}</Pill>}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">AI is still thinking… check back soon.</p>
        )}
      </Section>

      {/* Voice */}
      {voiceUrl && (
        <Section
          id="voice"
          open={openSection}
          setOpen={setOpenSection}
          icon="🎙️"
          title="Voice Note"
        >
          <VoicePlayer capsuleId={openData.capsule_id} />
        </Section>
      )}

      {/* Quiz */}
      {(openData?.ai_quiz_json || []).length > 0 && (
        <Section
          id="quiz"
          open={openSection}
          setOpen={setOpenSection}
          icon="📝"
          title="Comprehension Quiz"
        >
          <Quiz
            capsuleId={openData.capsule_id}
            quiz={openData.ai_quiz_json}
            interaction={interaction}
            unlocked={showQuizTrigger}
            showToast={showToast}
            onDone={onQuizDone}
          />
        </Section>
      )}
    </aside>
  );
}

function Section({ id, open, setOpen, icon, title, children }) {
  const isOpen = open === id;
  return (
    <div className="border-b border-slate-100">
      <button
        onClick={() => setOpen(isOpen ? null : id)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <span>{icon}</span>
          {title}
        </span>
        <span className="text-slate-400 text-xs">{isOpen ? '▴' : '▾'}</span>
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function CheckablePoint({ text }) {
  const [done, setDone] = useState(false);
  return (
    <li className="flex items-start gap-2 cursor-pointer" onClick={() => setDone((v) => !v)}>
      <span
        className={`mt-0.5 w-3.5 h-3.5 rounded border-2 flex-shrink-0 flex items-center justify-center transition
        ${done ? 'bg-violet-500 border-violet-500 text-white' : 'border-slate-300'}`}
      >
        {done && <span className="text-[9px]">✓</span>}
      </span>
      <span className={done ? 'line-through text-slate-400' : 'text-slate-700'}>{text}</span>
    </li>
  );
}

/* ────────────── Voice player ────────────── */
function VoicePlayer({ capsuleId }) {
  const audioRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    let alive = true;
    let createdUrl = null;
    api
      .get(`/classpulse/student/capsule/${capsuleId}/voice`, { responseType: 'blob' })
      .then((r) => {
        if (!alive) return;
        createdUrl = URL.createObjectURL(r.data);
        setSrc(createdUrl);
      })
      .catch(() => {
        if (alive) setSrc(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [capsuleId]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setT(a.currentTime);
    const onMeta = () => setDur(a.duration || 0);
    const onEnd = () => setPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  // Static deterministic waveform
  const bars = useMemo(() => Array.from({ length: 36 }, (_, i) => 12 + ((i * 137) % 24)), []);
  const pct = dur ? t / dur : 0;

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play();
      setPlaying(true);
    }
  };

  return (
    <div>
      <audio ref={audioRef} src={src || undefined} preload="metadata" />
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={loading || !src}
          className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 disabled:opacity-50
            ${playing ? 'bg-red-500 animate-pulse' : 'bg-violet-600 hover:bg-violet-700'}`}
        >
          {loading ? '…' : playing ? '⏸' : '▶'}
        </button>
        <div className="flex-1">
          <div className="flex items-end gap-[2px] h-8 cursor-pointer" onClick={toggle}>
            {bars.map((h, i) => {
              const isPast = i / bars.length <= pct;
              return (
                <div
                  key={i}
                  className={`w-[3px] rounded-full transition-colors ${isPast ? 'bg-violet-600' : 'bg-slate-300'}`}
                  style={{ height: h }}
                />
              );
            })}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
            <span>{fmtTime(t)}</span>
            <span>{fmtTime(dur)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────── Quiz ────────────── */
function Quiz({ capsuleId, quiz, interaction, unlocked, showToast, onDone }) {
  const alreadyAttempted = !!interaction?.quiz_attempted;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  if (alreadyAttempted && !result) {
    return (
      <div className="text-center py-2">
        <div className="text-3xl mb-1">{interaction.quiz_passed ? '🎉' : '📖'}</div>
        <p className="text-sm font-semibold text-slate-800">
          {interaction.quiz_passed ? 'You passed' : 'Review the material'}
        </p>
        <p className="text-xs text-slate-500">
          Score: {interaction.quiz_score} / {quiz.length}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">Quiz already completed — cannot retake</p>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="text-center py-2 text-xs text-slate-500">
        📖 Read at least 50% of the pages to unlock the quiz.
      </div>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await api.post(`/classpulse/student/capsule/${capsuleId}/submit-quiz`, { answers });
      setResult(r.data);
      onDone?.(r.data);
    } catch (e) {
      showToast(e.response?.data?.detail || 'Failed to submit quiz');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) return <QuizResult result={result} quiz={quiz} />;

  const q = quiz[step];
  const key = `Q${step + 1}`;
  const choices = q?.options && typeof q.options === 'object' ? q.options : {};
  const optKeys = Object.keys(choices).length ? Object.keys(choices) : ['A', 'B', 'C', 'D'];
  const isLast = step === quiz.length - 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-slate-500">
          Question {step + 1} / {quiz.length}
        </span>
        <div className="flex gap-1">
          {quiz.map((_, i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full ${i <= step ? 'bg-violet-500' : 'bg-slate-200'}`}
            />
          ))}
        </div>
      </div>
      <p className="text-sm font-medium text-slate-800 mb-3">{q.question}</p>
      <div className="space-y-1.5">
        {optKeys.map((k) => {
          const text = choices[k] || `Option ${k}`;
          const sel = answers[key] === k;
          return (
            <button
              key={k}
              onClick={() => setAnswers({ ...answers, [key]: k })}
              className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition flex items-start gap-2
                ${sel ? 'bg-violet-50 border-violet-400 text-violet-900' : 'border-slate-200 hover:border-slate-300 text-slate-700'}`}
            >
              <span
                className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0
                ${sel ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500'}`}
              >
                {k}
              </span>
              <span>{text}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between gap-2">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 disabled:opacity-30"
        >
          ← Back
        </button>
        {isLast ? (
          <button
            onClick={submit}
            disabled={submitting || !answers[key]}
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium"
          >
            {submitting ? 'Submitting…' : '🚀 Submit'}
          </button>
        ) : (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!answers[key]}
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

function QuizResult({ result, quiz }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      setCount(i);
      if (i >= result.score) clearInterval(id);
    }, 220);
    return () => clearInterval(id);
  }, [result.score]);

  const passed = result.passed;

  return (
    <div className="relative text-center py-3 overflow-hidden">
      {passed && (
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className="absolute text-lg animate-bounce"
              style={{
                left: `${(i * 41) % 100}%`,
                top: `${(i * 17) % 50}%`,
                animationDelay: `${i * 0.12}s`,
                animationDuration: `${1 + (i % 3) * 0.4}s`,
              }}
            >
              {['🎉', '✨', '🎊', '⭐', '💜'][i % 5]}
            </span>
          ))}
        </div>
      )}
      <div className={`text-5xl font-black mb-2 ${passed ? 'text-emerald-600' : 'text-red-600'}`}>
        {count}
        <span className="text-2xl text-slate-400">/{result.out_of}</span>
      </div>
      {passed ? (
        <>
          <p className="font-semibold text-emerald-700 text-sm">
            🎉 Excellent! You've verified your understanding.
          </p>
          {result.download_allowed && (
            <p className="text-xs text-slate-600 mt-2">
              📥 Download is now unlocked in the bottom bar.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="font-semibold text-red-700 text-sm">
            📖 Review the material and try again next time.
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Your tutor has been notified to help you.
          </p>

          <div className="mt-3 space-y-2 text-left">
            {(result.detail || []).map((d, i) => (
              <div
                key={i}
                className={`p-2 rounded-lg border text-xs ${d.is_correct ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}
              >
                <p className="font-medium text-slate-800">{d.question}</p>
                <p className="text-[11px] mt-1">
                  Your answer:{' '}
                  <span className={d.is_correct ? 'text-emerald-700' : 'text-red-700 line-through'}>
                    {d.your_answer || '—'}
                  </span>
                  {!d.is_correct && (
                    <>
                      {' '}
                      · Correct:{' '}
                      <span className="text-emerald-700 font-semibold">{d.correct_answer}</span>
                    </>
                  )}
                </p>
                {d.explanation && (
                  <p className="text-[11px] text-slate-600 mt-1 italic">💡 {d.explanation}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ────────────── Ask doubt modal ────────────── */
function AskDoubtModal({ subjectId, capsuleId, page, onClose, onPosted }) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (content.trim().length < 10) {
      setError('Please write at least 10 characters');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api.post('/classpulse/student/wall/post', {
        subject_id: subjectId,
        capsule_id: capsuleId || null,
        page_number: page || null,
        content: content.trim(),
      });
      onPosted?.();
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl">
        <h3 className="font-bold text-slate-800 mb-1">💬 Ask anonymously</h3>
        <p className="text-xs text-slate-500 mb-3">
          Your name is hidden from classmates. Only your teacher can see who asked.
          {page ? (
            <>
              {' '}
              · Linked to page <span className="font-medium">{page}</span>
            </>
          ) : null}
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded-lg mb-2">
            {error}
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, 1000))}
          placeholder="🤔 What's confusing you?"
          rows={5}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-violet-400 resize-none"
        />
        <div className="text-right text-[10px] text-slate-400 mt-1">{content.length}/1000</div>
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || content.trim().length < 10}
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium"
          >
            {submitting ? 'Posting…' : 'Post anonymously'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   WALL TAB
   ═══════════════════════════════════════════════════════════════════════ */
function WallTab({ subjectId, showToast, onMeta }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const [content, setContent] = useState('');
  const [linkCapsule, setLinkCapsule] = useState('');
  const [pageNo, setPageNo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, c] = await Promise.all([
        api.get(`/classpulse/student/subject/${subjectId}/wall`),
        api.get(`/classpulse/student/subject/${subjectId}/capsules`),
      ]);
      setPosts(w.data.posts || []);
      setCapsules(c.data.capsules || []);
      const unanswered = (w.data.posts || []).filter((p) => p.status === 'open').length;
      onMeta?.({ unanswered });
    } catch {
      setPosts([]);
      setCapsules([]);
    } finally {
      setLoading(false);
    }
  }, [subjectId, onMeta]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'hot':
        return posts.filter((p) => p.is_hot);
      case 'mine':
        return posts.filter((p) => p.is_mine);
      case 'answered':
        return posts.filter((p) => p.status === 'answered');
      case 'open':
        return posts.filter((p) => p.status === 'open');
      default:
        return posts;
    }
  }, [posts, filter]);

  const submitPost = async () => {
    if (content.trim().length < 10) {
      setError('Write at least 10 characters');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api.post('/classpulse/student/wall/post', {
        subject_id: subjectId,
        capsule_id: linkCapsule ? Number(linkCapsule) : null,
        page_number: linkCapsule && pageNo ? Number(pageNo) : null,
        content: content.trim(),
      });
      setContent('');
      setLinkCapsule('');
      setPageNo('');
      showToast('💬 Posted anonymously');
      load();
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResonate = async (post) => {
    // optimistic
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              i_resonated: !p.i_resonated,
              resonance_count: p.resonance_count + (p.i_resonated ? -1 : 1),
            }
          : p
      )
    );
    try {
      await api.post(`/classpulse/student/wall/${post.id}/resonate`);
    } catch {
      // revert
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                i_resonated: post.i_resonated,
                resonance_count: post.resonance_count,
              }
            : p
        )
      );
      showToast('⚠️ Could not register your resonance');
    }
  };

  return (
    <div className="space-y-4">
      {/* Composer */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-2">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded-lg">
            {error}
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, 1000))}
          placeholder="🤔 What's confusing you? Ask anonymously…"
          rows={3}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-violet-400 resize-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={linkCapsule}
            onChange={(e) => setLinkCapsule(e.target.value)}
            className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-violet-400"
          >
            <option value="">📎 Link to a capsule (optional)</option>
            {capsules.map((c) => (
              <option key={c.capsule_id} value={c.capsule_id}>
                {c.title}
              </option>
            ))}
          </select>
          {linkCapsule && (
            <input
              type="number"
              min={1}
              value={pageNo}
              onChange={(e) => setPageNo(e.target.value)}
              placeholder="Page #"
              className="text-xs w-20 px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-violet-400"
            />
          )}
          <span className="text-[10px] text-slate-400 ml-auto">{content.length}/1000</span>
          <button
            onClick={submitPost}
            disabled={submitting || content.trim().length < 10}
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium"
          >
            {submitting ? 'Posting…' : 'Post Anonymously'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          👥 Your name is hidden from classmates. Teacher can see your identity.
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {WALL_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition flex items-center gap-1
              ${filter === f.key ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300'}`}
          >
            <span>{f.icon}</span>
            {f.label}
          </button>
        ))}
      </div>

      {loading && <SkeletonCards />}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon="🌟"
          title="This class is doubt-free!"
          desc="Be the first to ask a question — no one can see it's you."
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              myUserId={user?.id}
              onResonate={() => handleResonate(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────── Post card ────────────── */
function PostCard({ post, onResonate }) {
  const [showAi, setShowAi] = useState(false);
  const showAnswerHint = post.ai_suggested_answer && (post.ai_answer_confidence || 0) >= 0.6;

  // deterministic anonymous palette
  const palette = [
    'bg-rose-200',
    'bg-amber-200',
    'bg-emerald-200',
    'bg-sky-200',
    'bg-violet-200',
    'bg-fuchsia-200',
    'bg-lime-200',
    'bg-cyan-200',
  ];
  const color = palette[(post.id || 0) % palette.length];
  const initial = post.is_mine ? 'You' : '👤';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {post.is_hot && (
        <div className="px-4 py-1.5 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[11px] font-semibold flex items-center gap-1.5">
          🔥 HOT DOUBT — {post.resonance_count} students have this question
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-full ${color} flex items-center justify-center text-[11px] font-bold text-slate-700 flex-shrink-0`}
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-slate-700">
                {post.is_mine ? 'You' : 'Anonymous'}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  post.status === 'answered'
                    ? 'bg-emerald-100 text-emerald-700'
                    : post.status === 'open'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {post.status}
              </span>
              <span className="text-[10px] text-slate-400 ml-auto">{timeAgo(post.created_at)}</span>
            </div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap">{post.content}</p>
            {post.capsule_title && (
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-violet-50 text-violet-700 border border-violet-100">
                📎 Re: {post.capsule_title}
                {post.page_number ? ` — page ${post.page_number}` : ''}
              </div>
            )}

            {showAnswerHint && (
              <div className="mt-2">
                <button
                  onClick={() => setShowAi((v) => !v)}
                  className="text-[11px] text-blue-700 hover:text-blue-800 font-medium"
                >
                  🤖 AI thinks it knows the answer {showAi ? '▴' : '▾'}
                </button>
                {showAi && (
                  <div className="mt-1.5 bg-blue-50/50 border border-blue-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] text-blue-700 font-medium">Confidence</span>
                      <div className="flex-1 h-1 bg-blue-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500"
                          style={{
                            width: `${Math.round((post.ai_answer_confidence || 0) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-blue-700 font-bold">
                        {Math.round((post.ai_answer_confidence || 0) * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap">
                      {post.ai_suggested_answer}
                    </p>
                    <p className="text-[10px] text-blue-700 mt-1.5 italic">
                      This is AI-generated. Wait for teacher confirmation.
                    </p>
                  </div>
                )}
              </div>
            )}

            {post.teacher_answer && (
              <div className="mt-3 bg-emerald-50/60 border border-emerald-200 rounded-xl p-3">
                <p className="text-[11px] font-bold text-emerald-700 mb-1">✅ Teacher's Answer</p>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{post.teacher_answer}</p>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={onResonate}
                disabled={post.is_mine}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition flex items-center gap-1.5
                  ${
                    post.is_mine
                      ? 'opacity-50 cursor-not-allowed border-slate-200 text-slate-400'
                      : post.i_resonated
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-violet-300'
                  }`}
              >
                🤝 {post.resonance_count}{' '}
                {post.resonance_count === 1 ? 'student has' : 'students have'} this doubt
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SHARED HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

function EmptyState({ icon, title, desc, cta }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
      <div className="text-5xl mb-3">{icon}</div>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{desc}</p>
      {cta}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 animate-pulse"
        >
          <div className="h-4 bg-slate-100 rounded w-1/2 mb-3" />
          <div className="h-3 bg-slate-100 rounded w-1/3 mb-3" />
          <div className="h-16 bg-slate-100 rounded" />
        </div>
      ))}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
