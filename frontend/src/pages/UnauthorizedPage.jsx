import { Link } from 'react-router-dom';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-6 fade-in">
      <div className="text-9xl font-black text-slate-200 select-none">403</div>
      <h1 className="text-2xl font-bold text-slate-700">Access Denied</h1>
      <p className="text-slate-500 text-center max-w-sm">
        You don't have permission to view this page. Contact your administrator if you think this is
        a mistake.
      </p>
      <Link to="/" className="btn-primary">
        Go to Dashboard
      </Link>
    </div>
  );
}
