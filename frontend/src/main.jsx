import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';

// ─────────────────────────────────────────────────────────────────────
// Sentry — error + performance + session-replay tracking.
// Only initialises when VITE_SENTRY_DSN is set, so dev/CI builds without
// a DSN still start normally. Loaded lazily via dynamic import so a
// missing @sentry/react package never blocks the build.
// ─────────────────────────────────────────────────────────────────────
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.VITE_APP_ENV || 'production',
        tracesSampleRate: 1.0,
        replaysOnErrorSampleRate: 1.0,
        replaysSessionSampleRate: 0.0,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration(),
        ],
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[sentry] init skipped:', err?.message || err);
    });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

