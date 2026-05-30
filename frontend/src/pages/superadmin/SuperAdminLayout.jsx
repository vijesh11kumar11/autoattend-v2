/**
 * SuperAdminLayout — fixed sidebar shell for /admin/*.
 *
 * Does NOT reuse the existing role DashboardLayout — by design the
 * super-admin console is a fully separate surface (Issue #108).
 *
 * Guards: redirects to /admin/login if the user is not super_admin.
 */

import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block px-4 py-2 rounded text-sm font-medium transition ${
          isActive
            ? 'bg-amber-500 text-slate-900'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export default function SuperAdminLayout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-300">
        Loading…
      </div>
    );
  }
  if (!user || user.role !== 'super_admin') {
    return <Navigate to="/admin/login" replace />;
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      /* ignore */
    }
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex bg-slate-100">
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <p className="text-xs font-semibold text-amber-400 tracking-widest uppercase">Traceln</p>
          <p className="mt-1 font-bold">Admin Console</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem to="/admin/colleges">Colleges</NavItem>
          <NavItem to="/admin/stats">Stats</NavItem>
        </nav>

        <div className="px-3 py-4 border-t border-slate-800 space-y-2">
          <div className="px-2 text-xs text-slate-500 truncate" title={user.email}>
            {user.email}
          </div>
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2 rounded text-sm font-medium bg-slate-800
                       hover:bg-red-600 hover:text-white text-slate-300 transition"
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
