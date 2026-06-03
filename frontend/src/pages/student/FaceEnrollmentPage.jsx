/**
 * TRACELN v2.0 — Face Enrollment Page (Student only)
 *
 * Mandatory for first-time students before accessing the dashboard.
 *
 * Flow:
 *   1. GET /api/face/liveness-session → get challenge (blink, smile, turn_left, etc.)
 *   2. Capture 3 frames via webcam (before, during, after action)
 *   3. POST /api/face/liveness-verify → submit frames
 *   4. On success → update context → redirect to /student/dashboard
 *
 * If Azure Face API is not configured, shows a skip option for development.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const CHALLENGE_LABELS = {
  blink: { icon: '👁️', label: 'Blink your eyes', tip: 'Blink naturally 2–3 times' },
  smile: { icon: '😊', label: 'Smile', tip: 'Give a natural smile' },
  turn_left: { icon: '👈', label: 'Turn your head left', tip: 'Slowly turn left and return' },
  turn_right: { icon: '👉', label: 'Turn your head right', tip: 'Slowly turn right and return' },
  open_mouth: { icon: '😮', label: 'Open your mouth', tip: 'Open wide, then close' },
};

export default function FaceEnrollmentPage() {
  const navigate = useNavigate();
  const { user, login: updateAuth } = useAuth();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // Callback ref: attaches stream to each new <video> element when it mounts
  const setVideoRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
    }
  }, []);

  const [step, setStep] = useState('intro'); // intro | camera | challenge | capturing | submitting | success | error
  const [challenge, setChallenge] = useState(null); // { challenge_id, challenge, expires_in }
  const [frames, setFrames] = useState([]); // captured Blob[]
  const [capturePhase, setCapturePhase] = useState(0); // 0=before, 1=during, 2=after
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  // Phase labels
  const phaseLabels = [
    'Hold still — capturing neutral face…',
    challenge
      ? `Now: ${CHALLENGE_LABELS[challenge.challenge]?.label || challenge.challenge}`
      : 'Perform the action…',
    'Return to neutral — capturing final frame…',
  ];

  // ── Cleanup camera on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // ── Start camera ──────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      streamRef.current = stream;
      // Set step first so the <video> element renders, then the callback ref
      // (setVideoRef) will attach the stream when the element mounts.
      // Also attach to current ref in case element already exists.
      setStep('camera');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError('');
    } catch (err) {
      setError('Camera access denied. Please allow camera permissions and try again.');
    }
  }, []);

  // ── Get liveness challenge from backend ───────────────────────────
  const requestChallenge = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.post('/face/liveness-session');
      setChallenge(data);
      setFrames([]);
      setCapturePhase(0);
      setStep('challenge');
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      // If Azure Face API isn't configured, show a helpful message
      if (detail.includes('Azure') || detail.includes('face') || err.response?.status === 500) {
        setError(
          'Face enrollment service is temporarily unavailable. You can skip for now and enroll later.'
        );
        setStep('error');
      } else {
        setError(detail);
        setStep('error');
      }
    }
  }, []);

  // ── Capture a frame from the video ────────────────────────────────
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    });
  }, []);

  // ── Auto-capture sequence ─────────────────────────────────────────
  const startCapture = useCallback(async () => {
    setStep('capturing');
    const capturedFrames = [];

    for (let phase = 0; phase < 3; phase++) {
      setCapturePhase(phase);

      // Countdown before capture
      for (let t = 3; t > 0; t--) {
        setCountdown(t);
        await new Promise((r) => setTimeout(r, 1000));
      }
      setCountdown(0);

      const blob = await captureFrame();
      if (!blob) {
        setError('Failed to capture frame. Please try again.');
        setStep('challenge');
        return;
      }
      capturedFrames.push(blob);
    }

    setFrames(capturedFrames);
    setStep('submitting');

    // Submit to backend
    try {
      const formData = new FormData();
      formData.append('challenge_id', challenge.challenge_id);
      formData.append('frame1', capturedFrames[0], 'frame1.jpg');
      formData.append('frame2', capturedFrames[1], 'frame2.jpg');
      formData.append('frame3', capturedFrames[2], 'frame3.jpg');

      const { data } = await api.post('/face/liveness-verify', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (data.liveness_confirmed) {
        setStep('success');
        // Refresh the auth context so face_enrolled=true is reflected.
        // We intentionally DO NOT mirror user data into localStorage — it
        // is XSS-readable; AuthContext / fresh /auth/me calls are the
        // single source of truth.
        try {
          await api.get('/auth/me');
        } catch {
          /* best effort */
        }

        setTimeout(() => navigate('/student/dashboard', { replace: true }), 2000);
      } else {
        setError(data.reason || 'Liveness verification failed. Please try again.');
        setStep('error');
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      setError(detail || 'Verification failed. Please try again.');
      setStep('error');
    }
  }, [challenge, captureFrame, navigate]);

  // ── Skip enrollment (dev mode) ────────────────────────────────────
  const skipEnrollment = useCallback(() => {
    navigate('/student/dashboard', { replace: true });
  }, [navigate]);

  // ── Retry after error ─────────────────────────────────────────────
  const retry = useCallback(() => {
    setError('');
    setFrames([]);
    setCapturePhase(0);
    if (streamRef.current) {
      setStep('camera');
    } else {
      setStep('intro');
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1a237e] to-[#283593] p-6 text-white text-center">
          <div className="text-4xl mb-2">🔐</div>
          <h1 className="text-xl font-bold">Face Enrollment Required</h1>
          <p className="text-blue-200 text-sm mt-1">One-time setup to secure your attendance</p>
        </div>

        <div className="p-6">
          {/* ── INTRO STEP ── */}
          {step === 'intro' && (
            <div className="text-center space-y-4">
              <div className="bg-blue-50 rounded-xl p-4 text-left space-y-2">
                <h3 className="font-semibold text-slate-800">How it works:</h3>
                <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
                  <li>Allow camera access</li>
                  <li>You'll receive a liveness challenge (e.g. "Smile" or "Blink")</li>
                  <li>Three photos are captured: before, during, and after</li>
                  <li>AI verifies it's really you — done!</li>
                </ol>
              </div>
              <button
                onClick={startCamera}
                className="w-full py-3 px-4 bg-[#1a237e] hover:bg-[#283593] text-white
                           font-semibold rounded-xl transition-colors"
              >
                Start Face Enrollment
              </button>
              <button
                onClick={skipEnrollment}
                className="text-sm text-slate-400 hover:text-slate-600 underline"
              >
                Skip for now (limited access)
              </button>
            </div>
          )}

          {/* ── CAMERA READY STEP ── */}
          {step === 'camera' && (
            <div className="space-y-4">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover mirror"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {/* Face guide overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-56 border-2 border-dashed border-white/50 rounded-[50%]" />
                </div>
              </div>
              <p className="text-center text-sm text-slate-500">
                Position your face inside the oval
              </p>
              <button
                onClick={requestChallenge}
                className="w-full py-3 px-4 bg-[#1a237e] hover:bg-[#283593] text-white
                           font-semibold rounded-xl transition-colors"
              >
                I'm Ready — Get Challenge
              </button>
            </div>
          )}

          {/* ── CHALLENGE STEP ── */}
          {step === 'challenge' && challenge && (
            <div className="space-y-4">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                <div className="text-3xl mb-1">
                  {CHALLENGE_LABELS[challenge.challenge]?.icon || '🎯'}
                </div>
                <p className="font-semibold text-amber-800">
                  Your challenge:{' '}
                  {CHALLENGE_LABELS[challenge.challenge]?.label || challenge.challenge}
                </p>
                <p className="text-sm text-amber-600 mt-1">
                  {CHALLENGE_LABELS[challenge.challenge]?.tip ||
                    'Follow the instruction when prompted'}
                </p>
              </div>
              <button
                onClick={startCapture}
                className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white
                           font-semibold rounded-xl transition-colors"
              >
                Start Capture (3 photos, auto-timed)
              </button>
            </div>
          )}

          {/* ── CAPTURING STEP ── */}
          {step === 'capturing' && (
            <div className="space-y-4">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {/* Countdown overlay */}
                {countdown > 0 && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <span className="text-6xl font-bold text-white animate-pulse">{countdown}</span>
                  </div>
                )}
                {countdown === 0 && <div className="absolute inset-0 bg-white/20 flash-overlay" />}
              </div>
              <div className="text-center">
                <p className="font-semibold text-slate-700">{phaseLabels[capturePhase]}</p>
                <div className="flex justify-center gap-2 mt-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full ${
                        i < capturePhase
                          ? 'bg-green-500'
                          : i === capturePhase
                            ? 'bg-blue-500 animate-pulse'
                            : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── SUBMITTING STEP ── */}
          {step === 'submitting' && (
            <div className="text-center py-8 space-y-4">
              <div
                className="w-12 h-12 border-4 border-slate-200 border-t-[#1a237e] rounded-full
                              animate-spin mx-auto"
              />
              <p className="font-semibold text-slate-700">Verifying your identity…</p>
              <p className="text-sm text-slate-400">This may take a few seconds</p>
            </div>
          )}

          {/* ── SUCCESS STEP ── */}
          {step === 'success' && (
            <div className="text-center py-8 space-y-4">
              <div className="text-5xl">✅</div>
              <h2 className="text-xl font-bold text-green-700">Face Enrolled Successfully!</h2>
              <p className="text-sm text-slate-500">Redirecting to your dashboard…</p>
            </div>
          )}

          {/* ── ERROR STEP ── */}
          {step === 'error' && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                <div className="text-3xl mb-2">⚠️</div>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={retry}
                  className="flex-1 py-3 px-4 bg-[#1a237e] hover:bg-[#283593] text-white
                             font-semibold rounded-xl transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={skipEnrollment}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700
                             font-semibold rounded-xl transition-colors"
                >
                  Skip for Now
                </button>
              </div>
            </div>
          )}

          {error && step !== 'error' && (
            <p className="mt-3 text-center text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Hidden canvas for frame capture */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
