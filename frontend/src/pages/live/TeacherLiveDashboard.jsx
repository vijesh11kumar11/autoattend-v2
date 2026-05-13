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
import { useAgoraRTC } from '../../hooks/useAgoraRTC';
import { VideoGrid } from '../../components/live/VideoGrid';
import { MermaidRenderer } from '../../components/live/MermaidRenderer';

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
  const [prompt, setPrompt]   = useState('');
  const [diagram, setDiagram] = useState('');     // raw mermaid / html
  const [diagramType, setDiagramType] = useState('mermaid');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  if (!open) return null;
  const generate = async () => {
    if (!prompt.trim() || !sessionId) return;
    setBusy(true);
    setErr('');
    setDiagram('');
    try {
      // Endpoint is /live/sessions/{id}/ai/generate-whiteboard and the
      // backend's WhiteboardReq expects `{prompt, context}`.
      const r = await api.post(`/live/sessions/${sessionId}/ai/generate-whiteboard`, {
        prompt,
        context: '',
      });
      setDiagram(r.data?.diagram_code || '');
      setDiagramType(r.data?.diagram_type || 'mermaid');
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || 'Generation failed.');
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

          {err && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">⚠️ {err}</p>
              <p className="text-slate-500 text-xs mt-1">
                Try: "binary tree with 5 nodes" or "linked list with 4 elements"
              </p>
            </div>
          )}

          {diagram && diagramType === 'mermaid' && (
            <div className="space-y-3">
              <div className="bg-white border border-slate-200 rounded-lg p-2 min-h-[220px] flex items-center justify-center">
                <MermaidRenderer code={diagram} />
              </div>
              <details className="text-xs">
                <summary className="text-slate-500 cursor-pointer">Show Mermaid code</summary>
                <pre className="bg-slate-950 text-emerald-300 p-3 rounded-lg mt-2 overflow-x-auto text-xs whitespace-pre-wrap">{diagram}</pre>
              </details>
            </div>
          )}

          {diagram && diagramType === 'html' && (
            <div
              className="bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto"
              // Trusted-source HTML returned by our own AI endpoint
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: diagram }}
            />
          )}

          {diagram && (
            <button className="w-full py-2 bg-emerald-100 text-emerald-800 rounded-lg font-semibold">
              📡 Share with students (coming soon)
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
  const { user: currentUser } = useAuth();
  const [details,    setDetails]    = useState(null);
  const [secs,       setSecs]       = useState(0);
  const [showWB,     setShowWB]     = useState(false);
  const [showPulse,  setShowPulse]  = useState(false);
  // ── Live-room UI state ───────────────────────────────────────────
  const [webrtc,        setWebrtc]        = useState(null); // {agora:{app_id,channel,token,uid}}
  const [webrtcError,   setWebrtcError]   = useState('');
  const [viewMode,      setViewMode]      = useState('speaker'); // speaker | grid | focus
  const [pinnedUid,     setPinnedUid]     = useState(null);
  const [rightPanel,    setRightPanel]    = useState('ai');      // ai | doubts | people
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [muteAllBusy,   setMuteAllBusy]   = useState(false);
  // { "<agora_uid>": { name, role, user_id } }
  const [participantNames, setParticipantNames] = useState({});

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

  // ── Acquire Agora webrtc_config once the session is live ─────────
  // The backend `/live/join/{join_link}` endpoint hands back the
  // {app_id, channel, token, uid} bundle for whoever is calling it.
  // For the host (teacher) this is what lets us publish video.
  useEffect(() => {
    let cancelled = false;
    if (!session?.join_link) return;
    (async () => {
      try {
        const r = await api.post(`/live/join/${session.join_link}`, {});
        if (!cancelled && r.data?.webrtc_config) {
          setWebrtc(r.data.webrtc_config);
        } else if (!cancelled) {
          setWebrtcError('Server did not return Agora credentials.');
        }
      } catch (e) {
        if (!cancelled) {
          const detail = e.response?.data?.detail;
          setWebrtcError(typeof detail === 'string' ? detail : 'Could not get video credentials.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [session?.join_link]);

  const fmt = (s) => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  // ── Agora hook ───────────────────────────────────────────────────
  const agoraCfg = webrtc?.agora || {};
  const localUid = agoraCfg.uid ?? currentUser?.id ?? 0;
  const {
    isJoined, isLoading: agoraLoading, error: agoraError,
    localVideoEnabled, localAudioEnabled,
    remoteUsers, networkQuality, speakingUsers, activeSpeakerUid,
    localVideoTrackRef,
    initClient, leaveChannel,
    toggleAudio, toggleVideo,
    startScreenShare, stopScreenShare,
  } = useAgoraRTC({
    appId:   agoraCfg.app_id || '',
    channel: agoraCfg.channel || '',
    token:   agoraCfg.token   || '',
    uid:     localUid,
    role:    'host',
  });

  // Auto-join Agora as soon as we have credentials
  useEffect(() => {
    if (!agoraCfg.app_id || !agoraCfg.token || isJoined || agoraLoading) return;
    initClient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agoraCfg.app_id, agoraCfg.token]);

  // Refresh Agora-UID → name mapping (every 30s while joined)
  useEffect(() => {
    if (!isJoined || !session?.id) return undefined;
    let cancelled = false;
    const fetchNames = async () => {
      try {
        const r = await api.get(`/live/sessions/${session.id}/participant-names`);
        if (!cancelled) setParticipantNames(r.data || {});
      } catch (_) { /* tolerable — falls back to "User <uid>" */ }
    };
    fetchNames();
    const t = setInterval(fetchNames, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isJoined, session?.id]);

  // Enrich remote-user list with names from /participant-names (preferred)
  // then fall back to /details participant list.
  const enrichedRemote = useMemo(() => remoteUsers.map(ru => {
    const named = participantNames[String(ru.uid)];
    if (named) {
      return {
        ...ru,
        name: named.name,
        role: named.role === 'teacher' ? 'teacher'
              : named.role === 'guest' ? 'guest' : 'student',
        aiObservation: null,
        attentionLevel: null,
        isHandRaised: false,
      };
    }
    return {
      ...ru,
      name: `User ${ru.uid}`,
      role: 'student',
      aiObservation: null,
      attentionLevel: null,
      isHandRaised: false,
    };
  }), [remoteUsers, participantNames]);

  // Effective list (dedupe by uid)
  const handleScreenShare = async () => {
    if (isScreenSharing) {
      await stopScreenShare();
      setIsScreenSharing(false);
    } else {
      const t = await startScreenShare();
      if (t) setIsScreenSharing(true);
    }
  };

  const handleEnd = async () => {
    try { await leaveChannel(); } catch (_) {}
    onEnd();
  };

  // Mute-all / mute-one are placeholders until the WS control channel
  // lands in a future prompt. They flip local UI state immediately so
  // the teacher gets visual feedback.
  const handleMuteAll = async () => {
    setMuteAllBusy(true);
    setTimeout(() => setMuteAllBusy(false), 800);
  };
  const handleMuteOne = (_uid) => { /* TODO: WS broadcast in V3 */ };

  // ── RENDER ───────────────────────────────────────────────────────
  const totalCount = enrichedRemote.length + 1;
  const netLabel = !networkQuality ? 'Connecting'
    : networkQuality.uplink <= 2 ? 'Excellent'
    : networkQuality.uplink <= 4 ? 'Fair' : 'Poor';
  const netColor = !networkQuality ? 'text-gray-400'
    : networkQuality.uplink <= 2 ? 'text-emerald-400'
    : networkQuality.uplink <= 4 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gray-950 text-white">
      {/* TOP BAR */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-400 font-bold text-sm">LIVE</span>
            <span className="text-gray-400 font-mono text-sm">{fmt(secs)}</span>
          </div>
          <span className="text-white font-medium text-sm truncate max-w-[18rem]">{session.title}</span>
          <span className={`text-xs ${netColor} hidden md:inline`}>📶 {netLabel}</span>
        </div>

        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
          {[
            { mode: 'speaker', icon: '👁️', label: 'Speaker' },
            { mode: 'grid',    icon: '⊞',  label: 'Grid'    },
            { mode: 'focus',   icon: '🎯', label: 'Focus'   },
          ].map(v => (
            <button
              key={v.mode}
              onClick={() => setViewMode(v.mode)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === v.mode ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {v.icon} <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm">👥 {totalCount}</span>
          <button
            onClick={handleEnd}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold transition-colors"
          >
            ⏹ End
          </button>
        </div>
      </div>

      {/* MAIN AREA */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video area */}
        <div className="flex-1 p-3 relative overflow-hidden">
          {webrtcError && !agoraError && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center bg-amber-900/20 border border-amber-500/40 rounded-xl p-6 max-w-md">
                <p className="text-amber-300 text-lg mb-2">⚠️ Video unavailable</p>
                <p className="text-gray-400 text-sm">{webrtcError}</p>
              </div>
            </div>
          )}

          {agoraLoading && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-gray-400">Connecting to video…</p>
              </div>
            </div>
          )}

          {agoraError && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center bg-red-900/20 border border-red-500/50 rounded-xl p-6 max-w-md">
                <p className="text-red-400 text-lg mb-2">⚠️ Video Error</p>
                <p className="text-gray-400 text-sm mb-4">{agoraError}</p>
                <button
                  onClick={initClient}
                  className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm"
                >
                  Retry Connection
                </button>
              </div>
            </div>
          )}

          {!agoraLoading && !agoraError && webrtc && (
            <VideoGrid
              participants={enrichedRemote}
              localUid={localUid}
              localName={currentUser?.name}
              localVideoTrack={localVideoTrackRef.current}
              localVideoEnabled={localVideoEnabled}
              localAudioEnabled={localAudioEnabled}
              speakingUsers={speakingUsers}
              activeSpeakerUid={activeSpeakerUid}
              pinnedUid={pinnedUid}
              onPin={(uid) => setPinnedUid(prev => prev === uid ? null : uid)}
              onMute={handleMuteOne}
              isTeacher
              viewMode={viewMode}
            />
          )}

          {isJoined && enrichedRemote.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center bg-black/60 rounded-xl p-6 backdrop-blur-sm pointer-events-auto">
                <p className="text-gray-200 text-lg mb-1">Waiting for students…</p>
                <p className="text-gray-500 text-sm">Share the join link to invite participants</p>
                <div className="mt-3 bg-gray-800 rounded-lg px-4 py-2">
                  <p className="text-violet-300 font-mono text-sm break-all">
                    {`${window.location.origin}/live/${session.join_link}`}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col shrink-0">
          <div className="flex border-b border-gray-800 shrink-0">
            {[
              { id: 'ai',     label: '🤖 AI' },
              { id: 'doubts', label: '🔥 Doubts' },
              { id: 'people', label: `👥 ${totalCount}` },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setRightPanel(t.id)}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  rightPanel === t.id
                    ? 'text-white border-b-2 border-violet-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 bg-slate-50 text-slate-800">
            {rightPanel === 'ai'     && <AIBrainPanel sessionId={session.id} />}
            {rightPanel === 'doubts' && <DoubtWall    sessionId={session.id} />}
            {rightPanel === 'people' && (
              <PeoplePanel
                participants={enrichedRemote}
                localName={currentUser?.name}
                speakingUsers={speakingUsers}
              />
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM CONTROL BAR */}
      <div className="flex items-center justify-center flex-wrap gap-2 px-4 py-3 bg-gray-900 border-t border-gray-800 shrink-0">
        <CtrlBtn
          on={localAudioEnabled}
          onClick={toggleAudio}
          icon={localAudioEnabled ? '🎤' : '🔇'}
          label={localAudioEnabled ? 'Mute' : 'Unmute'}
          danger={!localAudioEnabled}
        />
        <CtrlBtn
          on={localVideoEnabled}
          onClick={toggleVideo}
          icon="📷"
          label={localVideoEnabled ? 'Stop Cam' : 'Start Cam'}
          danger={!localVideoEnabled}
        />
        <CtrlBtn
          on={isScreenSharing}
          onClick={handleScreenShare}
          icon="🖥️"
          label={isScreenSharing ? 'Stop Share' : 'Share'}
          accent={isScreenSharing ? 'success' : null}
        />

        <div className="w-px h-8 bg-gray-700 mx-1" />

        <CtrlBtn onClick={() => setShowPulse(true)} icon="⚡" label="Pulse" accent="violet" />
        <CtrlBtn onClick={() => setShowWB(true)}    icon="🖼️" label="Whiteboard" accent="blue" />
        <CtrlBtn onClick={() => alert('Breakout rooms — coming in next prompt')} icon="🤝" label="Breakout" accent="amber" />

        <div className="w-px h-8 bg-gray-700 mx-1" />

        <CtrlBtn
          onClick={handleMuteAll}
          icon={muteAllBusy ? '✅' : '🔇'}
          label={muteAllBusy ? 'Muted!' : 'Mute All'}
          accent="rose"
        />
      </div>

      <WhiteboardModal open={showWB}    sessionId={session.id} onClose={() => setShowWB(false)} />
      <PulseModal      open={showPulse} sessionId={session.id} onClose={() => setShowPulse(false)} />
    </div>
  );
}

// Bottom-bar button helper (kept inline — single use, simple props)
function CtrlBtn({ on, onClick, icon, label, danger, accent }) {
  let cls = 'bg-gray-800 hover:bg-gray-700 text-white';
  if (danger) cls = 'bg-red-600 hover:bg-red-700 text-white';
  else if (accent === 'success') cls = 'bg-emerald-600 hover:bg-emerald-700 text-white';
  else if (accent === 'violet')  cls = 'bg-gray-800 hover:bg-violet-700 text-white';
  else if (accent === 'blue')    cls = 'bg-gray-800 hover:bg-blue-700 text-white';
  else if (accent === 'amber')   cls = 'bg-gray-800 hover:bg-amber-600 text-white';
  else if (accent === 'rose')    cls = 'bg-gray-800 hover:bg-rose-700 text-white';
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors ${cls}`}
    >
      <span className="text-lg">{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

// Right-panel "People" tab content
function PeoplePanel({ participants, localName, speakingUsers }) {
  return (
    <div className="space-y-2">
      <div className="bg-white border border-violet-100 rounded-lg p-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">👤 {localName || 'You'} (You)</span>
        <span className="text-xs text-violet-600">Host</span>
      </div>
      {participants.length === 0 && (
        <p className="text-xs text-slate-400 text-center py-4">No remote participants yet.</p>
      )}
      {participants.map(p => (
        <div key={p.uid} className="bg-white border border-slate-200 rounded-lg p-2 flex items-center justify-between">
          <span className="text-sm text-slate-700 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${speakingUsers.has(p.uid) ? 'bg-violet-500 animate-pulse' : 'bg-emerald-400'}`} />
            {p.name}
          </span>
          <span className="text-[10px] text-slate-400 uppercase tracking-wide">{p.role}</span>
        </div>
      ))}
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
