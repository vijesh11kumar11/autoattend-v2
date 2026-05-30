/**
 * useAgoraRTC — Core video engine hook for AutoAttend Live.
 *
 * Wraps agora-rtc-sdk-ng for both teachers (host/publisher) and
 * students/guests (audience/subscriber). Returns:
 *   - state    : isJoined, isLoading, error, remoteUsers, network quality,
 *                speaking detection, active speaker
 *   - controls : initClient, leaveChannel, toggle mic/cam, screen share
 *   - refs     : local tracks + client (for direct DOM playback)
 *
 * The hook lazy-loads the Agora SDK on first init() so the bundle stays
 * lean for users who never enter a live session.
 *
 * Lifecycle:
 *   • Caller is responsible for calling initClient() exactly once when
 *     the session goes live, and leaveChannel() before unmount.
 *   • The component unmount auto-cleanup is a safety net only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Speaking-volume threshold (0–100). Below this we treat as background noise.
const SPEAKING_VOLUME_THRESHOLD = 15;

export function useAgoraRTC({ appId, channel, token, uid, role = 'audience' }) {
  const clientRef = useRef(null);
  const localVideoTrackRef = useRef(null);
  const localAudioTrackRef = useRef(null);
  const cameraTrackBackupRef = useRef(null); // saved while screen-sharing

  const [remoteUsers, setRemoteUsers] = useState([]);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
  const [localAudioEnabled, setLocalAudioEnabled] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [networkQuality, setNetworkQuality] = useState(null);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [activeSpeakerUid, setActiveSpeakerUid] = useState(null);

  // ─── INIT ────────────────────────────────────────────────────────────
  const initClient = useCallback(async () => {
    if (!appId || !channel || !token) {
      setError('Missing Agora configuration (appId / channel / token).');
      return false;
    }
    if (clientRef.current) return true; // already initialised

    setIsLoading(true);
    setError(null);

    try {
      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
      AgoraRTC.setLogLevel(3); // ERROR only — quiet console

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      // Remote user started publishing
      client.on('user-published', async (user, mediaType) => {
        try {
          await client.subscribe(user, mediaType);
        } catch (e) {
          console.warn('Agora subscribe failed', e);
          return;
        }
        if (mediaType === 'video') {
          setRemoteUsers((prev) => {
            const idx = prev.findIndex((u) => u.uid === user.uid);
            const patch = { videoTrack: user.videoTrack, hasVideo: true };
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...patch };
              return copy;
            }
            return [
              ...prev,
              {
                uid: user.uid,
                videoTrack: user.videoTrack,
                audioTrack: null,
                hasVideo: true,
                hasAudio: false,
              },
            ];
          });
        }
        if (mediaType === 'audio') {
          try {
            user.audioTrack?.play();
          } catch (_) {
            /* ignore */
          }
          setRemoteUsers((prev) => {
            const idx = prev.findIndex((u) => u.uid === user.uid);
            const patch = { audioTrack: user.audioTrack, hasAudio: true };
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...patch };
              return copy;
            }
            return [
              ...prev,
              {
                uid: user.uid,
                videoTrack: null,
                audioTrack: user.audioTrack,
                hasVideo: false,
                hasAudio: true,
              },
            ];
          });
        }
      });

      client.on('user-unpublished', (user, mediaType) => {
        setRemoteUsers((prev) =>
          prev.map((u) => {
            if (u.uid !== user.uid) return u;
            if (mediaType === 'video') return { ...u, hasVideo: false, videoTrack: null };
            if (mediaType === 'audio') return { ...u, hasAudio: false, audioTrack: null };
            return u;
          })
        );
      });

      client.on('user-left', (user) => {
        setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
        setSpeakingUsers((prev) => {
          if (!prev.has(user.uid)) return prev;
          const next = new Set(prev);
          next.delete(user.uid);
          return next;
        });
      });

      client.on('network-quality', (stats) => {
        setNetworkQuality({
          uplink: stats.uplinkNetworkQuality,
          downlink: stats.downlinkNetworkQuality,
        });
      });

      // Volume / active-speaker detection
      client.enableAudioVolumeIndicator();
      client.on('volume-indicator', (volumes) => {
        const speaking = new Set();
        let maxVolume = 0;
        let maxUid = null;
        volumes.forEach(({ uid: speakerUid, level }) => {
          if (level > SPEAKING_VOLUME_THRESHOLD) {
            speaking.add(speakerUid);
            if (level > maxVolume) {
              maxVolume = level;
              maxUid = speakerUid;
            }
          }
        });
        setSpeakingUsers(speaking);
        setActiveSpeakerUid(maxUid);
      });

      // Join the channel
      await client.join(appId, channel, token, uid);

      // Host publishes mic + cam
      if (role === 'host') {
        const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
          {
            encoderConfig: { sampleRate: 48000, stereo: true, bitrate: 128 },
            ANS: true,
            AEC: true,
            AGC: true,
          },
          {
            encoderConfig: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: 30,
              bitrateMax: 1500,
              bitrateMin: 400,
            },
            facingMode: 'user',
          }
        );
        localAudioTrackRef.current = audioTrack;
        localVideoTrackRef.current = videoTrack;
        await client.publish([audioTrack, videoTrack]);
      }
      // Audience: subscribe-only by default; no local tracks created.

      setIsJoined(true);
      return true;
    } catch (err) {
      console.error('Agora init error:', err);
      setError(err?.message || 'Failed to join video session.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [appId, channel, token, uid, role]);

  // ─── CONTROLS ────────────────────────────────────────────────────────
  const toggleAudio = useCallback(async () => {
    const t = localAudioTrackRef.current;
    if (!t) return;
    const next = !localAudioEnabled;
    try {
      await t.setEnabled(next);
      setLocalAudioEnabled(next);
    } catch (e) {
      console.warn('toggleAudio failed', e);
    }
  }, [localAudioEnabled]);

  const toggleVideo = useCallback(async () => {
    const t = localVideoTrackRef.current;
    if (!t) return;
    const next = !localVideoEnabled;
    try {
      await t.setEnabled(next);
      setLocalVideoEnabled(next);
    } catch (e) {
      console.warn('toggleVideo failed', e);
    }
  }, [localVideoEnabled]);

  const startScreenShare = useCallback(async () => {
    if (!clientRef.current) return null;
    const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
    try {
      const screenTrack = await AgoraRTC.createScreenVideoTrack({
        encoderConfig: '1080p_1',
        optimizationMode: 'detail',
      });
      // Stash the camera track so we can restore it
      cameraTrackBackupRef.current = localVideoTrackRef.current;
      if (localVideoTrackRef.current) {
        try {
          await clientRef.current.unpublish(localVideoTrackRef.current);
        } catch (_) {}
      }
      localVideoTrackRef.current = screenTrack;
      await clientRef.current.publish(screenTrack);
      return screenTrack;
    } catch (e) {
      console.warn('startScreenShare failed', e);
      return null;
    }
  }, []);

  const stopScreenShare = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      const current = localVideoTrackRef.current;
      if (current) {
        try {
          await clientRef.current.unpublish(current);
        } catch (_) {}
        try {
          current.stop();
          current.close();
        } catch (_) {}
      }
      const cam = cameraTrackBackupRef.current;
      if (cam) {
        localVideoTrackRef.current = cam;
        cameraTrackBackupRef.current = null;
        await clientRef.current.publish(cam);
      } else {
        localVideoTrackRef.current = null;
      }
    } catch (e) {
      console.warn('stopScreenShare failed', e);
    }
  }, []);

  // ─── CLEANUP ─────────────────────────────────────────────────────────
  const leaveChannel = useCallback(async () => {
    try {
      const a = localAudioTrackRef.current;
      const v = localVideoTrackRef.current;
      const cam = cameraTrackBackupRef.current;
      [a, v, cam].forEach((t) => {
        if (!t) return;
        try {
          t.stop();
        } catch (_) {}
        try {
          t.close();
        } catch (_) {}
      });
      localAudioTrackRef.current = null;
      localVideoTrackRef.current = null;
      cameraTrackBackupRef.current = null;
      if (clientRef.current) {
        try {
          await clientRef.current.leave();
        } catch (_) {}
        clientRef.current = null;
      }
    } finally {
      setIsJoined(false);
      setRemoteUsers([]);
      setSpeakingUsers(new Set());
      setActiveSpeakerUid(null);
    }
  }, []);

  // Safety-net cleanup on unmount
  useEffect(() => {
    return () => {
      leaveChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // state
    isJoined,
    isLoading,
    error,
    localVideoEnabled,
    localAudioEnabled,
    remoteUsers,
    networkQuality,
    speakingUsers,
    activeSpeakerUid,
    // refs
    localVideoTrackRef,
    localAudioTrackRef,
    clientRef,
    // actions
    initClient,
    leaveChannel,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
  };
}

export default useAgoraRTC;
