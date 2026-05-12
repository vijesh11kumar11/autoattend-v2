/**
 * StudentLiveSession — main student experience during a live class (Prompt 5).
 *
 * - Lazy-loads `agora-rtc-sdk-ng` (gracefully degrades if package missing).
 * - Connects to /ws/live/:sessionId/:userId for real-time events.
 * - Tabs: Class Wall · Pulse Checks · My Progress
 * - Liveness overlay every ~10 min when challenge fires.
 * - Low-bandwidth mode swaps video for AI text summaries.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const VIOLET = 'from-violet-600 via-purple-600 to-fuchsia-600';

// ─── lazy Agora SDK loader ─────────────────────────────────────────────
async function loadAgora() {
  try {
    const mod = await import('agora-rtc-sdk-ng');
    return mod.default || mod;
  } catch {
    return null;
  }
}

export default function StudentLiveSession() {
  const { sessionId } = useParams();
  const [search] = useSearchParams();
  const joinCode = search.get('join');
  const navigate = useNavigate();
  const { user, token } = useAuth();

  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState('wall');
  const [doubts, setDoubts] = useState([]);
  const [doubtText, setDoubtText] = useState('');
  const [pulse, setPulse] = useState(null);
  const [pulseAnswer, setPulseAnswer] = useState('');
  const [pulseResult, setPulseResult] = useState(null);
  const [livenessChallenge, setLivenessChallenge] = useState(null);
  const [microSummary, setMicroSummary] = useState(null);
  const [bandwidth, setBandwidth] = useState('good');     // good | poor
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState('');

  const wsRef = useRef(null);
  const agoraClientRef = useRef(null);
  const localTracksRef = useRef([]);
  const remoteContainerRef = useRef(null);

  // ─── Step 1: fetch join info (use guest token if present) ───────────
  useEffect(() => {
    const guestToken = sessionStorage.getItem('aa_guest_token');
    const guestSid = sessionStorage.getItem('aa_guest_session_id');

    if (guestToken && guestSid === String(sessionId)) {
      // Build minimal info from session storage
      setInfo({
        guest_token: guestToken,
        participant_id: Number(sessionStorage.getItem('aa_guest_participant_id') || 0),
        guest: true,
      });
      // Still fetch details for title/teacher
      api.get(`/live/sessions/${sessionId}/details`).then(r => {
        setInfo(prev => ({ ...prev, session: r.data, ...r.data }));
      }).catch(()=>{});
      return;
    }
    if (joinCode) {
      api.post(`/live/join/${joinCode}`, {}).then(r => setInfo(r.data))
        .catch(e => setError(e.response?.data?.detail || 'Failed to join'));
    } else {
      api.get(`/live/sessions/${sessionId}/details`).then(r => setInfo({ session: r.data, ...r.data }))
        .catch(e => setError(e.response?.data?.detail || 'Session not found'));
    }
  }, [sessionId, joinCode]);

  // ─── Step 2: Agora connect ──────────────────────────────────────────
  useEffect(() => {
    const agora = info?.webrtc_config?.agora;
    if (!agora || !agora.app_id || !agora.token) return;
    let cancelled = false;
    (async () => {
      const AgoraRTC = await loadAgora();
      if (!AgoraRTC || cancelled) return;
      try {
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        agoraClientRef.current = client;
        client.on('user-published', async (rUser, mediaType) => {
          await client.subscribe(rUser, mediaType);
          if (mediaType === 'video' && remoteContainerRef.current) {
            rUser.videoTrack?.play(remoteContainerRef.current);
          }
          if (mediaType === 'audio') rUser.audioTrack?.play();
        });
        client.on('connection-state-change', (cur) => {
          if (cur === 'CONNECTED') setBandwidth('good');
          if (cur === 'RECONNECTING' || cur === 'DISCONNECTED') setBandwidth('poor');
        });
        await client.join(agora.app_id, agora.channel, agora.token, agora.uid);
        // For students we typically don't publish unless they raise hand
      } catch (e) {
        console.warn('Agora join failed', e);
      }
    })();
    return () => {
      cancelled = true;
      try { agoraClientRef.current?.leave(); } catch {}
      localTracksRef.current.forEach(t => t.close && t.close());
    };
  }, [info?.webrtc_config?.agora?.token]);

  // ─── Step 3: WebSocket connect ──────────────────────────────────────
  useEffect(() => {
    if (!info) return;
    const guestToken = sessionStorage.getItem('aa_guest_token');
    const wsToken = guestToken || token || localStorage.getItem('aa_token') || '';
    const userId = info.guest ? info.participant_id : (user?.id || 0);
    if (!userId) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/live/${sessionId}/${userId}?token=${encodeURIComponent(wsToken)}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'pulse_check':
          setPulse(msg); setPulseAnswer(''); setPulseResult(null); setTab('pulse'); break;
        case 'pulse_closed':
          setPulseResult(msg); setPulse(null); break;
        case 'new_doubt':
          setDoubts(d => [{ ...msg, id: msg.doubt_id, question: msg.question, resonance_count: msg.resonance_count }, ...d]); break;
        case 'doubt_answered':
          setDoubts(d => d.map(x => x.id === msg.doubt_id ? { ...x, answer: msg.answer, answered_by: msg.answered_by } : x)); break;
        case 'liveness_challenge':
          setLivenessChallenge(msg); break;
        case 'micro_summary':
          setMicroSummary(msg); break;
        case 'session_ended':
          alert('Session ended.'); navigate('/student/dashboard'); break;
        default: break;
      }
    };
    ws.onerror = () => setBandwidth('poor');
    ws.onclose  = () => { wsRef.current = null; };
    return () => { try { ws.close(); } catch {} };
  }, [info?.session?.id, info?.guest, sessionId, token, user?.id]);

  // ─── Session timer ──────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s+1), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = (s) => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  // ─── Heartbeat ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!info) return;
    const t = setInterval(() => {
      api.post(`/live/sessions/${sessionId}/heartbeat`, { connection_quality: bandwidth }).catch(()=>{});
    }, 30000);
    return () => clearInterval(t);
  }, [sessionId, bandwidth, info]);

  // ─── Auto-fetch doubts (fallback if WS misses) ──────────────────────
  const refreshDoubts = useCallback(async () => {
    try {
      const r = await api.get('/live/doubts', { params: { session_id: sessionId } });
      setDoubts(r.data?.doubts || r.data || []);
    } catch {}
  }, [sessionId]);
  useEffect(() => { refreshDoubts(); const t = setInterval(refreshDoubts, 15000); return () => clearInterval(t); }, [refreshDoubts]);

  // ─── Actions ────────────────────────────────────────────────────────
  const sendDoubt = async () => {
    if (!doubtText.trim()) return;
    try {
      await api.post('/live/doubts', { session_id: Number(sessionId), question: doubtText, is_anonymous: true });
      setDoubtText('');
      refreshDoubts();
      wsRef.current?.send(JSON.stringify({ type: 'doubt_posted', question: doubtText }));
    } catch {}
  };
  const sendResonance = (id) => {
    setDoubts(d => d.map(x => x.id === id ? { ...x, resonance_count: (x.resonance_count||0)+1 } : x));
    wsRef.current?.send(JSON.stringify({ type: 'resonance', doubt_id: id }));
  };
  const submitPulse = async () => {
    if (!pulse || !pulseAnswer) return;
    try {
      await api.post(`/live/pulse/${pulse.pulse_id}/respond`, { answer: pulseAnswer });
      wsRef.current?.send(JSON.stringify({ type: 'pulse_response', pulse_id: pulse.pulse_id, answer: pulseAnswer }));
    } catch {}
  };
  const completeLiveness = async () => {
    try {
      await api.post('/live/liveness-check', { challenge_token: livenessChallenge?.challenge_token, success: true });
    } catch {}
    setLivenessChallenge(null);
  };
  const leave = async () => {
    try { await api.post('/live/leave', { session_id: Number(sessionId) }); } catch {}
    sessionStorage.removeItem('aa_guest_token');
    navigate('/');
  };

  const conn = bandwidth === 'good' ? 'bg-emerald-500' : bandwidth === 'poor' ? 'bg-amber-500' : 'bg-red-500';

  if (error) return <div className="p-10 text-center text-red-600">{error}</div>;
  if (!info) return <div className="p-10 text-center text-slate-400">Loading session…</div>;

  // ──────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-bold">LIVE</span>
          <span className="text-xs text-slate-400">{fmt(secs)}</span>
          <span className="text-sm ml-3">{info.session?.title || info.title || 'Live Session'}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${conn}`} />{bandwidth}</span>
          <button onClick={leave} className="px-3 py-1 bg-red-600 rounded font-semibold">🚪 Leave</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 p-4">
        {/* MAIN VIDEO AREA */}
        <div className="lg:col-span-3 bg-slate-800 rounded-2xl overflow-hidden">
          {bandwidth === 'poor' ? (
            <div className="p-6 space-y-3">
              <div className="bg-amber-900/30 border border-amber-500/40 rounded-xl p-4 flex items-center gap-3">
                <span className="text-2xl">📶</span>
                <div>
                  <p className="font-bold text-amber-200">Low bandwidth detected</p>
                  <p className="text-xs text-amber-300/80">Switched to text mode</p>
                </div>
              </div>
              <div className="bg-slate-900 rounded-xl p-4">
                <p className="text-xs text-slate-400 uppercase mb-2">📝 Live AI Summary</p>
                <p className="text-sm text-slate-200 leading-relaxed">
                  {microSummary?.text || 'Waiting for the AI summary…'}
                </p>
                {microSummary?.key_term && (
                  <p className="text-xs text-violet-300 mt-2">Key term: {microSummary.key_term}</p>
                )}
              </div>
            </div>
          ) : (
            <div ref={remoteContainerRef} className="aspect-video bg-black flex items-center justify-center">
              {!info.webrtc_config?.agora?.token && (
                <div className="text-slate-400 text-sm text-center px-6">
                  📹 Video stream will appear here when the teacher publishes.<br/>
                  <span className="text-xs">(Agora token not yet configured)</span>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-center gap-2 p-3 bg-slate-900/60 border-t border-slate-700">
            <button className="px-3 py-1.5 bg-slate-700 rounded text-xs">🎤 Mic</button>
            <button className="px-3 py-1.5 bg-slate-700 rounded text-xs">📷 Camera</button>
            <button className="px-3 py-1.5 bg-violet-600 rounded text-xs">✋ Raise Hand</button>
          </div>
        </div>

        {/* RIGHT TABS */}
        <div className="lg:col-span-2 bg-white rounded-2xl text-slate-800 overflow-hidden flex flex-col" style={{maxHeight:'80vh'}}>
          <div className="flex border-b border-slate-200">
            {[['wall','💬 Wall'],['pulse','⚡ Pulse'],['progress','📊 Progress']].map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)}
                className={`flex-1 py-3 text-sm font-semibold ${tab===k?'border-b-2 border-violet-600 text-violet-700':'text-slate-500'}`}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'wall' && (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {doubts.length === 0 && <p className="text-center text-slate-400 text-sm py-4">No doubts yet. Be the first!</p>}
                {doubts.map(d => (
                  <div key={d.id} className="border border-slate-200 rounded-lg p-3">
                    <p className="text-sm">{d.question || d.title}</p>
                    {(d.ai_answer || d.answer) && (
                      <p className="text-xs mt-1 px-2 py-1 rounded bg-violet-50 text-violet-700">
                        {d.answered_by ? `✅ ${d.answered_by}: ` : '🤖 AI: '} {d.answer || d.ai_answer}
                      </p>
                    )}
                    <button onClick={()=>sendResonance(d.id)} className="mt-2 text-xs text-orange-600 font-semibold">
                      🔥 +1 ({d.resonance_count || 0})
                    </button>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-slate-200 flex gap-2">
                <input value={doubtText} onChange={e=>setDoubtText(e.target.value)}
                  placeholder="Ask anonymously…"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <button onClick={sendDoubt} className={`px-4 py-2 text-white text-sm font-semibold rounded-lg bg-gradient-to-r ${VIOLET}`}>
                  Send
                </button>
              </div>
            </>
          )}

          {tab === 'pulse' && (
            <div className="flex-1 overflow-y-auto p-4">
              {!pulse && !pulseResult && (
                <p className="text-sm text-slate-500 text-center py-8">No active pulse check.<br/>Wait for your teacher.</p>
              )}
              {pulse && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold">⚡ Pulse Check</h3>
                    <span className="text-xs text-slate-500">⏱ {pulse.duration || 30}s</span>
                  </div>
                  <p className="text-sm font-semibold">{pulse.question}</p>
                  <div className="space-y-2">
                    {Object.entries(pulse.options || {}).map(([k,v])=>(
                      <label key={k} className={`block p-3 border rounded-lg cursor-pointer ${pulseAnswer===k?'border-violet-500 bg-violet-50':'border-slate-200'}`}>
                        <input type="radio" name="pulse" checked={pulseAnswer===k}
                          onChange={()=>setPulseAnswer(k)} className="mr-2" />
                        <b className="mr-2">{k}.</b>{v}
                      </label>
                    ))}
                  </div>
                  <button onClick={submitPulse} disabled={!pulseAnswer}
                    className={`w-full py-2 text-white font-semibold rounded-lg bg-gradient-to-r ${VIOLET} disabled:opacity-50`}>
                    Submit Answer
                  </button>
                </div>
              )}
              {pulseResult && (
                <div className="space-y-3">
                  <p className="text-sm">Correct answer: <b>{pulseResult.correct_answer}</b></p>
                  <p className="text-sm">Your answer: <b>{pulseResult.your_answer}</b>
                    {pulseResult.your_answer === pulseResult.correct_answer ? ' ✅' : ' ❌'}</p>
                  {pulseResult.explanation && (
                    <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded">{pulseResult.explanation}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'progress' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
                <p className="text-xs text-slate-500 uppercase">Time in session</p>
                <p className="text-2xl font-bold text-violet-700">{fmt(secs)}</p>
              </div>
              <div className="text-sm text-slate-600">
                Attendance is counted after staying for the minimum required minutes
                set by your college.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Liveness overlay */}
      {livenessChallenge && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <p className="text-white text-lg mb-4">Click the 🌟 to confirm you're paying attention</p>
            <button onClick={completeLiveness}
              style={{ marginLeft: `${livenessChallenge?.button_position?.x || 50}%`,
                       marginTop:  `${livenessChallenge?.button_position?.y || 0}%` }}
              className="text-5xl bg-violet-600 rounded-full w-20 h-20 hover:scale-110 transition">
              🌟
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
