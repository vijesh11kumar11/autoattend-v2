/**
 * VideoGrid — adaptive layout that switches between speaker / grid /
 * focus modes. Renders the local user as one tile and `participants`
 * (remote users with name/role enrichment) as the rest.
 *
 * Selection rule for the "main" tile:
 *   pinnedUid → activeSpeakerUid → first teacher → local
 */

import { VideoTile } from './VideoTile';

export function VideoGrid({
  participants = [],
  localUid, localName,
  localVideoTrack, localVideoEnabled, localAudioEnabled,
  speakingUsers = new Set(),
  activeSpeakerUid = null,
  pinnedUid = null,
  onPin,
  onMute,
  isTeacher = false,
  viewMode = 'speaker',
}) {
  const localTile = (size) => (
    <VideoTile
      track={localVideoTrack}
      uid={localUid}
      name={localName || 'You'}
      role={isTeacher ? 'teacher' : 'student'}
      isSpeaking={speakingUsers.has(localUid)}
      isLocal
      videoEnabled={localVideoEnabled}
      audioEnabled={localAudioEnabled}
      size={size}
    />
  );

  const remoteTile = (p, size) => (
    <VideoTile
      key={p.uid}
      track={p.videoTrack}
      uid={p.uid}
      name={p.name}
      role={p.role}
      isSpeaking={speakingUsers.has(p.uid)}
      isLocal={false}
      videoEnabled={p.hasVideo}
      audioEnabled={p.hasAudio}
      aiObservation={p.aiObservation}
      attentionLevel={p.attentionLevel}
      isHandRaised={p.isHandRaised}
      isPinned={pinnedUid === p.uid}
      onPin={onPin}
      onMute={isTeacher ? onMute : undefined}
      size={size}
    />
  );

  const total = participants.length + 1;

  // ── FOCUS — only the teacher tile, large ────────────────────────────
  if (viewMode === 'focus') {
    const teacher = participants.find(p => p.role === 'teacher');
    if (teacher) return <div className="h-full">{remoteTile(teacher, 'large')}</div>;
    return <div className="h-full">{localTile('large')}</div>;
  }

  // ── GRID — every tile equal size ───────────────────────────────────
  if (viewMode === 'grid') {
    const cols = total <= 1 ? 'grid-cols-1'
              : total <= 4 ? 'grid-cols-2'
              : total <= 9 ? 'grid-cols-3'
              : 'grid-cols-4';
    return (
      <div className={`grid ${cols} gap-2 h-full content-start`}>
        {localTile('medium')}
        {participants.map(p => remoteTile(p, 'medium'))}
      </div>
    );
  }

  // ── SPEAKER (default) ──────────────────────────────────────────────
  // Pick main tile
  const mainUid = pinnedUid
    ?? activeSpeakerUid
    ?? participants.find(p => p.role === 'teacher')?.uid
    ?? localUid;

  const isMainLocal = mainUid === localUid;
  const mainParticipant = isMainLocal ? null : participants.find(p => p.uid === mainUid);

  // If we couldn't find the main participant (e.g. they just left), fall back to local.
  const useLocalAsMain = isMainLocal || !mainParticipant;

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Main */}
      <div className="flex-1 relative min-h-0">
        {useLocalAsMain ? localTile('large') : remoteTile(mainParticipant, 'large')}

        {activeSpeakerUid && activeSpeakerUid === (useLocalAsMain ? localUid : mainParticipant?.uid) && (
          <div className="absolute top-3 left-3 bg-violet-600/85 backdrop-blur-sm rounded-full px-3 py-1 text-white text-xs font-medium flex items-center gap-1.5 shadow-lg">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            Speaking
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {total > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 shrink-0">
          {!useLocalAsMain && <div className="shrink-0">{localTile('small')}</div>}
          {participants
            .filter(p => p.uid !== (useLocalAsMain ? null : mainParticipant.uid))
            .map(p => <div key={p.uid} className="shrink-0">{remoteTile(p, 'small')}</div>)}
        </div>
      )}
    </div>
  );
}

export default VideoGrid;
