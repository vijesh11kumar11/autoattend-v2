/**
 * AutoAttend AI v2.0 — ClassPulse (Teacher)
 *
 * Session-aware learning hub for teachers:
 *  • Tab 1 — Overview: per-subject KPIs + attention list + recent activity
 *  • Tab 2 — Capsules: list/upload/manage learning capsules per subject
 *  • Tab 3 — Class Wall: triage student doubts, see AI-suggested answers, reply
 *  • Tab 4 — Analytics: per-capsule deep dive (slide-over panel) + CSV export
 *
 * All API calls go through /api/classpulse/teacher/* (and POST /api/classpulse/capsule for upload)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/axios';

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'overview', icon: '🏠', label: 'Overview' },
  { key: 'capsules', icon: '📦', label: 'Capsules' },
  { key: 'wall', icon: '💬', label: 'Class Wall' },
  { key: 'analytics', icon: '📊', label: 'Analytics' },
];

const CAPSULE_TYPES = [
  { key: 'notes', icon: '📝', label: 'Notes', desc: 'PDF / DOC reading material' },
  { key: 'slides', icon: '🎞️', label: 'Slides', desc: 'Lecture slides (PDF / PPT)' },
  { key: 'video', icon: '🎬', label: 'Video', desc: 'Recorded lecture or clip' },
  { key: 'audio', icon: '🎙️', label: 'Audio', desc: 'Voice memo / podcast' },
  { key: 'quiz', icon: '🧠', label: 'Quiz', desc: 'Assessment-only capsule' },
  { key: 'link', icon: '🔗', label: 'Link', desc: 'External reading' },
];

const UNLOCK_MODES = [
  { key: 'always', icon: '🔓', label: 'Always', desc: 'Open to everyone, anytime' },
  {
    key: 'attendance_gated',
    icon: '🎟️',
    label: 'Attendance Gated',
    desc: 'Requires N% attendance to unlock',
  },
  {
    key: 'session_only',
    icon: '🪟',
    label: 'Session Only',
    desc: 'Unlocked only during the live class window',
  },
  {
    key: 'after_class',
    icon: '🕒',
    label: 'After Class',
    desc: 'Auto-unlocks once the class ends',
  },
];

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'answered', label: 'Answered' },
  { key: 'auto_resolved', label: 'Auto-resolved' },
  { key: 'flagged', label: 'Flagged' },
];

const STATUS_BADGE = {
  open: 'bg-amber-100  text-amber-700',
  answered: 'bg-emerald-100 text-emerald-700',
  auto_resolved: 'bg-blue-100   text-blue-700',
  flagged: 'bg-red-100    text-red-700',
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════ */
export default function ClassPulsePage() {
  const [tab, setTab] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSubjectId, setActiveSubjectId] = useState(null);
  const [analyticsCapsuleId, setAnalyticsCapsuleId] = useState(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/classpulse/teacher/dashboard');
      setDashboard(r.data);
      if (!activeSubjectId && r.data.subjects?.length) {
        setActiveSubjectId(r.data.subjects[0].subject_id);
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to load ClassPulse dashboard');
    } finally {
      setLoading(false);
    }
  }, [activeSubjectId]);

  useEffect(() => {
    loadDashboard();
  }, []); // eslint-disable-line

  const subjects = dashboard?.subjects || [];

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 rounded-2xl p-6 md:p-8 text-white shadow-lg">
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
          <span className="text-3xl">📚</span> ClassPulse
        </h1>
        <p className="text-white/80 mt-1 text-sm">
          Build attendance-gated learning capsules · listen to your class wall · spot students who
          need help
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-[120px] py-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5
              ${tab === t.key ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4">
          {error}
        </div>
      )}

      {loading && <SkeletonGrid />}

      {!loading && !error && dashboard && (
        <>
          {tab === 'overview' && (
            <OverviewTab
              dashboard={dashboard}
              onJumpSubject={(id) => {
                setActiveSubjectId(id);
                setTab('capsules');
              }}
              onJumpCapsule={(id) => {
                setAnalyticsCapsuleId(id);
                setTab('analytics');
              }}
            />
          )}
          {tab === 'capsules' && (
            <CapsulesTab
              subjects={subjects}
              activeSubjectId={activeSubjectId}
              setActiveSubjectId={setActiveSubjectId}
              onUploaded={loadDashboard}
              onOpenAnalytics={(id) => {
                setAnalyticsCapsuleId(id);
                setTab('analytics');
              }}
            />
          )}
          {tab === 'wall' && (
            <WallTab
              subjects={subjects}
              activeSubjectId={activeSubjectId}
              setActiveSubjectId={setActiveSubjectId}
              onAnswered={loadDashboard}
            />
          )}
          {tab === 'analytics' && (
            <AnalyticsTab
              subjects={subjects}
              activeSubjectId={activeSubjectId}
              setActiveSubjectId={setActiveSubjectId}
              focusCapsuleId={analyticsCapsuleId}
              clearFocus={() => setAnalyticsCapsuleId(null)}
            />
          )}
        </>
      )}

      {!loading && !error && dashboard && subjects.length === 0 && (
        <EmptyState
          icon="📚"
          title="No subjects assigned yet"
          desc="ClassPulse activates as soon as a subject is allocated to you. Ask your HOD to assign one."
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════════════════════════ */
function OverviewTab({ dashboard, onJumpSubject, onJumpCapsule }) {
  const { subjects = [], recent_activity = [], attention_needed = [] } = dashboard;

  return (
    <div className="space-y-6">
      {/* KPI cards per subject */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subjects.map((s) => (
          <button
            key={s.subject_id}
            onClick={() => onJumpSubject(s.subject_id)}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-violet-200 transition-all text-left p-5 group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-800 truncate">{s.subject_name}</h3>
                {s.section_name && (
                  <p className="text-xs text-slate-500 mt-0.5">Section {s.section_name}</p>
                )}
              </div>
              <span className="text-xl group-hover:scale-110 transition-transform">📦</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <Stat label="Capsules" value={s.capsule_count} />
              <Stat label="Students" value={s.total_students} />
              <Stat label="Engagement" value={`${s.avg_engagement_pct}%`} accent="violet" />
              <Stat
                label="Hot doubts"
                value={s.hot_doubts_count}
                accent={s.hot_doubts_count > 0 ? 'red' : null}
              />
            </div>

            {s.unanswered_doubts_count > 0 && (
              <div className="mt-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                ⏳ {s.unanswered_doubts_count} unanswered doubt
                {s.unanswered_doubts_count > 1 ? 's' : ''}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Attention needed */}
      {attention_needed.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5">
          <h3 className="font-bold text-red-700 flex items-center gap-2 mb-3">
            🚨 Capsules needing attention
          </h3>
          <div className="space-y-2">
            {attention_needed.map((a) => (
              <button
                key={a.capsule_id}
                onClick={() => onJumpCapsule(a.capsule_id)}
                className="w-full text-left flex items-center justify-between gap-3 p-3 rounded-lg bg-red-50/50 hover:bg-red-50 border border-transparent hover:border-red-200 transition"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate text-sm">{a.capsule_title}</p>
                  <p className="text-xs text-slate-500 truncate">{a.subject_name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {a.failed_comprehension_students > 0 && (
                    <span className="px-2 py-0.5 text-xs rounded-md bg-red-100 text-red-700 font-medium">
                      {a.failed_comprehension_students} failed quiz
                    </span>
                  )}
                  {a.not_opened_pct >= 50 && (
                    <span className="px-2 py-0.5 text-xs rounded-md bg-amber-100 text-amber-700 font-medium">
                      {a.not_opened_pct}% unopened
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {recent_activity.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-3">
            📜 Recent activity
          </h3>
          <ul className="divide-y divide-slate-100">
            {recent_activity.map((r, i) => (
              <li key={i} className="py-2.5 flex items-center gap-3 text-sm">
                <span className="text-lg">{actionIcon(r.action)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800 truncate">
                    <span className="font-medium">{r.student_name || 'Someone'}</span>{' '}
                    {actionVerb(r.action)}{' '}
                    <span className="text-slate-500">— {r.capsule_title}</span>
                  </p>
                  {r.deny_reason && (
                    <p className="text-xs text-red-600 mt-0.5">↳ {r.deny_reason}</p>
                  )}
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">{timeAgo(r.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CAPSULES TAB
   ═══════════════════════════════════════════════════════════════════════ */
function CapsulesTab({
  subjects,
  activeSubjectId,
  setActiveSubjectId,
  onUploaded,
  onOpenAnalytics,
}) {
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    if (!activeSubjectId) return;
    setLoading(true);
    try {
      const r = await api.get(`/classpulse/teacher/subject/${activeSubjectId}/capsules`);
      setCapsules(r.data.capsules || []);
    } catch {
      setCapsules([]);
    } finally {
      setLoading(false);
    }
  }, [activeSubjectId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeSubject = subjects.find((s) => s.subject_id === activeSubjectId);

  const handleUploaded = () => {
    setShowUpload(false);
    load();
    onUploaded?.();
  };

  const handleToggleActive = async (c) => {
    try {
      await api.put(`/classpulse/capsule/${c.id}`, { is_active: !c.is_active });
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to update capsule');
    }
  };

  const handleDelete = async (c) => {
    if (!confirm(`Archive capsule "${c.title}"? Students will no longer see it.`)) return;
    try {
      await api.delete(`/classpulse/capsule/${c.id}`);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to delete');
    }
  };

  return (
    <div className="space-y-4">
      <SubjectSelector subjects={subjects} value={activeSubjectId} onChange={setActiveSubjectId} />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">
            {activeSubject?.subject_name || 'Capsules'}
          </h2>
          <p className="text-xs text-slate-500">
            {capsules.length} capsule{capsules.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          disabled={!activeSubjectId}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium shadow-sm flex items-center gap-2"
        >
          <span>＋</span> New Capsule
        </button>
      </div>

      {loading && <SkeletonGrid />}

      {!loading && capsules.length === 0 && (
        <EmptyState
          icon="📦"
          title="No capsules yet"
          desc="Upload notes, slides, audio, or video to give your students structured learning material that respects attendance rules."
          cta={
            <button
              onClick={() => setShowUpload(true)}
              disabled={!activeSubjectId}
              className="mt-4 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium"
            >
              Create your first capsule
            </button>
          }
        />
      )}

      {!loading && capsules.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {capsules.map((c) => (
            <CapsuleCard
              key={c.id}
              capsule={c}
              onAnalytics={() => onOpenAnalytics(c.id)}
              onToggleActive={() => handleToggleActive(c)}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      {showUpload && activeSubjectId && (
        <CapsuleUploadModal
          subjectId={activeSubjectId}
          subjectName={activeSubject?.subject_name}
          onClose={() => setShowUpload(false)}
          onUploaded={handleUploaded}
        />
      )}
    </div>
  );
}

function CapsuleCard({ capsule, onAnalytics, onToggleActive, onDelete }) {
  const tcfg = CAPSULE_TYPES.find((t) => t.key === capsule.capsule_type) || CAPSULE_TYPES[0];
  const ucfg = UNLOCK_MODES.find((u) => u.key === capsule.unlock_mode) || UNLOCK_MODES[0];
  const s = capsule.interactions_summary || {};
  const opened = s.read_count || 0;
  const total = s.total_students || 0;
  const pct = total > 0 ? Math.round((opened / total) * 100) : 0;

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm p-5 transition-all ${capsule.is_active ? 'border-slate-100' : 'border-slate-200 opacity-60'}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center text-xl flex-shrink-0">
            {tcfg.icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800 truncate">{capsule.title}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                {tcfg.label}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-violet-50 text-violet-700">
                {ucfg.icon} {ucfg.label}
                {capsule.unlock_mode === 'attendance_gated' && ` · ${capsule.min_attendance_pct}%`}
              </span>
              {!capsule.ai_processed && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 animate-pulse">
                  🤖 AI processing…
                </span>
              )}
              {capsule.is_auto_generated && (
                <span
                  className="text-xs px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700"
                  title={
                    capsule.source_session_date
                      ? `From session on ${new Date(capsule.source_session_date).toLocaleDateString()}`
                      : ''
                  }
                >
                  🤖 Auto-generated
                </span>
              )}
              {capsule.has_recording && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">
                  📹 Recording
                </span>
              )}
              {(capsule.chapters_count || 0) > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-slate-50 text-slate-600">
                  📑 {capsule.chapters_count} chapters
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Engagement bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>
            Read by {opened} / {total} students
          </span>
          <span className="font-medium">{pct}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <MiniStat label="Views" value={capsule.view_count || 0} />
        <MiniStat label="Downloads" value={capsule.download_count || 0} />
        <MiniStat
          label="Avg quiz"
          value={s.avg_quiz_score ? `${s.avg_quiz_score}` : '—'}
          accent={s.failed_comprehension_count > 0 ? 'red' : null}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onAnalytics}
          className="flex-1 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg text-xs font-medium"
        >
          📊 Analytics
        </button>
        <button
          onClick={async () => {
            if (!confirm('Start a live session anchored to this capsule?')) return;
            try {
              const r = await api.post(`/api/classpulse/capsules/${capsule.id}/start-live-session`);
              alert(`Live session created. Join code: ${r.data.join_link}`);
              window.location.href = '/teacher/live';
            } catch (e) {
              alert(e?.response?.data?.detail || 'Failed to start live session');
            }
          }}
          className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-medium"
          title="Quick-launch a capsule_locked live session"
        >
          🔴 Start Live
        </button>
        <button
          onClick={async () => {
            try {
              await api.post(`/api/classpulse/teacher/capsule/${capsule.id}/reprocess-ai`);
              alert('AI reprocessing queued. Refresh in a moment.');
            } catch (e) {
              alert(e?.response?.data?.detail || 'Reprocess failed');
            }
          }}
          className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-medium"
          title="Re-run AI summary & quiz"
        >
          🤖 Reprocess
        </button>
        <button
          onClick={onToggleActive}
          className="px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
          title={capsule.is_active ? 'Hide from students' : 'Re-publish'}
        >
          {capsule.is_active ? '🙈 Hide' : '👁️ Show'}
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-medium"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CAPSULE UPLOAD MODAL — 3 step wizard
   ═══════════════════════════════════════════════════════════════════════ */
function CapsuleUploadModal({ subjectId, subjectName, onClose, onUploaded }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — Details
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [capsuleType, setCapsuleType] = useState('notes');

  // Step 2 — Content
  const [file, setFile] = useState(null);
  const [voiceMemo, setVoiceMemo] = useState(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // Step 3 — Access control
  const [unlockMode, setUnlockMode] = useState('always');
  const [minAttendance, setMinAttendance] = useState(75);

  const dragOver = useRef(false);
  const [dragHover, setDragHover] = useState(false);

  const onDrop = (e) => {
    e.preventDefault();
    setDragHover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const f = new File([blob], `voice-memo-${Date.now()}.webm`, { type: 'audio/webm' });
        setVoiceMemo(f);
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      setError('Microphone permission denied');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const canNext1 = title.trim().length >= 3 && capsuleType;
  const canNext2 = file || voiceMemo || description.trim().length >= 20;

  const submit = async () => {
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('subject_id', subjectId);
      fd.append('title', title.trim());
      if (description.trim()) fd.append('description', description.trim());
      fd.append('capsule_type', capsuleType);
      fd.append('unlock_mode', unlockMode);
      fd.append('min_attendance_pct', String(minAttendance));
      if (file) fd.append('file', file);
      if (voiceMemo) fd.append('voice_memo', voiceMemo);
      await api.post('/classpulse/capsule', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded?.();
    } catch (e) {
      setError(e.response?.data?.detail || 'Upload failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-800">New Capsule</h2>
            <p className="text-xs text-slate-500">{subjectName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">
            ✕
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 flex items-center gap-2 border-b border-slate-50">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-2 flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                ${step === n ? 'bg-violet-600 text-white' : step > n ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-400'}`}
              >
                {step > n ? '✓' : n}
              </div>
              <span
                className={`text-xs font-medium ${step >= n ? 'text-slate-700' : 'text-slate-400'}`}
              >
                {n === 1 ? 'Details' : n === 2 ? 'Content' : 'Access'}
              </span>
              {n < 3 && (
                <div className={`flex-1 h-px ${step > n ? 'bg-violet-300' : 'bg-slate-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          {/* STEP 1 */}
          {step === 1 && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Lecture 5 — Binary Trees"
                  maxLength={200}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-violet-400"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short summary or key takeaways. AI will use this if no PDF is attached."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-violet-400 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Capsule type
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CAPSULE_TYPES.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setCapsuleType(t.key)}
                      className={`p-3 rounded-xl border text-left transition
                        ${capsuleType === t.key ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                    >
                      <div className="text-xl mb-1">{t.icon}</div>
                      <div className="text-sm font-medium text-slate-800">{t.label}</div>
                      <div className="text-xs text-slate-500 line-clamp-1">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Upload file
                </label>
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragOver.current) {
                      dragOver.current = true;
                      setDragHover(true);
                    }
                  }}
                  onDragLeave={() => {
                    dragOver.current = false;
                    setDragHover(false);
                  }}
                  onDrop={onDrop}
                  className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition
                    ${dragHover ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-slate-300 bg-slate-50/40'}`}
                >
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  {file ? (
                    <div>
                      <div className="text-2xl mb-1">📄</div>
                      <div className="text-sm font-medium text-slate-800 truncate">{file.name}</div>
                      <div className="text-xs text-slate-500">
                        {(file.size / 1024).toFixed(1)} KB · click to change
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-3xl mb-1">⬆️</div>
                      <div className="text-sm font-medium text-slate-700">
                        Drag & drop, or click to browse
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        PDF, DOC, PPT, MP4, MP3 — up to ~25 MB
                      </div>
                    </div>
                  )}
                </label>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Voice memo (optional)
                </label>
                <div className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl">
                  {!recording ? (
                    <button
                      type="button"
                      onClick={startRecording}
                      className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded-lg flex items-center gap-1.5"
                    >
                      🎙️ Record
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg flex items-center gap-1.5 animate-pulse"
                    >
                      ⏹ Stop
                    </button>
                  )}
                  {voiceMemo && (
                    <div className="flex-1 text-xs text-slate-600 truncate">
                      ✅ {voiceMemo.name} ({(voiceMemo.size / 1024).toFixed(1)} KB)
                      <button
                        onClick={() => setVoiceMemo(null)}
                        className="ml-2 text-red-500 hover:text-red-700"
                      >
                        remove
                      </button>
                    </div>
                  )}
                  {!voiceMemo && !recording && (
                    <span className="text-xs text-slate-400">
                      Add a personal note for your students
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Unlock mode
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {UNLOCK_MODES.map((u) => (
                    <button
                      key={u.key}
                      onClick={() => setUnlockMode(u.key)}
                      className={`p-3 rounded-xl border text-left transition
                        ${unlockMode === u.key ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{u.icon}</span>
                        <span className="text-sm font-medium text-slate-800">{u.label}</span>
                      </div>
                      <div className="text-xs text-slate-500">{u.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {unlockMode === 'attendance_gated' && (
                <div className="bg-violet-50/50 border border-violet-100 rounded-xl p-4">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Minimum attendance: <span className="text-violet-700">{minAttendance}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={minAttendance}
                    onChange={(e) => setMinAttendance(Number(e.target.value))}
                    className="w-full accent-violet-600"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>0%</span>
                    <span>50%</span>
                    <span>100%</span>
                  </div>
                </div>
              )}

              <div className="bg-slate-50 rounded-xl p-4 text-xs text-slate-600 space-y-1">
                <p>
                  ✓ <span className="font-medium">{title || 'Untitled'}</span> ·{' '}
                  {CAPSULE_TYPES.find((t) => t.key === capsuleType)?.label}
                </p>
                <p>
                  ✓ {file ? `File: ${file.name}` : 'No file'}
                  {voiceMemo ? ' · 🎙️ voice memo' : ''}
                </p>
                <p>
                  ✓ Unlock: {UNLOCK_MODES.find((u) => u.key === unlockMode)?.label}
                  {unlockMode === 'attendance_gated' ? ` (≥${minAttendance}%)` : ''}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
              className="px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting}
              className="px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
            >
              {submitting ? 'Publishing…' : '🚀 Publish capsule'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   WALL TAB
   ═══════════════════════════════════════════════════════════════════════ */
function WallTab({ subjects, activeSubjectId, setActiveSubjectId, onAnswered }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('open');
  const [hotOnly, setHotOnly] = useState(false);
  const [activePostId, setActivePostId] = useState(null);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!activeSubjectId) return;
    setLoading(true);
    try {
      const params = { status: statusFilter };
      if (hotOnly) params.is_hot = true;
      const r = await api.get(`/classpulse/teacher/subject/${activeSubjectId}/wall`, { params });
      setPosts(r.data.posts || []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [activeSubjectId, statusFilter, hotOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const applyAISuggestion = (p) => {
    setActivePostId(p.id);
    setDraftAnswer(p.ai_suggested_answer || '');
  };

  const handleAnswer = async (postId) => {
    if (draftAnswer.trim().length < 5) return;
    setSubmitting(true);
    try {
      await api.post(`/classpulse/teacher/wall/${postId}/answer`, { answer: draftAnswer.trim() });
      setActivePostId(null);
      setDraftAnswer('');
      load();
      onAnswered?.();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to post answer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SubjectSelector subjects={subjects} value={activeSubjectId} onChange={setActiveSubjectId} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition
                ${statusFilter === f.key ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setHotOnly((v) => !v)}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium border
            ${hotOnly ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          🔥 Hot only
        </button>
      </div>

      {loading && <SkeletonGrid />}

      {!loading && posts.length === 0 && (
        <EmptyState
          icon="💬"
          title="No doubts yet"
          desc="When students post questions on your class wall, they'll show up here with AI-suggested answers ready for your review."
        />
      )}

      {!loading && posts.length > 0 && (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">
                      {p.student_name || 'Anonymous'}
                    </span>
                    {p.student_roll_no && (
                      <span className="text-xs text-slate-400">· {p.student_roll_no}</span>
                    )}
                    <span
                      className={`text-xs px-2 py-0.5 rounded-md font-medium ${STATUS_BADGE[p.status] || 'bg-slate-100 text-slate-600'}`}
                    >
                      {p.status}
                    </span>
                    {p.is_hot && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-red-100 text-red-700 font-medium">
                        🔥 {p.resonance_count} same doubt
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{p.content}</p>
                  {p.capsule_title && (
                    <p className="text-xs text-slate-500 mt-1.5">
                      📦 on capsule <span className="font-medium">{p.capsule_title}</span>
                      {p.page_number && ` · page ${p.page_number}`}
                    </p>
                  )}
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">
                  {timeAgo(p.created_at)}
                </span>
              </div>

              {p.ai_suggested_answer && !p.teacher_answer && (
                <div className="mt-3 bg-blue-50/50 border border-blue-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
                      🤖 AI suggestion
                      <span className="text-blue-500 font-normal">
                        ({Math.round((p.ai_answer_confidence || 0) * 100)}% confident)
                      </span>
                    </p>
                    <button
                      onClick={() => applyAISuggestion(p)}
                      className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
                    >
                      Use this →
                    </button>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">
                    {p.ai_suggested_answer}
                  </p>
                </div>
              )}

              {p.teacher_answer && (
                <div className="mt-3 bg-emerald-50/50 border border-emerald-100 rounded-xl p-3">
                  <p className="text-xs font-semibold text-emerald-700 mb-1.5">✅ Your answer</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{p.teacher_answer}</p>
                </div>
              )}

              {!p.teacher_answer && (
                <div className="mt-3">
                  {activePostId === p.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={draftAnswer}
                        onChange={(e) => setDraftAnswer(e.target.value)}
                        placeholder="Write a clear, concise answer…"
                        rows={3}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-violet-400 resize-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setActivePostId(null);
                            setDraftAnswer('');
                          }}
                          className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleAnswer(p.id)}
                          disabled={submitting || draftAnswer.trim().length < 5}
                          className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium"
                        >
                          {submitting ? 'Posting…' : 'Post answer'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setActivePostId(p.id);
                        setDraftAnswer('');
                      }}
                      className="text-xs text-violet-700 hover:text-violet-800 font-medium"
                    >
                      ✍️ Write a reply
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ANALYTICS TAB
   ═══════════════════════════════════════════════════════════════════════ */
function AnalyticsTab({
  subjects,
  activeSubjectId,
  setActiveSubjectId,
  focusCapsuleId,
  clearFocus,
}) {
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openCapsuleId, setOpenCapsuleId] = useState(focusCapsuleId);

  useEffect(() => {
    setOpenCapsuleId(focusCapsuleId);
  }, [focusCapsuleId]);

  const load = useCallback(async () => {
    if (!activeSubjectId) return;
    setLoading(true);
    try {
      const r = await api.get(`/classpulse/teacher/subject/${activeSubjectId}/capsules`);
      setCapsules(r.data.capsules || []);
    } catch {
      setCapsules([]);
    } finally {
      setLoading(false);
    }
  }, [activeSubjectId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <SubjectSelector subjects={subjects} value={activeSubjectId} onChange={setActiveSubjectId} />

      {loading && <SkeletonGrid />}

      {!loading && capsules.length === 0 && (
        <EmptyState icon="📊" title="No capsules to analyze" desc="Upload some capsules first." />
      )}

      {!loading && capsules.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Capsule</th>
                <th className="text-center px-4 py-3">Read</th>
                <th className="text-center px-4 py-3">Avg quiz</th>
                <th className="text-center px-4 py-3">Failed</th>
                <th className="text-center px-4 py-3">Not opened</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {capsules.map((c) => {
                const s = c.interactions_summary || {};
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{c.title}</div>
                      <div className="text-xs text-slate-500">
                        {(CAPSULE_TYPES.find((t) => t.key === c.capsule_type) || {}).label}
                      </div>
                    </td>
                    <td className="text-center px-4 py-3">
                      {s.read_count || 0} / {s.total_students || 0}
                    </td>
                    <td className="text-center px-4 py-3 font-medium text-violet-700">
                      {s.avg_quiz_score || '—'}
                    </td>
                    <td
                      className={`text-center px-4 py-3 font-medium ${(s.failed_comprehension_count || 0) > 0 ? 'text-red-600' : 'text-slate-400'}`}
                    >
                      {s.failed_comprehension_count || 0}
                    </td>
                    <td
                      className={`text-center px-4 py-3 font-medium ${(s.not_opened_count || 0) > 0 ? 'text-amber-600' : 'text-slate-400'}`}
                    >
                      {s.not_opened_count || 0}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setOpenCapsuleId(c.id)}
                        className="text-xs text-violet-700 hover:text-violet-800 font-medium"
                      >
                        Deep dive →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openCapsuleId && (
        <CapsuleAnalyticsPanel
          capsuleId={openCapsuleId}
          onClose={() => {
            setOpenCapsuleId(null);
            clearFocus();
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CAPSULE ANALYTICS SLIDE-OVER
   ═══════════════════════════════════════════════════════════════════════ */
function CapsuleAnalyticsPanel({ capsuleId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .get(`/classpulse/teacher/capsule/${capsuleId}/analytics`)
      .then((r) => {
        if (alive) setData(r.data);
      })
      .catch((e) => {
        if (alive) setError(e.response?.data?.detail || 'Failed to load analytics');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [capsuleId]);

  const exportCSV = () => {
    if (!data) return;
    const rows = [
      [
        'Roll No',
        'Name',
        'Section',
        'Opened',
        'Time (sec)',
        'Completion %',
        'Quiz Score',
        'Quiz Passed',
        'Last Opened',
      ],
      ...data.per_student_breakdown.map((s) => [
        s.roll_no || '',
        s.name || '',
        s.section_name || '',
        s.opened ? 'Yes' : 'No',
        s.time_spent_sec || 0,
        s.completion_pct || 0,
        s.quiz_score ?? '',
        s.quiz_passed === null || s.quiz_passed === undefined ? '' : s.quiz_passed ? 'Yes' : 'No',
        s.last_opened_at || '',
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `capsule-${capsuleId}-analytics.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-fade-in">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-800 truncate">
              {data?.capsule?.title || 'Loading…'}
            </h2>
            <p className="text-xs text-slate-500">Capsule deep dive</p>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <button
                onClick={exportCSV}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
              >
                ⬇️ CSV
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading && <SkeletonGrid />}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4">
              {error}
            </div>
          )}

          {data && (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <BigStat label="Enrolled" value={data.summary.total_enrolled} />
                <BigStat label="Opened" value={data.summary.opened_count} accent="violet" />
                <BigStat
                  label="Avg time"
                  value={`${Math.round((data.summary.avg_time_sec || 0) / 60)}m`}
                />
                <BigStat label="Avg done" value={`${data.summary.avg_completion_pct}%`} />
                <BigStat label="Passed" value={data.summary.pass_count} accent="emerald" />
                <BigStat
                  label="Failed"
                  value={data.summary.fail_count}
                  accent={data.summary.fail_count > 0 ? 'red' : null}
                />
                <BigStat
                  label="Not opened"
                  value={data.summary.not_opened_count}
                  accent={data.summary.not_opened_count > 0 ? 'amber' : null}
                />
                <BigStat label="Views" value={data.capsule.view_count} />
              </div>

              {/* Students who need help */}
              {data.comprehension_issues && data.comprehension_issues.length > 0 && (
                <div className="bg-red-50/40 border border-red-100 rounded-2xl p-4">
                  <h3 className="font-bold text-red-700 mb-2 flex items-center gap-2">
                    🚨 Students who need help
                  </h3>
                  <ul className="space-y-1.5">
                    {data.comprehension_issues.map((s) => (
                      <li
                        key={s.student_id}
                        className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2 border border-red-100"
                      >
                        <div>
                          <span className="font-medium text-slate-800">{s.name}</span>
                          {s.roll_no && (
                            <span className="text-xs text-slate-500 ml-2">{s.roll_no}</span>
                          )}
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-red-100 text-red-700 font-medium">
                          {s.quiz_score} on quiz
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Per-student table */}
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-800 text-sm">Per-student breakdown</h3>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2">Student</th>
                        <th className="text-center px-3 py-2">Opened</th>
                        <th className="text-center px-3 py-2">Time</th>
                        <th className="text-center px-3 py-2">Done</th>
                        <th className="text-center px-3 py-2">Quiz</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.per_student_breakdown.map((s) => (
                        <tr
                          key={s.student_id}
                          className={`${
                            s.quiz_passed === false
                              ? 'bg-red-50/30'
                              : s.quiz_passed === true
                                ? 'bg-emerald-50/20'
                                : ''
                          }`}
                        >
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-800 text-sm">{s.name}</div>
                            {s.roll_no && <div className="text-xs text-slate-400">{s.roll_no}</div>}
                          </td>
                          <td className="text-center px-3 py-2">
                            {s.opened ? '✅' : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-center px-3 py-2 text-xs text-slate-600">
                            {s.time_spent_sec ? `${Math.round(s.time_spent_sec / 60)}m` : '—'}
                          </td>
                          <td className="text-center px-3 py-2 text-xs text-slate-600">
                            {s.opened ? `${s.completion_pct}%` : '—'}
                          </td>
                          <td className="text-center px-3 py-2 text-xs">
                            {s.quiz_score === null || s.quiz_score === undefined ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <span
                                className={`font-medium ${s.quiz_passed ? 'text-emerald-700' : 'text-red-600'}`}
                              >
                                {s.quiz_score}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SHARED UI HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

function SubjectSelector({ subjects, value, onChange }) {
  if (!subjects || subjects.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {subjects.map((s) => (
        <button
          key={s.subject_id}
          onClick={() => onChange(s.subject_id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition
            ${
              value === s.subject_id
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:border-violet-300'
            }`}
        >
          {s.subject_name}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, accent }) {
  const cls =
    accent === 'red'
      ? 'text-red-600'
      : accent === 'violet'
        ? 'text-violet-700'
        : accent === 'amber'
          ? 'text-amber-600'
          : accent === 'emerald'
            ? 'text-emerald-700'
            : 'text-slate-800';
  return (
    <div>
      <div className={`text-lg font-bold ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function MiniStat({ label, value, accent }) {
  const cls = accent === 'red' ? 'text-red-600' : 'text-slate-800';
  return (
    <div className="bg-slate-50 rounded-lg py-1.5">
      <div className={`text-sm font-bold ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

function BigStat({ label, value, accent }) {
  const cls =
    accent === 'red'
      ? 'text-red-600 bg-red-50/50 border-red-100'
      : accent === 'amber'
        ? 'text-amber-700 bg-amber-50/50 border-amber-100'
        : accent === 'violet'
          ? 'text-violet-700 bg-violet-50/50 border-violet-100'
          : accent === 'emerald'
            ? 'text-emerald-700 bg-emerald-50/50 border-emerald-100'
            : 'text-slate-800 bg-slate-50 border-slate-100';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
    </div>
  );
}

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

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 animate-pulse"
        >
          <div className="h-4 bg-slate-100 rounded w-1/2 mb-3" />
          <div className="h-3 bg-slate-100 rounded w-1/3 mb-4" />
          <div className="h-20 bg-slate-100 rounded mb-2" />
          <div className="h-3 bg-slate-100 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

/* ── tiny pure utilities ────────────────────────────────────────── */

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function actionIcon(action) {
  switch (action) {
    case 'open':
      return '👁️';
    case 'download':
      return '⬇️';
    case 'quiz_pass':
      return '✅';
    case 'quiz_fail':
      return '❌';
    case 'denied':
      return '🚫';
    case 'completed':
      return '🎉';
    default:
      return '•';
  }
}

function actionVerb(action) {
  switch (action) {
    case 'open':
      return 'opened';
    case 'download':
      return 'downloaded';
    case 'quiz_pass':
      return 'passed quiz on';
    case 'quiz_fail':
      return 'failed quiz on';
    case 'denied':
      return 'was denied access to';
    case 'completed':
      return 'completed';
    default:
      return 'interacted with';
  }
}
