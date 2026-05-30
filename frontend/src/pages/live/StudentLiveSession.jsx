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
import { useAgoraRTC } from '../../hooks/useAgoraRTC';
import { VideoGrid } from '../../components/live/VideoGrid';
import { MermaidRenderer } from '../../components/live/MermaidRenderer';
import { getGuestSession } from './guestSessionStore.js';

const VIOLET = 'from-violet-600 via-purple-600 to-fuchsia-600';

export default function StudentLiveSession() {
  const { sessionId } = useParams();
  const [search] = useSearchParams();
  const joinCode = search.get('join');
  const navigate = useNavigate();
  const { user } = useAuth();

  const [info, setInfo] = useState(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [breakoutAssignment, setBreakoutAssignment] = useState(null); // F10
  const [tab, setTab] = useState('wall');
  const [doubts, setDoubts] = useState([]);
  const [doubtText, setDoubtText] = useState('');
  const [pulse, setPulse] = useState(null);
  const [pulseAnswer, setPulseAnswer] = useState('');
  const [pulseResult, setPulseResult] = useState(null);
  // F04 — Live Pulse Check overlay (parallel to legacy `pulse_check`)
  const [livePulse, setLivePulse] = useState(null);
  const [livePulseChoice, setLivePulseChoice] = useState('');
  const [livePulseSubmitted, setLivePulseSubmitted] = useState(false);
  const [livePulseResult, setLivePulseResult] = useState(null);
  const [livePulseTimer, setLivePulseTimer] = useState(0);
  const livePulseTimerRef = useRef(null);
  const [livenessChallenge, setLivenessChallenge] = useState(null);
  // F13 — Pre-class personalised warmup
  const [warmup, setWarmup] = useState(null);
  const [showWarmup, setShowWarmup] = useState(true);
  // F11 — Low-bandwidth live text summary
  const [liveSummary, setLiveSummary] = useState('');
  const [summaryUpdating, setSummaryUpdating] = useState(false);
  const [microSummary, setMicroSummary] = useState(null);
  const [bandwidth, setBandwidth] = useState('good'); // good | poor
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState('');
  const [participantNames, setParticipantNames] = useState({});
  const [sharedWhiteboard, setSharedWhiteboard] = useState(null);

  const wsRef = useRef(null);

  // ─── Agora (subscribe-only by default; student is audience) ─────────
  const agoraCfg = info?.webrtc_config?.agora || {};
  const teacherAgoraUid = info?.teacher_agora_uid || null;
  const {
    isJoined: agoraJoined,
    isLoading: agoraLoading,
    error: agoraError,
    localVideoEnabled,
    localAudioEnabled,
    remoteUsers,
    networkQuality,
    speakingUsers,
    activeSpeakerUid,
    localVideoTrackRef,
    initClient,
    leaveChannel,
    toggleVideo,
    toggleAudio,
  } = useAgoraRTC({
    appId: agoraCfg.app_id || '',
    channel: agoraCfg.channel || '',
    token: agoraCfg.token || '',
    uid: agoraCfg.uid || 0,
    // 'host' so students/guests can publish their mic+cam (Zoom-like).
    // mode='rtc' makes the role param informational only — publishing is allowed.
    role: 'host',
  });

  // ─── Step 1: fetch join info (use guest token if present) ───────────
  useEffect(() => {
    // Guest session lives in module memory now — NOT sessionStorage.
    const guest = getGuestSession(sessionId);
    if (guest && guest.token) {
      const joinData = guest.joinData;
      setInfo(
        joinData
          ? { ...joinData, guest: true }
          : { guest_token: guest.token, participant_id: guest.participantId, guest: true }
      );
      return;
    }
    if (joinCode) {
      api
        .post(`/live/join/${joinCode}`, {})
        .then((r) => setInfo(r.data))
        .catch((e) => setError(e.response?.data?.detail || 'Failed to join'));
    } else {
      api
        .get(`/live/sessions/${sessionId}/details`)
        .then((r) => setInfo({ session: r.data, ...r.data }))
        .catch((e) => setError(e.response?.data?.detail || 'Session not found'));
    }
  }, [sessionId, joinCode]);

  // ─── Step 2: Agora connect ──────────────────────────────────────────
  // Auto-join the video channel as soon as we have credentials.
  useEffect(() => {
    if (!agoraCfg.app_id || !agoraCfg.token || agoraJoined || agoraLoading) return;
    initClient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agoraCfg.app_id, agoraCfg.token]);

  // PS7-B — Once we are actually joined, persist our agora_uid to the
  // backend participant row so the teacher's name-mapping resolves us.
  useEffect(() => {
    if (!agoraJoined || !agoraCfg.uid) return;
    api
      .patch(`/live/sessions/${sessionId}/participant-uid`, {
        participant_id: info?.participant_id || null,
        agora_uid: Number(agoraCfg.uid),
      })
      .catch(() => {
        /* non-fatal */
      });
  }, [agoraJoined, agoraCfg.uid, info?.participant_id, sessionId]);

  // Update bandwidth label from real-time network stats
  useEffect(() => {
    if (!networkQuality) return;
    if (networkQuality.downlink >= 4) setBandwidth('poor');
    else if (networkQuality.downlink <= 2) setBandwidth('good');
  }, [networkQuality]);

  // ─── Step 2b: Resolve Agora UIDs → real names ───────────────────────
  useEffect(() => {
    if (!agoraJoined || !sessionId) return undefined;
    let cancelled = false;
    const fetchNames = async () => {
      try {
        const r = await api.get(`/live/sessions/${sessionId}/participant-names`);
        if (!cancelled) setParticipantNames(r.data || {});
      } catch (_) {
        /* tolerable */
      }
    };
    fetchNames();
    const t = setInterval(fetchNames, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [agoraJoined, sessionId]);

  // ─── Step 3: WebSocket connect ──────────────────────────────────────
  useEffect(() => {
    if (!info) return;
    const guest = getGuestSession(sessionId);
    // For logged-in users we rely on the httpOnly aa_token cookie
    // (sent automatically on the WS handshake). Guests pass their token
    // explicitly because they have no login cookie.
    const wsToken = guest?.token || '';
    const userId = info.guest ? info.participant_id : user?.id || 0;
    if (!userId) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // Prefer Sec-WebSocket-Protocol over ?token= to keep tokens out of
    // access logs / browser history. Server accepts ["aa-jwt", <token>].
    const wsUrl = `${proto}://${window.location.host}/ws/live/${sessionId}/${userId}`;
    const ws = wsToken ? new WebSocket(wsUrl, ['aa-jwt', wsToken]) : new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'pulse_check':
          setPulse(msg);
          setPulseAnswer('');
          setPulseResult(null);
          setTab('pulse');
          break;
        case 'pulse_closed':
          setPulseResult(msg);
          setPulse(null);
          break;

        // ── F04 — Live Pulse Check (new endpoint) ─────────────────────
        case 'pulse_check_started':
          setLivePulse(msg);
          setLivePulseChoice('');
          setLivePulseSubmitted(false);
          setLivePulseResult(null);
          setLivePulseTimer(msg.duration_secs || 30);
          clearInterval(livePulseTimerRef.current);
          livePulseTimerRef.current = setInterval(() => {
            setLivePulseTimer((prev) => {
              if (prev <= 1) {
                clearInterval(livePulseTimerRef.current);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
          break;
        case 'pulse_check_closed':
          clearInterval(livePulseTimerRef.current);
          setLivePulseResult(msg);
          setTimeout(() => {
            setLivePulse(null);
            setLivePulseResult(null);
          }, 8000);
          break;

        case 'new_doubt':
          setDoubts((d) => [
            {
              ...msg,
              id: msg.doubt_id,
              question: msg.question,
              resonance_count: msg.resonance_count,
            },
            ...d,
          ]);
          break;
        case 'doubt_answered':
          setDoubts((d) =>
            d.map((x) =>
              x.id === msg.doubt_id ? { ...x, answer: msg.answer, answered_by: msg.answered_by } : x
            )
          );
          break;
        case 'liveness_challenge':
          setLivenessChallenge(msg);
          break;
        case 'micro_summary':
          setMicroSummary(msg);
          break;
        case 'whiteboard_shared':
          setSharedWhiteboard(msg.diagram || msg.diagram_code || msg.code || null);
          break;

        // F10 — breakout rooms
        case 'breakout_started': {
          const myPid = info?.participant_id;
          const myUid = user?.id;
          let mine = null;
          for (const room of msg.rooms || []) {
            const pids = room.participant_ids || [];
            if (myPid && pids.includes(myPid)) {
              mine = room;
              break;
            }
            if (myUid && pids.includes(myUid)) {
              mine = room;
              break;
            }
          }
          setBreakoutAssignment(mine || { name: 'Main room', topic: 'Stay tuned' });
          break;
        }
        case 'breakout_ended':
          setBreakoutAssignment(null);
          break;
        case 'session_ended': {
          try {
            leaveChannel();
          } catch (_) {}
          setSessionEnded(true);
          setTimeout(() => {
            const isGuest = !!getGuestSession(sessionId);
            navigate(isGuest ? '/session-ended' : '/student/dashboard', { replace: true });
          }, 3000);
          break;
        }
        default:
          break;
      }
    };
    ws.onerror = () => setBandwidth('poor');
    ws.onclose = () => {
      wsRef.current = null;
    };
    return () => {
      try {
        ws.close();
      } catch {}
    };
  }, [info?.session?.id, info?.guest, sessionId, user?.id]);

  // ─── Session timer ──────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = (s) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ─── Heartbeat ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!info) return;
    const t = setInterval(() => {
      api
        .post(`/live/sessions/${sessionId}/heartbeat`, { connection_quality: bandwidth })
        .catch(() => {});
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
  useEffect(() => {
    refreshDoubts();
    const t = setInterval(refreshDoubts, 15000);
    return () => clearInterval(t);
  }, [refreshDoubts]);

  // ─── F13: fetch personalised warmup once on entry ───────────────────
  useEffect(() => {
    if (!sessionId) return;
    api
      .get(`/live/sessions/${sessionId}/my-warmup`)
      .then((r) => {
        if (r.data?.warmup) setWarmup(r.data.warmup);
      })
      .catch(() => {});
  }, [sessionId]);

  // ─── F11: poll live text summary while in low-bandwidth mode ───────
  useEffect(() => {
    if (!sessionId || bandwidth !== 'poor') return undefined;
    const fetchSummary = async () => {
      setSummaryUpdating(true);
      try {
        const r = await api.get(`/live/sessions/${sessionId}/live-text-summary`);
        if (r.data?.summary) setLiveSummary(r.data.summary);
      } catch (_) {
      } finally {
        setSummaryUpdating(false);
      }
    };
    fetchSummary();
    const t = setInterval(fetchSummary, 120000);
    return () => clearInterval(t);
  }, [sessionId, bandwidth]);

  // ─── Actions ────────────────────────────────────────────────────────
  const sendDoubt = async () => {
    if (!doubtText.trim()) return;
    try {
      await api.post('/live/doubts', {
        session_id: Number(sessionId),
        question: doubtText,
        is_anonymous: true,
      });
      setDoubtText('');
      refreshDoubts();
      wsRef.current?.send(JSON.stringify({ type: 'doubt_posted', question: doubtText }));
    } catch {}
  };
  const sendResonance = (id) => {
    setDoubts((d) =>
      d.map((x) => (x.id === id ? { ...x, resonance_count: (x.resonance_count || 0) + 1 } : x))
    );
    wsRef.current?.send(JSON.stringify({ type: 'resonance', doubt_id: id }));
  };
  const submitPulse = async () => {
    if (!pulse || !pulseAnswer) return;
    try {
      await api.post(`/live/pulse/${pulse.pulse_id}/respond`, { answer: pulseAnswer });
      wsRef.current?.send(
        JSON.stringify({ type: 'pulse_response', pulse_id: pulse.pulse_id, answer: pulseAnswer })
      );
    } catch {}
  };
  // F04 — submit answer for the new live pulse-check overlay
  const submitLivePulse = async () => {
    if (!livePulse || !livePulseChoice || livePulseSubmitted) return;
    setLivePulseSubmitted(true);
    try {
      await api.post(`/live/sessions/${sessionId}/pulse-response`, {
        pulse_id: livePulse.pulse_id,
        chosen_option: livePulseChoice,
        participant_id: info?.guest ? info?.participant_id || null : null,
      });
    } catch (_) {
      setLivePulseSubmitted(false);
    }
  };
  const completeLiveness = async () => {
    try {
      await api.post('/live/liveness-check', {
        challenge_token: livenessChallenge?.challenge_token,
        success: true,
      });
    } catch {}
    setLivenessChallenge(null);
  };
  const leave = async () => {
    try {
      await leaveChannel();
    } catch {}
    try {
      await api.post('/live/leave', { session_id: Number(sessionId) });
    } catch {}
    const { clearGuestSession } = await import('./guestSessionStore.js');
    clearGuestSession();
    navigate('/');
  };

  const conn =
    bandwidth === 'good' ? 'bg-emerald-500' : bandwidth === 'poor' ? 'bg-amber-500' : 'bg-red-500';

  // Enrich remote users with real names + role flagging (teacher = the
  // Agora UID stored on the join response).
  const enrichedRemote = useMemo(
    () =>
      remoteUsers.map((ru) => {
        const named = participantNames[String(ru.uid)];
        const role =
          teacherAgoraUid && Number(ru.uid) === Number(teacherAgoraUid)
            ? 'teacher'
            : named?.role === 'guest'
              ? 'guest'
              : 'student';
        return {
          ...ru,
          name: named?.name || `User ${ru.uid}`,
          role,
          aiObservation: null,
          attentionLevel: null,
          isHandRaised: false,
        };
      }),
    [remoteUsers, participantNames, teacherAgoraUid]
  );

  if (error) return <div className="p-10 text-center text-red-600">{error}</div>;
  if (!info) return <div className="p-10 text-center text-slate-400">Loading session…</div>;

  // ──────────────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-slate-900 text-white">
      {/* Session-ended overlay */}
      {sessionEnded && (
        <div className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-6xl mb-4">✅</p>
            <p className="text-white text-2xl font-bold mb-2">Session Ended</p>
            <p className="text-gray-400 text-sm">Redirecting you now…</p>
          </div>
        </div>
      )}
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-bold">LIVE</span>
          <span className="text-xs text-slate-400">{fmt(secs)}</span>
          <span className="text-sm ml-3">
            {info.session?.title || info.title || 'Live Session'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${conn}`} />
            {bandwidth}
          </span>
          <button onClick={leave} className="px-3 py-1 bg-red-600 rounded font-semibold">
            🚪 Leave
          </button>
        </div>
      </div>

      {/* F10 — breakout assignment banner */}
      {breakoutAssignment && (
        <div className="mx-4 mt-3 bg-amber-900/30 border border-amber-500/40 rounded-xl p-3 flex items-center justify-between">
          <div>
            <p className="text-amber-200 text-sm font-bold">
              🤝 You're in {breakoutAssignment.name}
            </p>
            {breakoutAssignment.topic && (
              <p className="text-amber-100/70 text-xs mt-0.5">Topic: {breakoutAssignment.topic}</p>
            )}
          </div>
          <span className="text-[11px] text-amber-200/70">
            Stay engaged — teacher is monitoring.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 p-4">
        {/* MAIN VIDEO AREA */}
        <div className="lg:col-span-3 bg-slate-800 rounded-2xl overflow-hidden">
          {bandwidth === 'poor' ? (
            <div className="p-6 space-y-3">
              <div className="bg-amber-900/30 border border-amber-500/40 rounded-xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📶</span>
                  <div>
                    <p className="font-bold text-amber-200">Low bandwidth detected</p>
                    <p className="text-xs text-amber-300/80">Switched to text mode</p>
                  </div>
                </div>
                {summaryUpdating && (
                  <span className="text-amber-300/70 text-xs animate-pulse">Updating…</span>
                )}
              </div>
              <div className="bg-slate-900 rounded-xl p-4">
                <p className="text-xs text-slate-400 uppercase mb-2">📝 Live AI Summary</p>
                <p className="text-sm text-slate-200 leading-relaxed">
                  {liveSummary || microSummary?.text || 'Connecting to class summary…'}
                </p>
                {microSummary?.key_term && (
                  <p className="text-xs text-violet-300 mt-2">Key term: {microSummary.key_term}</p>
                )}
                <p className="text-xs text-slate-500 mt-3">
                  Updates every 2 minutes · Doubt wall still works
                </p>
              </div>
            </div>
          ) : (
            <div className="relative aspect-video bg-black">
              {agoraLoading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">Connecting to video…</p>
                  </div>
                </div>
              )}

              {agoraError && (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <div className="bg-red-900/30 border border-red-500/40 rounded-xl p-4 max-w-sm text-center">
                    <p className="text-red-400 text-sm">⚠️ {agoraError}</p>
                    <button
                      onClick={initClient}
                      className="mt-3 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded-lg"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}

              {!agoraLoading && !agoraError && agoraJoined && (
                <div className="absolute inset-0 p-2">
                  <VideoGrid
                    participants={enrichedRemote}
                    localUid={agoraCfg.uid}
                    localName={
                      user?.name ||
                      getGuestSession(sessionId)?.name ||
                      info.session?.guest_name ||
                      'You'
                    }
                    localVideoTrack={localVideoTrackRef.current}
                    localVideoEnabled={localVideoEnabled}
                    localAudioEnabled={localAudioEnabled}
                    speakingUsers={speakingUsers}
                    activeSpeakerUid={activeSpeakerUid}
                    pinnedUid={null}
                    isTeacher={false}
                    viewMode="speaker"
                  />
                </div>
              )}

              {!agoraLoading && !agoraError && !agoraJoined && !agoraCfg.token && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-slate-400 text-sm text-center px-6">
                    📹 Video stream will appear here when the teacher publishes.
                    <br />
                    <span className="text-xs">(Agora token not yet configured)</span>
                  </div>
                </div>
              )}

              {/* AI Whiteboard overlay — shown when teacher shares */}
              {sharedWhiteboard && (
                <div className="absolute top-3 right-3 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-20">
                  <div className="flex items-center justify-between bg-violet-600 px-3 py-2">
                    <span className="text-white text-xs font-medium">🖼️ AI Whiteboard</span>
                    <button
                      onClick={() => setSharedWhiteboard(null)}
                      className="text-white/80 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  </div>
                  <MermaidRenderer code={sharedWhiteboard} minHeight={140} />
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-center gap-2 p-3 bg-slate-900/60 border-t border-slate-700">
            <button
              onClick={toggleAudio}
              className={`px-3 py-1.5 rounded text-xs ${localAudioEnabled ? 'bg-slate-700 text-white' : 'bg-red-600 text-white'}`}
            >
              {localAudioEnabled ? '🎤 Mic' : '🔇 Muted'}
            </button>
            <button
              onClick={toggleVideo}
              className={`px-3 py-1.5 rounded text-xs ${localVideoEnabled ? 'bg-slate-700 text-white' : 'bg-red-600 text-white'}`}
            >
              {localVideoEnabled ? '📷 Cam' : '📷 Off'}
            </button>
            <button
              onClick={() => wsRef.current?.send(JSON.stringify({ type: 'hand_raised' }))}
              className="px-3 py-1.5 bg-violet-600 rounded text-xs"
            >
              ✋ Raise Hand
            </button>
          </div>
        </div>

        {/* RIGHT TABS */}
        <div
          className="lg:col-span-2 bg-white rounded-2xl text-slate-800 overflow-hidden flex flex-col"
          style={{ maxHeight: '80vh' }}
        >
          <div className="flex border-b border-slate-200">
            {[
              ['wall', '💬 Wall'],
              ['pulse', '⚡ Pulse'],
              ['progress', '📊 Progress'],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 py-3 text-sm font-semibold ${tab === k ? 'border-b-2 border-violet-600 text-violet-700' : 'text-slate-500'}`}
              >
                {l}
              </button>
            ))}
          </div>

          {tab === 'wall' && (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {doubts.length === 0 && (
                  <p className="text-center text-slate-400 text-sm py-4">
                    No doubts yet. Be the first!
                  </p>
                )}
                {doubts.map((d) => (
                  <div key={d.id} className="border border-slate-200 rounded-lg p-3">
                    <p className="text-sm">{d.question || d.title}</p>
                    {(d.ai_answer || d.answer) && (
                      <p className="text-xs mt-1 px-2 py-1 rounded bg-violet-50 text-violet-700">
                        {d.answered_by ? `✅ ${d.answered_by}: ` : '🤖 AI: '}{' '}
                        {d.answer || d.ai_answer}
                      </p>
                    )}
                    <button
                      onClick={() => sendResonance(d.id)}
                      className="mt-2 text-xs text-orange-600 font-semibold"
                    >
                      🔥 +1 ({d.resonance_count || 0})
                    </button>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-slate-200 flex gap-2">
                <input
                  value={doubtText}
                  onChange={(e) => setDoubtText(e.target.value)}
                  placeholder="Ask anonymously…"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <button
                  onClick={sendDoubt}
                  className={`px-4 py-2 text-white text-sm font-semibold rounded-lg bg-gradient-to-r ${VIOLET}`}
                >
                  Send
                </button>
              </div>
            </>
          )}

          {tab === 'pulse' && (
            <div className="flex-1 overflow-y-auto p-4">
              {!pulse && !pulseResult && (
                <p className="text-sm text-slate-500 text-center py-8">
                  No active pulse check.
                  <br />
                  Wait for your teacher.
                </p>
              )}
              {pulse && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold">⚡ Pulse Check</h3>
                    <span className="text-xs text-slate-500">⏱ {pulse.duration || 30}s</span>
                  </div>
                  <p className="text-sm font-semibold">{pulse.question}</p>
                  <div className="space-y-2">
                    {Object.entries(pulse.options || {}).map(([k, v]) => (
                      <label
                        key={k}
                        className={`block p-3 border rounded-lg cursor-pointer ${pulseAnswer === k ? 'border-violet-500 bg-violet-50' : 'border-slate-200'}`}
                      >
                        <input
                          type="radio"
                          name="pulse"
                          checked={pulseAnswer === k}
                          onChange={() => setPulseAnswer(k)}
                          className="mr-2"
                        />
                        <b className="mr-2">{k}.</b>
                        {v}
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={submitPulse}
                    disabled={!pulseAnswer}
                    className={`w-full py-2 text-white font-semibold rounded-lg bg-gradient-to-r ${VIOLET} disabled:opacity-50`}
                  >
                    Submit Answer
                  </button>
                </div>
              )}
              {pulseResult && (
                <div className="space-y-3">
                  <p className="text-sm">
                    Correct answer: <b>{pulseResult.correct_answer}</b>
                  </p>
                  <p className="text-sm">
                    Your answer: <b>{pulseResult.your_answer}</b>
                    {pulseResult.your_answer === pulseResult.correct_answer ? ' ✅' : ' ❌'}
                  </p>
                  {pulseResult.explanation && (
                    <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded">
                      {pulseResult.explanation}
                    </p>
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
                Attendance is counted after staying for the minimum required minutes set by your
                college.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* F04 — Live Pulse Check overlay */}
      {livePulse && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md">
          <div className="bg-gray-900/95 backdrop-blur border border-violet-500/40 rounded-2xl shadow-2xl text-white p-4">
            {!livePulseResult && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-violet-400 font-bold text-xs uppercase tracking-wider">
                    ⚡ Pulse Check
                  </span>
                  <span className="font-mono text-lg font-bold">{livePulseTimer}s</span>
                </div>
                <p className="font-medium text-sm mb-3">{livePulse.question}</p>
                {!livePulseSubmitted && (
                  <>
                    <div className="space-y-2 mb-3">
                      {['A', 'B', 'C', 'D'].map((opt) => {
                        const text = livePulse[`option_${opt.toLowerCase()}`];
                        if (!text || text === 'N/A') return null;
                        const selected = livePulseChoice === opt;
                        return (
                          <button
                            key={opt}
                            onClick={() => setLivePulseChoice(opt)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition
                              ${
                                selected
                                  ? 'bg-violet-600 border-violet-400 text-white'
                                  : 'bg-gray-800 border-gray-700 hover:border-violet-500/50'
                              }`}
                          >
                            <span className="font-bold mr-2">{opt}.</span>
                            {text}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={submitLivePulse}
                      disabled={!livePulseChoice}
                      className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-40
                                 text-white font-bold py-2 rounded-lg text-sm"
                    >
                      Submit Answer
                    </button>
                  </>
                )}
                {livePulseSubmitted && (
                  <p className="text-emerald-400 text-sm text-center py-2">
                    ✅ Submitted! Waiting for class…
                  </p>
                )}
              </>
            )}
            {livePulseResult && (
              <>
                <p className="text-violet-400 font-bold text-xs uppercase tracking-wider mb-2">
                  📊 Results
                </p>
                <p className="text-sm mb-3">{livePulse.question}</p>
                {livePulseResult.correct_option && (
                  <p className="text-emerald-400 text-sm mb-1">
                    Correct answer: <b>{livePulseResult.correct_option}</b>
                    {livePulseChoice &&
                      (livePulseChoice === livePulseResult.correct_option ? (
                        <span className="ml-2 text-emerald-300">— You got it! 🎉</span>
                      ) : (
                        <span className="ml-2 text-red-300">— You picked {livePulseChoice}</span>
                      ))}
                  </p>
                )}
                {livePulseResult.ai_insight && (
                  <p className="text-blue-300 text-xs mt-2">🤖 {livePulseResult.ai_insight}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* F13 — Pre-class personalised warmup overlay (shown before joining) */}
      {warmup && showWarmup && (
        <div className="fixed inset-0 bg-black/80 z-[55] flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-violet-500/40 rounded-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">{warmup.type === 'refresher' ? '📚' : '🚀'}</span>
              <span className="text-violet-400 font-bold text-sm uppercase tracking-wide">
                {warmup.type === 'refresher' ? 'Quick Refresher' : 'Preview'}
              </span>
            </div>
            {warmup.focus_topics?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {warmup.focus_topics.map((t) => (
                  <span
                    key={t}
                    className="text-xs bg-violet-900/50 text-violet-300 px-2 py-0.5 rounded-full"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <p className="text-gray-200 text-sm leading-relaxed mb-5">{warmup.content}</p>
            <button
              onClick={() => setShowWarmup(false)}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold py-3 rounded-xl text-sm"
            >
              ✅ Got it — Join Class
            </button>
          </div>
        </div>
      )}

      {/* Liveness overlay */}
      {livenessChallenge && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <p className="text-white text-lg mb-4">
              Click the 🌟 to confirm you're paying attention
            </p>
            <button
              onClick={completeLiveness}
              style={{
                marginLeft: `${livenessChallenge?.button_position?.x || 50}%`,
                marginTop: `${livenessChallenge?.button_position?.y || 0}%`,
              }}
              className="text-5xl bg-violet-600 rounded-full w-20 h-20 hover:scale-110 transition"
            >
              🌟
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
