/**
 * Student — Scan QR / Mark Attendance Page (Web)
 *
 * Three-step wizard:
 *   1. QR Scan  — BarcodeDetector API (Chrome/Edge) or manual text entry
 *   2. Face Verify — webcam selfie  → POST /api/face/verify → face_token
 *   3. Submit   — GPS + POST /api/attendance/mark → result
 *
 * Falls back to manual QR entry on browsers without BarcodeDetector support.
 * GPS location is requested when the user reaches the submit step.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

// ── constants ─────────────────────────────────────────────────────────
const SCAN_INTERVAL_MS   = 250;   // BarcodeDetector poll interval
const FACE_VIDEO_CONSTRAINTS = {
  width: 640, height: 480,
  facingMode: 'user',
};
const QR_VIDEO_CONSTRAINTS = {
  width: 640, height: 480,
  facingMode: { ideal: 'environment' },
};

// ── helpers ───────────────────────────────────────────────────────────
function dataURLtoBlob(dataURL) {
  const [header, data] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const buf   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function parseQRData(raw) {
  // Expected format: "session_id:time_slot:hmac_token"
  const parts = raw.trim().split(':');
  if (parts.length !== 3) return null;
  const sessionId = parseInt(parts[0], 10);
  if (isNaN(sessionId)) return null;
  return { sessionId, qrData: raw.trim() };
}

// ── Step indicator ────────────────────────────────────────────────────
function StepBar({ step }) {
  const steps = ['Scan QR', 'Verify Face', 'Submit'];
  return (
    <div className="flex items-center gap-2 mb-5">
      {steps.map((label, i) => {
        const n      = i + 1;
        const active = n === step;
        const done   = n < step;
        return (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors
              ${done   ? 'bg-emerald-500 text-white'
              : active ? 'bg-blue-600 text-white'
              :          'bg-slate-200 text-slate-500'}`}>
              {done ? '✓' : n}
            </div>
            <span className={`text-xs font-medium hidden sm:inline
              ${active ? 'text-slate-800' : 'text-slate-400'}`}>
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 rounded ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Step 1 — QR Scan
// ═══════════════════════════════════════════════════════════════════════
function QRScanStep({ onScanned }) {
  const webcamRef   = useRef(null);
  const scanRef     = useRef(null);
  const [manual,    setManual]    = useState('');
  const [error,     setError]     = useState('');
  const [scanning,  setScanning]  = useState(false);
  const [hasCam,    setHasCam]    = useState(false);
  const [hasDetect, setHasDetect] = useState(false);

  useEffect(() => {
    setHasCam('mediaDevices' in navigator && !!navigator.mediaDevices.getUserMedia);
    setHasDetect(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  }, []);

  // ── BarcodeDetector live scan ────────────────────────────────────────
  const detectorRef = useRef(null);

  const startScan = useCallback(async () => {
    if (!hasDetect || !webcamRef.current) return;
    setScanning(true);
    setError('');

    // Reuse the detector instance across scans; create it once
    if (!detectorRef.current) {
      // eslint-disable-next-line no-undef
      detectorRef.current = new BarcodeDetector({ formats: ['qr_code'] });
    }

    scanRef.current = setInterval(async () => {
      const screenshot = webcamRef.current?.getScreenshot();
      if (!screenshot) return;
      try {
        const img      = new Image();
        img.src        = screenshot;
        await new Promise((res) => { img.onload = res; });
        const barcodes = await detectorRef.current.detect(img);
        if (barcodes.length > 0) {
          clearInterval(scanRef.current);
          setScanning(false);
          handleRaw(barcodes[0].rawValue);
        }
      } catch { /* ignore decode errors */ }
    }, SCAN_INTERVAL_MS);
  }, [hasDetect]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { if (scanRef.current) clearInterval(scanRef.current); };
  }, []);

  function handleRaw(raw) {
    setError('');
    const parsed = parseQRData(raw);
    if (!parsed) {
      setError('Invalid QR code format. Expected "session_id:time_slot:token".');
      return;
    }
    onScanned(parsed);
  }

  function handleManualSubmit(e) {
    e.preventDefault();
    handleRaw(manual);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-700">Step 1: Scan Attendance QR Code</h3>
        <p className="text-sm text-slate-400 mt-0.5">
          Point your camera at the QR displayed by your teacher, or paste the code manually.
        </p>
      </div>

      {hasCam && hasDetect && (
        <div className="space-y-2">
          <div className="rounded-xl overflow-hidden border border-slate-200 bg-black aspect-video max-h-56 mx-auto">
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/jpeg"
              videoConstraints={QR_VIDEO_CONSTRAINTS}
              className="w-full h-full object-cover"
            />
          </div>
          {!scanning ? (
            <button onClick={startScan} className="btn-primary w-full flex items-center justify-center gap-2">
              <span>📷</span> Start Camera Scan
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 py-2">
              <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-500">Scanning for QR code…</span>
              <button onClick={() => { clearInterval(scanRef.current); setScanning(false); }}
                      className="text-xs text-red-500 underline ml-2">Stop</button>
            </div>
          )}
        </div>
      )}

      {hasCam && !hasDetect && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
          ⚠️ Your browser does not support automatic QR scanning. Please enter the code manually below,
          or use <strong>Chrome / Edge</strong> for camera scanning.
        </div>
      )}

      {!hasCam && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-500">
          📷 No camera detected. Please enter the QR code string manually.
        </div>
      )}

      {/* Manual entry */}
      <form onSubmit={handleManualSubmit} className="space-y-2">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Manual entry (paste QR string)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={manual}
            onChange={e => setManual(e.target.value)}
            placeholder="e.g.  42:12345:a3f7…"
            className="input flex-1 font-mono text-sm"
          />
          <button type="submit" className="btn-primary px-4">Go</button>
        </div>
        <p className="text-xs text-slate-400">
          Format: <code className="font-mono">session_id:time_slot:token</code>
        </p>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Step 2 — Face Verification
// ═══════════════════════════════════════════════════════════════════════
function FaceVerifyStep({ sessionId, onVerified }) {
  const webcamRef     = useRef(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [captured,    setCaptured]    = useState(null); // data URL preview

  async function handleCapture() {
    const screenshot = webcamRef.current?.getScreenshot();
    if (!screenshot) { setError('Could not capture image. Please allow camera access.'); return; }
    setCaptured(screenshot);
    setError('');
    setLoading(true);

    try {
      const blob = dataURLtoBlob(screenshot);
      const form = new FormData();
      form.append('session_id', String(sessionId));
      form.append('image', blob, 'selfie.jpg');

      const { data } = await api.post('/face/verify', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onVerified(data.face_token);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Face verification failed. Please try again.';
      setError(msg);
      setCaptured(null);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-700">Step 2: Face Verification</h3>
        <p className="text-sm text-slate-400 mt-0.5">
          Look directly at the camera and click <strong>Verify Face</strong>.
        </p>
      </div>

      {captured ? (
        <div className="rounded-xl overflow-hidden border border-slate-200 aspect-video max-h-56 mx-auto bg-black">
          <img src={captured} alt="Captured selfie" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-slate-200 aspect-video max-h-56 mx-auto bg-black">
          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            videoConstraints={FACE_VIDEO_CONSTRAINTS}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
          <button onClick={() => setCaptured(null)} className="ml-3 underline">Try again</button>
        </div>
      )}

      <button
        onClick={handleCapture}
        disabled={loading}
        className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading
          ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Verifying…</>
          : '🔒 Verify Face'}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Step 3 — Submit Attendance
// ═══════════════════════════════════════════════════════════════════════
function SubmitStep({ sessionId, qrData, faceToken }) {
  const { user }    = useAuth();
  const [status,    setStatus]    = useState('idle'); // idle|locating|submitting|done|error
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState('');

  const submit = useCallback(async (lat, lon, acc) => {
    setStatus('submitting');
    try {
      const deviceId = localStorage.getItem('aa_device_id') || 'web-' + (user?.id ?? 'unknown');
      const { data } = await api.post('/attendance/mark', {
        session_id:              sessionId,
        face_token:              faceToken,
        qr_data:                 qrData,
        student_latitude:        lat,
        student_longitude:       lon,
        student_gps_accuracy:    acc,
        device_id:               deviceId,
      });
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to mark attendance.');
      setStatus('error');
    }
  }, [sessionId, faceToken, qrData, user]);

  useEffect(() => {
    setStatus('locating');
    if (!navigator.geolocation) {
      setError(
        'Location access is not supported by your browser. ' +
        'Please use the AutoAttend mobile app or a modern browser to mark attendance.'
      );
      setStatus('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => submit(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      (err) => {
        const msg = err.code === err.PERMISSION_DENIED
          ? 'Location permission denied. Please allow location access and try again.'
          : 'Could not get your location. Please ensure GPS is enabled and try again.';
        setError(msg);
        setStatus('error');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [submit]);

  if (status === 'locating') {
    return (
      <div className="text-center py-8 space-y-2">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-400">Getting your location…</p>
        <p className="text-xs text-slate-300">Please allow location access when prompted.</p>
      </div>
    );
  }

  if (status === 'submitting') {
    return (
      <div className="text-center py-8 space-y-2">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-400">Marking attendance…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="card p-6 text-center space-y-3">
        <span className="text-4xl">❌</span>
        <p className="font-semibold text-red-600">Attendance Not Marked</p>
        <p className="text-sm text-slate-500">{error}</p>
        <a href="/student/scan-qr" className="btn-primary inline-block">Try Again</a>
      </div>
    );
  }

  if (status === 'done' && result) {
    const success = result.success;
    return (
      <div className={`card p-6 text-center space-y-3
        ${success ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <span className="text-4xl">{success ? '✅' : '⚠️'}</span>
        <p className={`font-bold text-lg ${success ? 'text-emerald-700' : 'text-amber-700'}`}>
          {success ? 'Attendance Marked!' : 'Not Marked'}
        </p>
        <p className="text-sm text-slate-600">{result.message}</p>
        {result.subject_name && (
          <p className="text-sm font-medium text-slate-700">Subject: {result.subject_name}</p>
        )}
        {result.checks && (
          <div className="grid grid-cols-2 gap-2 text-xs text-left mt-2">
            {[
              ['Face',      result.checks.face_verified],
              ['QR',        result.checks.qr_valid],
              ['GPS',       result.checks.gps_verified],
              ['Bluetooth', result.checks.bluetooth_verified],
            ].map(([label, ok]) => (
              <div key={label} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg
                ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                <span>{ok ? '✓' : '○'}</span> {label}
              </div>
            ))}
          </div>
        )}
        <a href="/student/dashboard" className="btn-primary inline-block mt-2">Back to Dashboard</a>
      </div>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// ScanQRPage — root export
// ═══════════════════════════════════════════════════════════════════════
export default function ScanQRPage() {
  const [step,      setStep]      = useState(1);
  const [sessionId, setSessionId] = useState(null);
  const [qrData,    setQRData]    = useState(null);
  const [faceToken, setFaceToken] = useState(null);

  function handleScanned({ sessionId: sid, qrData: qd }) {
    setSessionId(sid);
    setQRData(qd);
    setStep(2);
  }

  function handleVerified(token) {
    setFaceToken(token);
    setStep(3);
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-700">📷 Scan QR & Mark Attendance</h2>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">Web</span>
      </div>

      <div className="card p-5">
        <StepBar step={step} />
        {step === 1 && <QRScanStep onScanned={handleScanned} />}
        {step === 2 && <FaceVerifyStep sessionId={sessionId} onVerified={handleVerified} />}
        {step === 3 && <SubmitStep sessionId={sessionId} qrData={qrData} faceToken={faceToken} />}
      </div>

      <div className="card p-4 bg-blue-50 border-blue-200 text-sm text-blue-700">
        📱 <strong>Tip:</strong> For the best experience, use the <strong>AutoAttend mobile app</strong>
        which supports automatic QR scanning, face ID, and Bluetooth verification.
      </div>
    </div>
  );
}
