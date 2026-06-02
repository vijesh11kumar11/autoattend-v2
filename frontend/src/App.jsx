/**
 * AutoAttend AI v2.0 — App Router
 *
 * Public routes:   /login, /unauthorized
 * Protected routes use <PrivateRoute minRole="..."> wrapper.
 * <RoleRedirect /> dispatches authenticated users to their dashboard.
 *
 * Dashboard page stubs are created here as lazy imports so that
 * each role's bundle only loads when needed.
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OfflineQueueProvider } from './context/OfflineQueueContext';

// ── Eager imports (always needed) ─────────────────────────────────────
import LoginPage from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import NotFoundPage from './pages/NotFoundPage';
import ErrorBoundary from './components/ErrorBoundary';
// ── Lazy dashboard imports ────────────────────────────────────────────
const PrincipalDashboard = lazy(() => import('./pages/principal/PrincipalDashboard'));
const HODDashboard = lazy(() => import('./pages/hod/HODDashboard'));
const TeacherDashboard = lazy(() => import('./pages/teacher/TeacherDashboard'));
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const FaceEnrollmentPage = lazy(() => import('./pages/student/FaceEnrollmentPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const TOTPSetupPage = lazy(() => import('./pages/TOTPSetupPage'));

// Live session pages (Prompts 4 + 5)
const JoinSessionPage = lazy(() => import('./pages/live/JoinSessionPage'));
const StudentLiveSession = lazy(() => import('./pages/live/StudentLiveSession'));

// Super-admin console (Issue #108) — fully isolated from role dashboards.
const SuperAdminLoginPage = lazy(() => import('./pages/superadmin/SuperAdminLoginPage'));
const SuperAdminLayout = lazy(() => import('./pages/superadmin/SuperAdminLayout'));
const SuperAdminColleges = lazy(() => import('./pages/superadmin/CollegesPage'));
const SuperAdminCollegeDetail = lazy(() => import('./pages/superadmin/CollegeDetailPage'));
const SuperAdminStats = lazy(() => import('./pages/superadmin/StatsPage'));

// ── Loading fallback ──────────────────────────────────────────────────
function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-surface">
      <div className="flex flex-col items-center gap-4">
        <div
          className="spinner !border-secondary !border-t-transparent w-10 h-10
                        !border-4 !w-10 !h-10"
          style={{
            borderColor: '#e2e8f0',
            borderTopColor: 'var(--color-secondary)',
            width: 40,
            height: 40,
            borderWidth: 4,
          }}
        />
        <p className="text-slate-500 text-sm font-medium">Loading…</p>
      </div>
    </div>
  );
}

// ── PrivateRoute ──────────────────────────────────────────────────────
/**
 * Wraps a protected route.
 * @param {string} minRole  – minimum role required (student|teacher|hod|principal)
 */
function PrivateRoute({ children, minRole = 'student', skipFaceCheck = false }) {
  const { isAuthenticated, loading, hasRole, user } = useAuth();

  if (loading) return <PageLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasRole(minRole)) return <Navigate to="/unauthorized" replace />;

  // Students must complete face enrollment before accessing dashboard
  if (!skipFaceCheck && user?.role === 'student' && !user?.face_enrolled) {
    return <Navigate to="/student/face-enrollment" replace />;
  }

  return children;
}

// ── RoleRedirect ──────────────────────────────────────────────────────
function RoleRedirect() {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) return <PageLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Students without face enrollment go to enrollment first
  if (user?.role === 'student' && !user?.face_enrolled) {
    return <Navigate to="/student/face-enrollment" replace />;
  }

  const destinations = {
    principal: '/principal/dashboard',
    hod: '/hod/dashboard',
    teacher: '/teacher/dashboard',
    student: '/student/dashboard',
  };
  return <Navigate to={destinations[user?.role] ?? '/login'} replace />;
}

// ── Route tree ────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Public live-session join (no auth required) */}
        <Route path="/live/:joinCode" element={<JoinSessionPage />} />

        {/* Full-screen live session — public to support guest join */}
        <Route path="/student/live/:sessionId" element={<StudentLiveSession />} />
        <Route
          path="/session-ended"
          element={
            <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
              <div className="text-center space-y-4">
                <p className="text-6xl">✅</p>
                <h1 className="text-3xl font-bold">Session Ended</h1>
                <p className="text-slate-400">Thank you for attending. You may close this tab.</p>
              </div>
            </div>
          }
        />

        {/* Root — dispatch by role */}
        <Route path="/" element={<RoleRedirect />} />

        {/* ── Super-admin console (Traceln internal — Issue #108) ──
            Fully isolated: own login page + own layout guard. Not
            wrapped in PrivateRoute and unaffected by RoleRedirect. */}
        <Route path="/admin/login" element={<SuperAdminLoginPage />} />
        <Route path="/admin" element={<SuperAdminLayout />}>
          <Route index element={<Navigate to="colleges" replace />} />
          <Route path="colleges" element={<SuperAdminColleges />} />
          <Route path="colleges/:collegeId" element={<SuperAdminCollegeDetail />} />
          <Route path="stats" element={<SuperAdminStats />} />
        </Route>

        {/* Principal */}
        <Route
          path="/principal/*"
          element={
            <PrivateRoute minRole="principal">
              <PrincipalDashboard />
            </PrivateRoute>
          }
        />

        {/* HOD */}
        <Route
          path="/hod/*"
          element={
            <PrivateRoute minRole="hod">
              <HODDashboard />
            </PrivateRoute>
          }
        />

        {/* Teacher */}
        <Route
          path="/teacher/*"
          element={
            <PrivateRoute minRole="teacher">
              <TeacherDashboard />
            </PrivateRoute>
          }
        />

        {/* Student */}
        <Route
          path="/student/face-enrollment"
          element={
            <PrivateRoute minRole="student" skipFaceCheck>
              <FaceEnrollmentPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/student/*"
          element={
            <PrivateRoute minRole="student">
              <StudentDashboard />
            </PrivateRoute>
          }
        />

        {/* TOTP first-time setup (any authenticated user, any role) */}
        <Route
          path="/totp-setup"
          element={
            <PrivateRoute minRole="student">
              <TOTPSetupPage />
            </PrivateRoute>
          }
        />

        {/* Catch-all — show a real 404 page, not a silent redirect */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

// ── Root export ───────────────────────────────────────────────────────
export default function App() {
  return (
    // ErrorBoundary catches any uncaught render error and replaces the blank
    // white screen with a friendly recovery page. AuthProvider must remain
    // inside BrowserRouter (provided in index.js).
    <ErrorBoundary>
      <AuthProvider>
        <OfflineQueueProvider>
          <AppRoutes />
        </OfflineQueueProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
