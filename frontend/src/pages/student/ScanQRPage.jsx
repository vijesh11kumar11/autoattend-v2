/**
 * TRACELN v2.0 — Web Scan-QR Attendance (Student)
 *
 * Browser-based attendance marking — no mobile app required. Works on any
 * iPhone/Android phone browser over HTTPS.
 *
 * Flow (order is deliberate):
 *   1. GET  /api/attendance/active-session  → real session_id (needed for face)
 *   2. Front camera: capture 3 frames with a liveness prompt
 *        POST /api/face/liveness-verify      → proves a live person (anti-photo)
 *        POST /api/face/verify               → Azure face match (anti-proxy)
 *                                              → face_token (valid 60s)
 *   3. Rear camera: scan the teacher's rotating QR with jsQR → qr_data
 *   4. navigator.geolocation → student lat/lon
 *   5. POST /api/attendance/mark            → marks PRESENT
 *
 * The QR is scanned LAST (it rotates every 5s) so it is always fresh when we
 * mark. The face_token is minted just before the scan, well inside its 60s TTL.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import api, { getDeviceId } from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

// Liveness prompts — all only require slight, natural movement (smooth & reliable).
const CHALLENGE_LABELS = {
  blink: { icon: '👁️', label: 'Blink your eyes', tip: 'Blink naturally 2–3 times' },
  smile: { icon: '😊', label: 'Smile', tip: 'Give a natural smile' },
  turn_left: { icon: '👈', label: 'Turn your head left', tip: 'Slowly turn left, then back' },
  turn_right: { icon: '👉', label: 'Turn your head right', tip: 'Slowly turn right, then back' },
  open_mouth: { icon: '😮', label: 'Open your mouth', tip: 'Open wide, then close' },
};

const STEPS = {
  IDLE: 'idle',
  LOADING: 'loading',
  NO_SESSION: 'no_session',
  FACE: 'face', // liveness + face match (front camera)
  QR: 'qr', // scan teacher QR (rear camera)
  MARKING: 'marking',
  SUCCESS: 'success',
  FAILED: 'failed',
};

export default function ScanQRPage() {
  const { user } = useAuth();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const scanningRef = useRef(false);
  const faceTokenTimeRef = useRef(0); // when the 60s face_token was minted
  const lastTriedQrRef = useRef(''); // last QR string sent to /mark (avoid re-trying the same expired token)

  const [step, setStep] = useState(STEPS.IDLE);
  const [session, setSession] = useState(null); // { session_id, subject_name, ... }
  const [challenge, setChallenge] = useState(null); // { challenge_id, challenge }
  const [faceToken, setFaceToken] = useState(null);
  const [phaseText, setPhaseText] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { status, message, subject_name }

  // Attach the active stream to the <video> element whenever it (re)mounts.
  const setVideoRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) node.srcObject = streamRef.current;
  }, []);

  // ── Cleanup camera on unmount ──────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Camera helpers ─────────────────────────────────────────────────
  const openCamera = useCallback(async (facing) => {
    // Stop any previous stream before switching cameras.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      try {
        await videoRef.current.play();
      } catch {
        /* autoplay may require the element to mount first */
      }
    }
    return stream;
  }, []);

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    // Wait until the stream is actually producing frames (mobile can lag).
    if (video.readyState < 2) {
      await new Promise((resolve) => {
        const onCanPlay = () => {
          video.removeEventListener('canplay', onCanPlay);
          resolve();
        };
        video.addEventListener('canplay', onCanPlay);
        setTimeout(resolve, 3000);
      });
    }
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
  }, []);

  // ── Step 1: load active session ────────────────────────────────────
  const startAttendance = useCallback(async () => {
    setError('');
    setStep(STEPS.LOADING);
    try {
      const { data } = await api.get('/attendance/active-session');
      const sessions = data.active_sessions || [];
      const open = sessions.find((s) => !s.already_marked) || sessions[0];
      if (!open) {
        setStep(STEPS.NO_SESSION);
        return;
      }
      if (open.already_marked) {
        setResult({
          status: 'failed',
          message: `Attendance already marked for ${open.subject_name}.`,
        });
        setStep(STEPS.FAILED);
        return;
      }
      setSession(open);
      // Open the front camera and request a liveness challenge.
      await openCamera('user');
      const { data: ch } = await api.post('/face/liveness-session');
      setChallenge(ch);
      setStep(STEPS.FACE);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      setError(detail || 'Could not start attendance. Please try again.');
      setStep(STEPS.FAILED);
    }
  }, [openCamera]);

  // ── Step 2: capture liveness frames → liveness-verify → face/verify ─
  const runFaceCheck = useCallback(async () => {
    if (!session || !challenge) return;
    const frames = [];
    const phases = [
      'Hold still — capturing…',
      CHALLENGE_LABELS[challenge.challenge]?.label || 'Perform the action',
      'Return to neutral — almost done…',
    ];
    try {
      for (let p = 0; p < 3; p++) {
        setPhaseText(phases[p]);
        for (let t = 3; t > 0; t--) {
          setCountdown(t);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 1000));
        }
        setCountdown(0);
        // eslint-disable-next-line no-await-in-loop
        const blob = await captureFrame();
        if (!blob) throw new Error('Could not capture from the camera. Check lighting and retry.');
        frames.push(blob);
      }

      // 2a. Liveness (anti-photo) — proves a live person is present.
      setPhaseText('Verifying you are live…');
      const lf = new FormData();
      lf.append('challenge_id', challenge.challenge_id);
      lf.append('frame1', frames[0], 'f1.jpg');
      lf.append('frame2', frames[1], 'f2.jpg');
      lf.append('frame3', frames[2], 'f3.jpg');
      const { data: live } = await api.post('/face/liveness-verify', lf, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!live.liveness_confirmed) {
        setError(live.reason || 'Liveness check failed. Please try again.');
        setStep(STEPS.FAILED);
        return;
      }

      // 2b. Face match (anti-proxy) — must match THIS student's enrolled face.
      setPhaseText('Matching your face…');
      const ff = new FormData();
      ff.append('session_id', String(session.session_id));
      ff.append('image', frames[0], 'face.jpg');
      const { data: fv } = await api.post('/face/verify', ff, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!fv.face_token) {
        setError('Face did not match your enrolled record. Please try again.');
        setStep(STEPS.FAILED);
        return;
      }
      setFaceToken(fv.face_token);
      faceTokenTimeRef.current = Date.now();
      lastTriedQrRef.current = '';

      // Switch to the rear camera for QR scanning.
      await openCamera('environment');
      setStep(STEPS.QR);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || '';
      const d = detail.toLowerCase();
      if (d.includes('not match') || err.response?.status === 422) {
        setError('Face did not match your enrolled record. Make sure it is really you.');
      } else if (d.includes('not enrolled')) {
        setError('Your face is not enrolled yet. Please complete face enrollment first.');
      } else {
        setError(detail || 'Face verification failed. Please try again in good lighting.');
      }
      setStep(STEPS.FAILED);
    }
  }, [session, challenge, captureFrame, openCamera]);

  // Kick off the capture sequence once the FACE step + camera are ready.
  useEffect(() => {
    if (step === STEPS.FACE && challenge) {
      const id = setTimeout(() => runFaceCheck(), 600);
      return () => clearTimeout(id);
    }
  }, [step, challenge, runFaceCheck]);

  // ── Step 3: scan the rotating QR (rear camera) ─────────────────────
  const getPosition = useCallback(
    () =>
      new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Location is not available on this device.'));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }),
    []
  );

  const markAttendance = useCallback(
    async (qrData) => {
      lastTriedQrRef.current = qrData; // remember so we don't re-submit the same (possibly expired) token
      setStep(STEPS.MARKING);
      setPhaseText('Confirming your location…');
      try {
        let lat = 0;
        let lon = 0;
        let acc = 0;
        try {
          const pos = await getPosition();
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          acc = pos.coords.accuracy || 0;
        } catch {
          // GPS denied/unavailable — send zeros; backend decides (test rolls
          // bypass GPS; real students require it and will get a clear message).
          lat = 0;
          lon = 0;
          acc = 9999;
        }

        setPhaseText('Marking attendance…');
        const { data } = await api.post('/attendance/mark', {
          session_id: session.session_id,
          face_token: faceToken,
          qr_data: qrData,
          student_latitude: lat,
          student_longitude: lon,
          student_gps_accuracy: acc,
          device_id: getDeviceId(),
        });
        if (data.success) {
          setResult({
            status: data.status,
            message: data.message,
            subject_name: data.subject_name,
          });
          stopCamera();
          setStep(STEPS.SUCCESS);
          return;
        }
        // 200 + success:false. A stale/invalid QR is retryable while the
        // face_token is still fresh — resume scanning for the next rotation
        // instead of forcing the student to redo the whole face check.
        const msg = (data.message || '').toLowerCase();
        const qrRetryable = /qr|expired|invalid/.test(msg) && !msg.includes('already');
        const tokenFresh = Date.now() - faceTokenTimeRef.current < 50000;
        if (qrRetryable && tokenFresh) {
          setPhaseText('');
          setStep(STEPS.QR); // camera stays open; scan loop restarts
          return;
        }
        setResult({
          status: data.status,
          message: data.message,
          subject_name: data.subject_name,
        });
        stopCamera();
        setStep(STEPS.FAILED);
      } catch (err) {
        const detail = err.response?.data?.detail || err.response?.data?.message || err.message;
        stopCamera();
        setError(detail || 'Could not mark attendance. Please try again.');
        setStep(STEPS.FAILED);
      }
    },
    [session, faceToken, getPosition, stopCamera]
  );

  // QR scan loop — runs while on the QR step.
  useEffect(() => {
    if (step !== STEPS.QR) return undefined;
    scanningRef.current = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (!scanningRef.current) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (
          code &&
          code.data &&
          code.data.split(':').length === 3 &&
          code.data !== lastTriedQrRef.current
        ) {
          scanningRef.current = false;
          markAttendance(code.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      scanningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [step, markAttendance]);

  const reset = useCallback(() => {
    stopCamera();
    setSession(null);
    setChallenge(null);
    setFaceToken(null);
    setError('');
    setResult(null);
    setPhaseText('');
    setCountdown(0);
    setStep(STEPS.IDLE);
  }, [stopCamera]);

  // ── Render ─────────────────────────────────────────────────────────
  const showVideo = step === STEPS.FACE || step === STEPS.QR;
  const challengeMeta = challenge ? CHALLENGE_LABELS[challenge.challenge] : null;

  return (
    <div className="max-w-md mx-auto space-y-4">
      <canvas ref={canvasRef} className="hidden" />

      {/* Live camera preview */}
      {showVideo && (
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-[3/4] shadow-lg">
          <video
            ref={setVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ transform: step === STEPS.FACE ? 'scaleX(-1)' : 'none' }}
          />
          {step === STEPS.FACE && (
            <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/70 to-transparent text-white text-center">
              {challengeMeta && (
                <p className="text-lg font-semibold">
                  {challengeMeta.icon} {phaseText || challengeMeta.label}
                </p>
              )}
              {countdown > 0 && <p className="text-4xl font-bold mt-1">{countdown}</p>}
            </div>
          )}
          {step === STEPS.QR && (
            <>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2/3 aspect-square border-4 border-white/80 rounded-2xl" />
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/70 to-transparent text-white text-center">
                <p className="font-semibold">Point at the teacher's QR code</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Idle */}
      {step === STEPS.IDLE && (
        <div className="card p-8 text-center space-y-4">
          <span className="text-5xl block">📷</span>
          <h2 className="text-lg font-bold text-slate-800">Mark Attendance</h2>
          <p className="text-sm text-slate-500">
            Verify your face, then scan the QR code your teacher is displaying.
          </p>
          <button
            onClick={startAttendance}
            className="w-full bg-[#1a237e] text-white font-semibold py-3 rounded-xl hover:bg-[#283593] transition-colors"
          >
            Start Attendance
          </button>
        </div>
      )}

      {/* Loading */}
      {step === STEPS.LOADING && (
        <div className="card p-10 text-center">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-sm mt-3">Finding your active class…</p>
        </div>
      )}

      {/* No active session */}
      {step === STEPS.NO_SESSION && (
        <div className="card p-8 text-center space-y-3">
          <span className="text-4xl block">⏳</span>
          <p className="font-semibold text-slate-700">No active session</p>
          <p className="text-sm text-slate-500">
            Your teacher hasn't started an attendance session yet. Try again once the QR code is on
            screen.
          </p>
          <button
            onClick={startAttendance}
            className="w-full bg-slate-100 text-slate-700 font-semibold py-2.5 rounded-xl hover:bg-slate-200"
          >
            Refresh
          </button>
        </div>
      )}

      {/* Marking */}
      {step === STEPS.MARKING && (
        <div className="card p-10 text-center">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
          <p className="text-slate-500 text-sm mt-3">{phaseText || 'Marking attendance…'}</p>
        </div>
      )}

      {/* Success */}
      {step === STEPS.SUCCESS && (
        <div className="card p-8 text-center space-y-3">
          <span className="text-5xl block">✅</span>
          <h2 className="text-xl font-bold text-emerald-600">Attendance Marked!</h2>
          {result?.subject_name && (
            <p className="text-sm text-slate-600">{result.subject_name}</p>
          )}
          <p className="text-sm text-slate-500">{result?.message}</p>
          <button
            onClick={reset}
            className="w-full bg-slate-100 text-slate-700 font-semibold py-2.5 rounded-xl hover:bg-slate-200"
          >
            Done
          </button>
        </div>
      )}

      {/* Failed */}
      {step === STEPS.FAILED && (
        <div className="card p-8 text-center space-y-3">
          <span className="text-5xl block">❌</span>
          <h2 className="text-lg font-bold text-red-600">Could not mark attendance</h2>
          <p className="text-sm text-slate-600">{result?.message || error}</p>
          <button
            onClick={reset}
            className="w-full bg-[#1a237e] text-white font-semibold py-3 rounded-xl hover:bg-[#283593]"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
