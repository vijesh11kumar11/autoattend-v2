/**
 * AutoAttend AI v2.0 — Teacher Live Dashboard (Prompt 4)
 *
 * Routes mounted under /teacher/live :
 *   - Pre-session panel (create / list)
 *   - Live session panel (3-column control + AI brain + doubt wall)
 *   - Post-session view (health score, capsule)
 *
 * Sub-pages live in their own files:
 *   - /teacher/live/:sessionId/brief    → TeacherPreClassBrief
 *   - /teacher/live/:sessionId/report   → SessionHealthReport
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const VIOLET = 'from-violet-600 via-purple-600 to-fuchsia-600';

// ════════════════════════════════════════════════════════════════════════
// CREATE SESSION MODAL
// ════════════════════════════════════════════════════════════════════════
function CreateSessionModal({ open, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [type, setType]   = useState('standalone');
  const [capsuleId, setCapsuleId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [allowGuests, setAllowGuests] = useState(true);                  // default ON for public
  const [allowGuestInteraction, setAllowGuestInteraction] = useState(true);
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [recording, setRecording] = useState(true);
  const [capsules, setCapsules] = useState([]);
  const [subjects, setSubjects] = useState([]);                          // [{id,name,sections:[]}]
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset everything whenever the modal closes / re-opens.
  useEffect(() => {
    if (!open) {
      setTitle(''); setType('standalone'); setCapsuleId('');
      setSubjectId(''); setSectionId('');
      setAllowGuests(true); setAllowGuestInteraction(true);
      setPassword(''); setShowPwd(false); setRecording(true);
      setError(''); setSubmitting(false);
    }
  }, [open]);

  // Load teacher's subjects + sections (used by Standalone)
  useEffect(() => {
    if (!open) return;
    setLoadingOpts(true);
    api.get('/live/teacher/options')
      .then(r => setSubjects(r.data?.subjects || []))
      .catch(() => setSubjects([]))
      .finally(() => setLoadingOpts(false));
  }, [open]);

  // Load capsules (used by Capsule-Locked)
  useEffect(() => {
    if (!open || type !== 'capsule_locked') return;
    api.get('/classpulse/teacher/dashboard')
      .then(r => {
        const flat = (r.data?.subjects || []).flatMap(s => s.capsules || []);
        setCapsules(flat);
      })
      .catch(() => setCapsules([]));
  }, [open, type]);

  // When capsule changes, auto-fill its subject/section silently
  const handleCapsuleChange = (id) => {
    setCapsuleId(id);
    const c = capsules.find(x => String(x.id) === String(id));
    if (c) {
      if (c.subject_id) setSubjectId(String(c.subject_id));
      if (c.section_id) setSectionId(String(c.section_id));
    }
  };

  // When subject changes, reset section + recompute available sections
  const handleSubjectChange = (id) => {
    setSubjectId(id);
    setSectionId('');
  };

  const currentSubject = subjects.find(s => String(s.id) === String(subjectId));
  const sectionOptions = currentSubject?.sections || [];

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    if (type === 'standalone') {
      if (!subjectId) { setError('Pick a subject'); return; }
      if (!sectionId) { setError('Pick a section'); return; }
    }
    if (type === 'capsule_locked' && !capsuleId) { setError('Pick a capsule'); return; }
    setSubmitting(true);
    try {
      const body = {
        title: title.trim(),
        session_type: type,
        subject_id: type === 'standalone' ? Number(subjectId) : null,
        section_id: type === 'standalone' ? Number(sectionId) : null,
        capsule_id: type === 'capsule_locked' ? Number(capsuleId) : null,
        allow_guests: type === 'public' ? allowGuests : false,
        allow_guest_interaction: type === 'public' ? allowGuestInteraction : false,
        join_password: password || null,
        recording_enabled: recording,
      };
      const r = await api.post('/live/sessions/create', body);
      onCreated(r.data);
    } catch (e) {
      const detail = e.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : (detail?.message || 'Failed to create session'));
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className={`bg-gradient-to-r ${VIOLET} px-6 py-4 rounded-t-2xl text-white flex justify-between items-center`}>
          <h2 className="font-bold text-lg">🎬 Create Live Session</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-700">Title</label>
            <input value={title} onChange={e=>setTitle(e.target.value)}
              placeholder="Data Structures - Trees"
              className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-violet-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Session Type</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {[
                ['standalone', '🎓 Standalone'],
                ['capsule_locked', '📦 Capsule-Locked'],
                ['public', '🌐 Public Link'],
              ].map(([k, l]) => (
                <button key={k} type="button" onClick={()=>setType(k)}
                  className={`text-xs font-semibold rounded-lg py-2 border ${
                    type===k ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-700 border-slate-300'
                  }`}>{l}</button>
              ))}
            </div>
          </div>

          {type === 'standalone' && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">Subject</label>
                <select value={subjectId} onChange={e => handleSubjectChange(e.target.value)}
                  disabled={loadingOpts}
                  className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg bg-white">
                  <option value="">{loadingOpts ? 'Loading…' : '— pick a subject —'}</option>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code} · Sem {s.semester})
                    </option>
                  ))}
                </select>
                {!loadingOpts && subjects.length === 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    ⚠ No subjects assigned to you. Ask the HOD to assign at least one subject.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Section</label>
                <select value={sectionId} onChange={e => setSectionId(e.target.value)}
                  disabled={!subjectId || sectionOptions.length === 0}
                  className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100">
                  <option value="">
                    {!subjectId
                      ? '— pick a subject first —'
                      : sectionOptions.length === 0
                        ? 'No sections available'
                        : '— pick a section —'}
                  </option>
                  {sectionOptions.map(sec => (
                    <option key={sec.id} value={sec.id}>{sec.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-violet-700">🎓 Only students in the chosen section can join.</p>
            </div>
          )}

          {type === 'capsule_locked' && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
              <label className="text-xs font-semibold text-slate-700">Select Capsule</label>
              <select value={capsuleId} onChange={e=>handleCapsuleChange(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg bg-white">
                <option value="">— pick one —</option>
                {capsules.map(c => (
                  <option key={c.id} value={c.id}>{c.title} ({c.subject_name || ''})</option>
                ))}
              </select>
              {capsules.length === 0 && (
                <p className="text-xs text-amber-700 mt-1">⚠ No capsules found. Create one from ClassPulse first.</p>
              )}
              <p className="text-xs text-violet-700 mt-2">🔒 Only students enrolled in this capsule's section can join.</p>
            </div>
          )}

          {type === 'public' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-sm font-semibold text-amber-800">🌐 Public Link Session</p>
              <p className="text-xs text-amber-700">
                Anyone with the share link can join — no subject or section required.
                Use this for guest lectures, workshops, demo classes, etc.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allowGuests} onChange={e=>setAllowGuests(e.target.checked)} />
                Allow guests without an account
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allowGuestInteraction} onChange={e=>setAllowGuestInteraction(e.target.checked)} />
                Guests can interact (post doubts, take pulse)
              </label>
              <p className="text-xs text-amber-700">💡 Tip: set a password below to keep things safer.</p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-700">Optional password</label>
            <div className="flex gap-2 mt-1">
              <input type={showPwd?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg" />
              <button type="button" onClick={()=>setShowPwd(v=>!v)} className="px-3 py-2 text-xs bg-slate-100 rounded-lg">
                {showPwd?'Hide':'Show'}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={recording} onChange={e=>setRecording(e.target.checked)} />
            🎥 Record session (default ON)
          </label>

          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2 border border-slate-300 rounded-lg font-semibold">Cancel</button>
            <button onClick={submit} disabled={submitting}
              className={`flex-1 py-2 rounded-lg font-semibold text-white bg-gradient-to-r ${VIOLET} disabled:opacity-50`}>
              {submitting ? 'Creating…' : 'Create Session'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// JOIN LINK CARD (after create, before start)
// ════════════════════════════════════════════════════════════════════════
function JoinLinkCard({ session, onStart }) {
  const [copied, setCopied] = useState(false);
  const link = session.join_url || `${window.location.origin}/live/${session.join_link}`;
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        // Fallback for non-secure contexts (HTTP / older browsers)
        const ta = document.createElement('textarea');
        ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this link:', link);
    }
  };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Join my live class "${session.title}": ${link}`)}`;

  return (
    <div className="bg-white rounded-2xl border-2 border-violet-200 shadow-lg p-6 max-w-lg mx-auto">
      <div className="flex items-center gap-2 text-red-500 font-bold mb-1">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> SESSION READY
      </div>
      <h3 className="text-xl font-bold text-slate-800">{session.title}</h3>
      <div className="my-4 bg-violet-50 border border-violet-200 rounded-xl p-4">
        <p className="text-xs text-slate-600 uppercase tracking-wide">Join Code</p>
        <p className="text-2xl font-bold tracking-widest text-violet-700">{session.join_link}</p>
        <div className="mt-3 pt-3 border-t border-violet-200">
          <p className="text-xs text-slate-600 uppercase tracking-wide mb-1">Share Link</p>
          <a href={link} target="_blank" rel="noopener" className="text-sm text-violet-700 underline break-all">
            {link}
          </a>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={copy} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-semibold">
          {copied ? '✅ Copied!' : '📋 Copy Link'}
        </button>
        <a href={wa} target="_blank" rel="noopener" className="flex-1 py-2 bg-emerald-100 hover:bg-emerald-200 rounded-lg text-sm font-semibold text-center">
          📤 WhatsApp
        </a>
      </div>
      <div className="mt-4 text-xs text-slate-500 space-y-1">
        {session.session_type === 'capsule_locked' && <p>🔒 Capsule-Locked · only enrolled students may join</p>}
        {session.session_type === 'public' && <p>🌐 Public Link · anyone with the link may join</p>}
        {session.session_type === 'standalone' && <p>🎓 Standalone · only students in your section may join</p>}
      </div>
      <button onClick={() => onStart(session.session_id)}
        className={`mt-5 w-full py-3 rounded-xl text-white font-bold bg-gradient-to-r ${VIOLET} shadow-lg`}>
        🚀 Start Class Now
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// AI WHITEBOARD MODAL
// ════════════════════════════════════════════════════════════════════════
function WhiteboardModal({ open, sessionId, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [diagram, setDiagram] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const r = await api.post('/live/ai/generate-whiteboard', { session_id: sessionId, description: prompt });
      setDiagram(r.data?.diagram || r.data?.mermaid || JSON.stringify(r.data, null, 2));
    } catch (e) {
      setDiagram(`// Error: ${e.response?.data?.detail || e.message}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className={`bg-gradient-to-r ${VIOLET} px-6 py-4 text-white flex justify-between items-center rounded-t-2xl`}>
          <h2 className="font-bold text-lg">🖼️ AI Whiteboard</h2>
          <button onClick={onClose} className="text-2xl">×</button>
        </div>
        <div className="p-6 space-y-3">
          <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={3}
            placeholder="e.g. binary tree with 7 nodes, in-order traversal arrows…"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
          <button onClick={generate} disabled={busy}
            className={`w-full py-2 rounded-lg text-white font-semibold bg-gradient-to-r ${VIOLET} disabled:opacity-50`}>
            {busy ? 'Generating…' : '✨ Generate'}
          </button>
          {diagram && (
            <pre className="bg-slate-900 text-emerald-300 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
{diagram}
            </pre>
          )}
          {diagram && (
            <button className="w-full py-2 bg-emerald-100 text-emerald-800 rounded-lg font-semibold">
              📡 Share with students
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// PULSE CHECK MODAL
// ════════════════════════════════════════════════════════════════════════
function PulseModal({ open, sessionId, onClose, onSent }) {
  const [mode, setMode] = useState('manual'); // manual | ai
  const [question, setQuestion] = useState('');
  const [opts, setOpts] = useState({ A: '', B: '', C: '', D: '' });
  const [correct, setCorrect] = useState('A');
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post('/live/ai/generate-whiteboard', { session_id: sessionId, description: 'pulse check question for current topic' });
      // Use AI helper if backend exposes; otherwise fall back to plain prompt
      const ai = r.data || {};
      if (ai.question) setQuestion(ai.question);
      if (ai.options) setOpts(ai.options);
    } catch (e) { /* ignore */ } finally { setBusy(false); }
  };
  const send = async () => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      await api.post('/live/pulse/create', {
        session_id: sessionId,
        question,
        options: opts,
        correct_answer: correct,
        duration_seconds: duration,
      });
      onSent && onSent();
      onClose();
    } catch (e) { /* show inline */ } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className={`bg-gradient-to-r ${VIOLET} px-6 py-4 text-white flex justify-between items-center rounded-t-2xl`}>
          <h2 className="font-bold text-lg">⚡ Pulse Check</h2>
          <button onClick={onClose} className="text-2xl">×</button>
        </div>
        <div className="p-6 space-y-3">
          <div className="flex gap-2">
            {['manual','ai'].map(m => (
              <button key={m} onClick={()=>setMode(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold ${mode===m?'bg-violet-600 text-white':'bg-slate-100 text-slate-700'}`}>
                {m === 'manual' ? '✍️ Manual' : '🤖 AI Generate'}
              </button>
            ))}
          </div>
          {mode === 'ai' && (
            <button onClick={generate} disabled={busy}
              className="w-full py-2 bg-amber-100 text-amber-800 rounded-lg text-sm font-semibold">
              {busy ? 'Asking AI…' : '✨ Generate from current topic'}
            </button>
          )}
          <input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Question…"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
          {['A','B','C','D'].map(k => (
            <div key={k} className="flex items-center gap-2">
              <input type="radio" name="correct" checked={correct===k} onChange={()=>setCorrect(k)} />
              <span className="font-bold w-5">{k}.</span>
              <input value={opts[k]} onChange={e=>setOpts({...opts,[k]:e.target.value})}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg" />
            </div>
          ))}
          <div>
            <label className="text-xs font-semibold text-slate-700">Duration: {duration}s</label>
            <input type="range" min={15} max={60} step={15} value={duration}
              onChange={e=>setDuration(Number(e.target.value))} className="w-full" />
          </div>
          <button onClick={send} disabled={busy}
            className={`w-full py-3 rounded-xl text-white font-bold bg-gradient-to-r ${VIOLET} disabled:opacity-50`}>
            🚀 Send Pulse Check
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// AI BRAIN PANEL
// ════════════════════════════════════════════════════════════════════════
function AIBrainPanel({ sessionId }) {
  const [obs, setObs] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.post('/live/ai/observation', { session_id: sessionId, transcript: '' });
      setObs(r.data);
      if (r.data) setHistory(h => [{ time: new Date(), ...r.data }, ...h].slice(0, 20));
    } catch (e) { /* swallow */ } finally { setBusy(false); }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [sessionId]);

  const acceptIntervention = async () => {
    try {
      await api.post('/live/ai/teacher-response', { session_id: sessionId, action: 'accepted', observation: obs });
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="bg-white rounded-2xl border border-violet-100 shadow-sm h-full flex flex-col">
      <div className={`bg-gradient-to-r ${VIOLET} px-4 py-3 rounded-t-2xl text-white`}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">🤖 AI Session Brain</h3>
          <button onClick={refresh} className="text-xs underline">{busy?'Thinking…':'Refresh'}</button>
        </div>
      </div>
      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        <div className="text-xs text-slate-500 uppercase font-semibold">📍 Topic Detection</div>
        <div className="bg-slate-50 px-3 py-2 rounded-lg text-sm">{obs?.topic || obs?.current_topic || '—'}</div>

        <div className="text-xs text-slate-500 uppercase font-semibold">💡 Latest Observation</div>
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm">
          {obs?.observation || obs?.message || 'AI is listening to the class…'}
        </div>

        {obs?.suggestion && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <p className="text-sm">💡 {obs.suggestion}</p>
            <div className="flex gap-2">
              <button onClick={acceptIntervention} className="flex-1 py-1.5 bg-emerald-500 text-white text-xs font-semibold rounded">
                ✅ Yes, do it
              </button>
              <button className="flex-1 py-1.5 bg-slate-200 text-slate-700 text-xs font-semibold rounded">
                ❌ Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="text-xs text-slate-500 uppercase font-semibold pt-2">Observation History</div>
        <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
          {history.length === 0 && <li className="text-slate-400">No observations yet</li>}
          {history.map((h,i)=>(
            <li key={i} className="text-slate-700">
              <span className="text-slate-400 mr-2">{h.time.toLocaleTimeString()}</span>
              {h.observation || h.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// LIVE DOUBT WALL
// ════════════════════════════════════════════════════════════════════════
function DoubtWall({ sessionId }) {
  const [doubts, setDoubts] = useState([]);
  const refresh = async () => {
    try {
      const r = await api.get('/live/doubts', { params: { session_id: sessionId } });
      setDoubts(r.data?.doubts || r.data || []);
    } catch (e) { /* ignore */ }
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [sessionId]);

  const post = async (id, answer) => {
    try {
      await api.post(`/classpulse/wall/${id}/answer`, { answer_text: answer });
      refresh();
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="bg-white rounded-2xl border border-violet-100 shadow-sm h-full flex flex-col">
      <div className={`bg-gradient-to-r ${VIOLET} px-4 py-3 rounded-t-2xl text-white`}>
        <h3 className="font-bold">🔥 Live Doubt Wall</h3>
      </div>
      <div className="p-4 space-y-3 flex-1 overflow-y-auto">
        {doubts.length === 0 && <p className="text-slate-400 text-sm text-center py-6">No live doubts yet.</p>}
        {doubts.map(d => (
          <div key={d.id} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-orange-600">
                {d.resonance_count >= 5 ? '🔥 HOT' : '🤔'} ({d.resonance_count || 0} students)
              </span>
              <span className="text-[10px] text-slate-400">{(d.created_at||'').slice(11,16)}</span>
            </div>
            <p className="text-sm font-medium text-slate-800">{d.question || d.title}</p>
            {d.ai_answer && (
              <p className="text-xs text-violet-700 mt-1 bg-violet-50 px-2 py-1 rounded">
                🤖 {d.ai_answer}
              </p>
            )}
            <p className="text-[10px] text-slate-400 mt-1">By: {d.author_name || 'Anonymous'} (private to you)</p>
            <div className="flex gap-2 mt-2">
              <button onClick={()=>post(d.id, d.ai_answer || 'Acknowledged')}
                className="flex-1 py-1 text-xs bg-emerald-500 text-white rounded font-semibold">✅ Post Answer</button>
              <button className="flex-1 py-1 text-xs bg-slate-200 text-slate-700 rounded font-semibold">✏️ Edit</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// LIVE PANEL — main 3-column layout while a session is live
// ════════════════════════════════════════════════════════════════════════
function LivePanel({ session, onEnd }) {
  const [details, setDetails] = useState(null);
  const [secs, setSecs] = useState(0);
  const [showWB, setShowWB] = useState(false);
  const [showPulse, setShowPulse] = useState(false);

  const refresh = async () => {
    try {
      const r = await api.get(`/live/sessions/${session.id}/details`);
      setDetails(r.data);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    refresh();
    const t1 = setInterval(refresh, 15000);
    const startedAt = session.started_at ? new Date(session.started_at).getTime() : Date.now();
    const t2 = setInterval(() => setSecs(Math.floor((Date.now()-startedAt)/1000)), 1000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [session.id]);

  const fmt = (s) => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  const participants = details?.participants || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
      {/* LEFT — Session control */}
      <div className="lg:col-span-3 space-y-4">
        <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-5">
          <div className="flex items-center gap-2 text-red-500 font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> LIVE · {fmt(secs)}
          </div>
          <h3 className="text-lg font-bold text-slate-800 mt-1">{session.title}</h3>
          <p className="text-sm text-slate-500">{participants.length} participants</p>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button onClick={()=>setShowPulse(true)} className="py-2 bg-violet-100 text-violet-700 font-semibold rounded-lg text-sm">📊 Pulse Check</button>
            <button className="py-2 bg-violet-100 text-violet-700 font-semibold rounded-lg text-sm">🤝 Breakouts</button>
            <button onClick={()=>setShowWB(true)} className="py-2 bg-violet-100 text-violet-700 font-semibold rounded-lg text-sm">🖼️ AI Whiteboard</button>
            <button onClick={onEnd} className="py-2 bg-red-500 text-white font-semibold rounded-lg text-sm">⏹ End Session</button>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4">
          <h4 className="font-bold text-sm text-slate-700 mb-2">👥 Participants</h4>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {participants.length === 0 && <li className="text-xs text-slate-400">No one yet</li>}
            {participants.map(p => {
              const q = (p.connection_quality || 'good').toLowerCase();
              const dot = q === 'good' ? 'bg-emerald-500' : q === 'poor' ? 'bg-amber-500' : 'bg-red-500';
              return (
                <li key={p.id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${dot}`} />
                    {p.name || p.guest_name || `User ${p.user_id || ''}`}
                  </span>
                  <span className="text-slate-400">{p.duration_minutes || 0} min</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {/* CENTER — AI Brain */}
      <div className="lg:col-span-4"><AIBrainPanel sessionId={session.id} /></div>
      {/* RIGHT — Doubt wall */}
      <div className="lg:col-span-3"><DoubtWall sessionId={session.id} /></div>

      <WhiteboardModal open={showWB} sessionId={session.id} onClose={()=>setShowWB(false)} />
      <PulseModal open={showPulse} sessionId={session.id} onClose={()=>setShowPulse(false)} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// POST-SESSION VIEW
// ════════════════════════════════════════════════════════════════════════
function PostSessionView({ session, onClose }) {
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  useEffect(() => {
    api.get(`/live/sessions/${session.id}/health-report`).then(r=>setReport(r.data)).catch(()=>{});
  }, [session.id]);
  const score = report?.health_score || 0;

  return (
    <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-slate-800">📋 Session ended: {session.title}</h3>
        <button onClick={onClose} className="text-slate-400 text-xl">×</button>
      </div>
      <div className="flex items-center gap-6">
        <div className="relative w-32 h-32">
          <svg viewBox="0 0 100 100" className="-rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="8" />
            <circle cx="50" cy="50" r="42" fill="none" stroke="#7c3aed" strokeWidth="8"
              strokeDasharray={2*Math.PI*42}
              strokeDashoffset={2*Math.PI*42 - (score/100)*2*Math.PI*42}
              className="transition-all duration-1000" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black text-violet-700">{score}</span>
            <span className="text-xs text-slate-500">Health Score</span>
          </div>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-500">Attendance:</span> <b>{report?.attendance_percentage||0}%</b></div>
          <div><span className="text-slate-500">Engagement:</span> <b>{report?.engagement_score||0}%</b></div>
          <div><span className="text-slate-500">Comprehension:</span> <b>{report?.comprehension_score||0}%</b></div>
          <div><span className="text-slate-500">Pace:</span> <b>{report?.pace_score||0}%</b></div>
        </div>
      </div>
      <button onClick={()=>navigate(`/teacher/live/${session.id}/report`)}
        className={`w-full py-3 rounded-xl text-white font-bold bg-gradient-to-r ${VIOLET}`}>
        📊 View Full Health Report
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════════
export default function TeacherLiveDashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState({ live: [], upcoming: [], past: [] });
  const [showCreate, setShowCreate] = useState(false);
  const [createdCard, setCreatedCard] = useState(null); // session info before start
  const [activeLive, setActiveLive] = useState(null);
  const [endedSession, setEndedSession] = useState(null);

  const refresh = useCallback(() => {
    api.get('/live/sessions/my-sessions')
      .then(r => setSessions(r.data || { live: [], upcoming: [], past: [] }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  // If a session is live and owned by me, show LivePanel
  useEffect(() => {
    if (sessions.live?.length && !activeLive) {
      setActiveLive(sessions.live[0]);
    }
  }, [sessions.live, activeLive]);

  const startSession = async (id) => {
    try {
      await api.post(`/live/sessions/${id}/start`);
      setCreatedCard(null);
      refresh();
    } catch (e) { /* ignore */ }
  };
  const endSession = async () => {
    if (!activeLive) return;
    try {
      await api.post(`/live/sessions/${activeLive.id}/end`);
      setEndedSession(activeLive);
      setActiveLive(null);
      refresh();
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <div className={`bg-gradient-to-r ${VIOLET} rounded-2xl p-6 md:p-8 text-white shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3`}>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
            <span className="text-3xl">🔴</span> Live Classes
          </h1>
          <p className="text-white/80 mt-1 text-sm">Run AI-powered live sessions with attendance, pulse checks & doubt wall.</p>
        </div>
        {!activeLive && !createdCard && (
          <button onClick={()=>setShowCreate(true)}
            className="px-5 py-2.5 bg-white text-violet-700 font-bold rounded-xl shadow hover:scale-105 transition">
            + Create Session
          </button>
        )}
      </div>

      {/* Just-created card */}
      {createdCard && !activeLive && (
        <JoinLinkCard session={createdCard} onStart={startSession} />
      )}

      {/* Live panel */}
      {activeLive && (
        <LivePanel session={activeLive} onEnd={endSession} />
      )}

      {/* Just-ended summary */}
      {endedSession && !activeLive && (
        <PostSessionView session={endedSession} onClose={()=>setEndedSession(null)} />
      )}

      {/* Past sessions */}
      {!activeLive && (
        <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-5">
          <h3 className="font-bold text-slate-800 mb-3">📅 Recent Sessions</h3>
          <div className="space-y-2">
            {(sessions.past || []).slice(0, 10).map(s => (
              <div key={s.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                <div>
                  <p className="font-semibold text-slate-800">{s.title}</p>
                  <p className="text-xs text-slate-500">
                    Ended {(s.ended_at||'').slice(0,16).replace('T',' ')} · {s.participant_count||0} participants
                  </p>
                </div>
                <button onClick={()=>navigate(`/teacher/live/${s.id}/report`)}
                  className="text-xs px-3 py-1.5 bg-violet-100 text-violet-700 rounded font-semibold">
                  View Report
                </button>
              </div>
            ))}
            {(sessions.past || []).length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">No past sessions yet.</p>
            )}
          </div>
        </div>
      )}

      <CreateSessionModal open={showCreate} onClose={()=>setShowCreate(false)}
        onCreated={(s)=>{ setShowCreate(false); setCreatedCard(s); }} />
    </div>
  );
}
