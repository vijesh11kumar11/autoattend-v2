/**
 * SmartReplayPage — text-based replay of a completed live session (issue #118).
 *
 * Mounted at /{role}/live/:sessionId/replay.
 *
 *   • Teacher / HOD / Principal: full event timeline + every student clip request.
 *   • Student (attended only): same timeline + "Ask about a topic" → AI clip.
 *
 * Degrades gracefully when the AI keys are not configured (timeline still
 * works; clip requests return a "not configured" message).
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const VIOLET = 'from-violet-600 via-purple-600 to-fuchsia-600';
const STAFF_ROLES = ['teacher', 'hod', 'principal'];

const EVENT_LABELS = {
  session_start: '▶️ Start',
  session_end: '⏹ End',
  student_joined: '🙋 Joined',
  student_left: '👋 Left',
  ai_observation: '🤖 AI',
  ai_intervention: '🚨 Intervention',
  teacher_response: '🧑‍🏫 Teacher',
  confusion_detected: '😕 Confusion',
  topic_change: '🔀 Topic',
  pace_alert: '⏱ Pace',
  pulse_check_started: '⚡ Pulse',
  pulse_check_ended: '✅ Pulse done',
  hot_doubt_detected: '🔥 Hot doubt',
  whiteboard_generated: '📝 Whiteboard',
};

function fmtOffset(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function eventLabel(t) {
  return EVENT_LABELS[t] || t?.replace(/_/g, ' ') || 'event';
}

/* ── Horizontal timeline of event dots ─────────────────────────────── */
function Timeline({ events, onSelect, selectedId, highlight }) {
  const maxOffset = useMemo(
    () => Math.max(1, ...events.map((e) => e.offset_seconds || 0)),
    [events],
  );
  if (!events.length) {
    return <p className="text-slate-400 text-sm py-6 text-center">No events recorded for this session.</p>;
  }
  return (
    <div className="relative py-10 px-2 overflow-x-auto">
      <div className="relative h-1.5 bg-slate-200 rounded-full min-w-full" style={{ minWidth: 520 }}>
        {highlight && (
          <div
            className="absolute h-1.5 bg-emerald-400/60 rounded-full"
            style={{
              left: `${((highlight.start || 0) / maxOffset) * 100}%`,
              width: `${(Math.max(0, (highlight.end || 0) - (highlight.start || 0)) / maxOffset) * 100}%`,
            }}
          />
        )}
        {events.map((e) => {
          const left = `${((e.offset_seconds || 0) / maxOffset) * 100}%`;
          const active = e.id === selectedId;
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e)}
              title={`${fmtOffset(e.offset_seconds)} · ${eventLabel(e.event_type)}`}
              className={`absolute -top-2 -ml-2 w-4 h-4 rounded-full border-2 border-white shadow transition-transform hover:scale-125 ${
                active ? 'bg-fuchsia-600 scale-125' : 'bg-violet-500'
              }`}
              style={{ left }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-3" style={{ minWidth: 520 }}>
        <span>0:00</span>
        <span>{fmtOffset(maxOffset)}</span>
      </div>
    </div>
  );
}

/* ── Ask-about-a-topic modal (students) ────────────────────────────── */
function AskTopicModal({ sessionId, onClose, onResult }) {
  const [topic, setTopic] = useState('');
  const [doubt, setDoubt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (topic.trim().length < 2) {
      setErr('Please enter a topic.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await api.post(`/smart-replay/${sessionId}/clip-request`, {
        topic: topic.trim(),
        doubt_text: doubt.trim(),
      });
      onResult(r.data);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.detail || 'Failed to analyse your doubt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-800 mb-1">🎯 Ask about a topic</h3>
        <p className="text-xs text-slate-500 mb-4">
          The AI will find the part of this class where your topic was taught.
        </p>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Topic</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={300}
          placeholder="e.g. Newton's second law"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 text-sm focus:ring-2 focus:ring-violet-400 outline-none"
        />
        <label className="block text-xs font-semibold text-slate-600 mb-1">Your doubt (optional)</label>
        <textarea
          value={doubt}
          onChange={(e) => setDoubt(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="What exactly confused you?"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 text-sm focus:ring-2 focus:ring-violet-400 outline-none"
        />
        {err && <p className="text-red-600 text-xs mb-2">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? 'Analysing…' : 'Find clip'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClipCard({ clip, showStudent }) {
  return (
    <div className="border border-violet-100 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-800 text-sm">{clip.topic}</p>
        {clip.ai_confidence != null && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
            {Math.round(clip.ai_confidence * 100)}% match
          </span>
        )}
      </div>
      {showStudent && clip.student_name && (
        <p className="text-[11px] text-slate-400 mt-0.5">by {clip.student_name}</p>
      )}
      {clip.doubt_text && <p className="text-xs text-slate-500 mt-1 italic">“{clip.doubt_text}”</p>}
      {clip.start_offset_seconds != null ? (
        <p className="text-sm text-emerald-700 mt-2 font-medium">
          ⏱ {fmtOffset(clip.start_offset_seconds)} – {fmtOffset(clip.end_offset_seconds)}
        </p>
      ) : (
        <p className="text-xs text-amber-600 mt-2">Segment not identified.</p>
      )}
      {clip.ai_explanation && <p className="text-xs text-slate-600 mt-1">{clip.ai_explanation}</p>}
    </div>
  );
}

export default function SmartReplayPage() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const isStaff = STAFF_ROLES.includes(user?.role);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);
  const [clips, setClips] = useState([]);
  const [showAsk, setShowAsk] = useState(false);
  const [highlight, setHighlight] = useState(null);

  const loadClips = () => {
    const url = isStaff
      ? `/smart-replay/${sessionId}/all-clips`
      : `/smart-replay/${sessionId}/my-clips`;
    api
      .get(url)
      .then((r) => setClips(r.data?.clips || []))
      .catch(() => {});
  };

  useEffect(() => {
    setLoading(true);
    api
      .get(`/smart-replay/${sessionId}`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.data?.detail || 'Failed to load replay'))
      .finally(() => setLoading(false));
    loadClips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (loading) return <div className="p-10 text-center text-slate-400">Loading replay…</div>;
  if (err) return <div className="bg-red-50 text-red-700 p-4 rounded-lg max-w-3xl mx-auto">{err}</div>;
  if (!data) return null;

  const meta = data.session || {};
  const events = data.timeline || [];

  const onClipResult = (res) => {
    if (res?.clip) {
      setHighlight({ start: res.clip.start_offset_seconds, end: res.clip.end_offset_seconds });
    }
    loadClips();
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className={`bg-gradient-to-r ${VIOLET} rounded-2xl p-6 text-white shadow-lg`}>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <span className="text-3xl">⏪</span> Smart Replay
        </h1>
        <p className="text-white/80 mt-1 text-sm">
          {meta.title || `Session #${sessionId}`}
          {meta.subject ? ` · ${meta.subject}` : ''}
          {meta.duration_minutes ? ` · ${meta.duration_minutes} min` : ''}
        </p>
        <p className="text-white/60 text-xs mt-1">
          {meta.teacher ? `Teacher: ${meta.teacher} · ` : ''}
          {meta.participant_count != null ? `${meta.participant_count} participants` : ''}
        </p>
      </div>

      {!data.ai_enabled && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl p-3">
          AI analysis is not configured — the timeline is available, but topic clips are disabled.
        </div>
      )}

      {/* Timeline */}
      <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-800">🕒 Session Timeline</h3>
          {!isStaff && data.ai_enabled && (
            <button
              onClick={() => setShowAsk(true)}
              className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700"
            >
              🎯 Ask about a topic
            </button>
          )}
        </div>
        <Timeline events={events} onSelect={setSelected} selectedId={selected?.id} highlight={highlight} />

        {selected && (
          <div className="mt-2 border border-violet-100 rounded-xl p-4 bg-violet-50/40">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-800 text-sm">{eventLabel(selected.event_type)}</p>
              <span className="text-xs text-slate-500">{fmtOffset(selected.offset_seconds)}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">by {selected.actor_name}</p>
            {selected.data?.ai_observation && (
              <p className="text-sm text-slate-700 mt-2">{selected.data.ai_observation}</p>
            )}
            {selected.data?.teacher_action && (
              <p className="text-xs text-slate-600 mt-1">Action: {selected.data.teacher_action}</p>
            )}
          </div>
        )}
      </div>

      {/* Clips */}
      <div className="bg-white rounded-2xl border border-violet-100 shadow-sm p-5">
        <h3 className="font-bold text-slate-800 mb-3">
          {isStaff ? '📋 Student Clip Requests' : '🎬 My Clips'}
          <span className="text-slate-400 font-normal text-sm ml-2">({clips.length})</span>
        </h3>
        {clips.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">
            {isStaff ? 'No clip requests yet.' : 'You have not requested any clips yet.'}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {clips.map((c) => (
              <ClipCard key={c.id} clip={c} showStudent={isStaff} />
            ))}
          </div>
        )}
      </div>

      {showAsk && (
        <AskTopicModal sessionId={sessionId} onClose={() => setShowAsk(false)} onResult={onClipResult} />
      )}
    </div>
  );
}
