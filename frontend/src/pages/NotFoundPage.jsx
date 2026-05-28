import { Link, useLocation } from 'react-router-dom';

export default function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-6 px-6">
      <div className="text-8xl font-black text-slate-200">404</div>
      <h1 className="text-2xl font-bold text-slate-700">Page Not Found</h1>
      <p className="text-slate-500 text-center max-w-md">
        The page <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{location.pathname}</code>{' '}
        does not exist. It may have been moved or deleted.
      </p>
      <div className="flex gap-3">
        <Link to="/" className="btn-primary">Back to Dashboard</Link>
        <button onClick={() => window.history.back()} className="btn-ghost">
          ← Go Back
        </button>
      </div>
    </div>
  );
}

