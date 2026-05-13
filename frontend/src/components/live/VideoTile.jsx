/**
 * VideoTile — single participant tile.
 *
 * Pure presentation component. Plays an Agora video track inside a
 * container element using the SDK's track.play(htmlElement) API.
 *
 * AI overlays (observation badge + attention dot) are what makes this
 * tile distinct from a vanilla Zoom tile.
 */

import { useEffect, useRef } from 'react';

const SIZE_CLASSES = {
  large:     'w-full h-full min-h-[400px]',
  medium:    'w-full aspect-video',
  small:     'w-44 h-28',
  thumbnail: 'w-24 h-16',
};

function networkColor(q) {
  if (!q || q === 0) return 'text-gray-400';
  if (q <= 2) return 'text-emerald-400';
  if (q <= 4) return 'text-amber-400';
  return 'text-red-400';
}

function networkIcon(q) {
  if (!q || q <= 2) return '📶';
  if (q <= 4) return '📶';
  return '⚠️';
}

const ATTENTION_RING = {
  high:   'ring-2 ring-emerald-500',
  medium: 'ring-2 ring-amber-400',
  low:    'ring-2 ring-red-500 ring-opacity-70',
};

export function VideoTile({
  track, uid, name, role,
  isSpeaking, isLocal,
  videoEnabled, audioEnabled,
  networkQuality, aiObservation, attentionLevel,
  isHandRaised, isPinned,
  onPin, onMute, size = 'medium',
}) {
  const videoRef = useRef(null);

  // Play / re-play the track whenever it changes.
  useEffect(() => {
    const node = videoRef.current;
    if (!track || !node || !videoEnabled) return undefined;
    try { track.play(node, { fit: 'cover' }); } catch (e) { /* ignore */ }
    return () => { try { track.stop(); } catch (_) {} };
  }, [track, videoEnabled]);

  const initial = (name || '?').charAt(0).toUpperCase();

  return (
    <div
      className={[
        'relative bg-gray-900 rounded-xl overflow-hidden transition-all duration-200 group',
        SIZE_CLASSES[size] || SIZE_CLASSES.medium,
        isSpeaking ? 'ring-2 ring-violet-400' : '',
        attentionLevel ? (ATTENTION_RING[attentionLevel] || '') : '',
        isPinned ? 'ring-2 ring-amber-400' : '',
      ].filter(Boolean).join(' ')}
    >
      {/* Video element — Agora SDK injects a <video> here */}
      {videoEnabled && track ? (
        <div
          ref={videoRef}
          className="absolute inset-0 w-full h-full"
          style={isLocal ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
          <div className="w-16 h-16 rounded-full bg-violet-700 flex items-center justify-center text-white text-2xl font-bold">
            {initial}
          </div>
        </div>
      )}

      {/* Speaking equaliser */}
      {isSpeaking && audioEnabled && (
        <div className="absolute bottom-9 left-2 flex gap-0.5 items-end pointer-events-none">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="w-1 bg-violet-300 rounded-full animate-pulse"
              style={{ height: `${10 + ((i * 5) % 12)}px`, animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </div>
      )}

      {/* Bottom name bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        <div className="flex items-center justify-between">
          <span className="text-white text-xs font-medium truncate">
            {isLocal ? `${name || 'You'} (You)` : (name || `User ${uid}`)}
            {role === 'teacher' && ' 👩‍🏫'}
            {role === 'guest'   && ' 👤'}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {!audioEnabled && <span className="text-red-400 text-xs">🔇</span>}
            {isHandRaised && <span className="text-amber-400 text-xs animate-bounce">✋</span>}
            <span className={`text-xs ${networkColor(networkQuality)}`}>{networkIcon(networkQuality)}</span>
          </div>
        </div>
      </div>

      {/* AI observation hover badge (the differentiator) */}
      {aiObservation && (
        <div className="absolute top-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-black/80 backdrop-blur-sm rounded-lg p-2 border border-violet-500/50">
            <div className="flex items-start gap-1.5">
              <span className="text-violet-400 text-xs mt-0.5">🤖</span>
              <p className="text-violet-200 text-xs leading-tight">{aiObservation}</p>
            </div>
          </div>
        </div>
      )}

      {/* Attention dot */}
      {attentionLevel && !aiObservation && (
        <div className="absolute top-2 right-2 pointer-events-none">
          <div
            className={[
              'w-2.5 h-2.5 rounded-full',
              attentionLevel === 'high'   ? 'bg-emerald-400' :
              attentionLevel === 'medium' ? 'bg-amber-400'   :
              'bg-red-400 animate-pulse',
            ].join(' ')}
            title={`Attention: ${attentionLevel}`}
          />
        </div>
      )}

      {/* Teacher: mute participant */}
      {onMute && !isLocal && (
        <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onMute(uid)}
            title="Mute participant"
            className="bg-black/60 hover:bg-red-900/70 text-white rounded-lg p-1.5 text-xs"
          >
            🔇
          </button>
        </div>
      )}

      {/* Pin / unpin */}
      {onPin && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onPin(uid)}
            title={isPinned ? 'Unpin' : 'Pin to main view'}
            className={`rounded-lg p-1.5 text-xs text-white ${isPinned ? 'bg-amber-600' : 'bg-black/60 hover:bg-black/80'}`}
          >
            📌
          </button>
        </div>
      )}

      {/* Local "Camera off" hint */}
      {isLocal && !videoEnabled && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-gray-500 text-xs">Camera off</span>
        </div>
      )}
    </div>
  );
}

export default VideoTile;
