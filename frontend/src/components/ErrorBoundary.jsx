/**
 * ErrorBoundary — top-level React error boundary for AutoAttend web.
 *
 * Catches any uncaught render-time error in the tree and shows a friendly
 * fallback instead of the dreaded blank white screen. Provides a "Reload"
 * button and (in dev) a collapsible stack trace.
 *
 * NOTE: This is a class component because React requires class components
 * for componentDidCatch / getDerivedStateFromError.
 */

import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info);
    this.setState({ info });
    // Hook for external reporters (Sentry/etc) — only fires if window.__report
    // is wired up. No-op by default so we never crash the boundary itself.
    try {
      if (typeof window !== 'undefined' && typeof window.__reportError === 'function') {
        window.__reportError(error, info);
      }
    } catch (_) { /* never let reporter throw */ }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, info: null });
    // Hard reload to recover from a corrupt SPA state.
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
    const message = this.state.error?.message || 'Unexpected error.';

    return (
      <div role="alert" aria-live="assertive" className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-5">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-xl font-bold text-slate-800">Something went wrong</h1>
          <p className="text-sm text-slate-500">
            The page hit an unexpected error. You can try reloading.
            If the problem persists, contact your administrator.
          </p>
          <div className="flex gap-3 justify-center pt-2">
            <button onClick={this.handleReload}
                    className="px-5 py-2 bg-[#1a237e] hover:bg-[#0d174f] text-white rounded-xl text-sm font-semibold">
              Reload
            </button>
            <a href="/"
               className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold">
              Home
            </a>
          </div>

          {isDev && (
            <details className="text-left text-xs text-slate-500 bg-slate-50 rounded-lg p-3 mt-3">
              <summary className="cursor-pointer font-mono text-red-600">
                {message}
              </summary>
              <pre className="overflow-auto whitespace-pre-wrap mt-2">
                {this.state.info?.componentStack || this.state.error?.stack || ''}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
