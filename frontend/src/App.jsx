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

// ── Eager imports (always needed) ─────────────────────────────────────
import LoginPage      from './pages/LoginPage';
import UnauthorizedPage from './pages/UnauthorizedPage';

// ── Lazy dashboard imports ────────────────────────────────────────────
const PrincipalDashboard = lazy(() => import('./pages/principal/PrincipalDashboard'));
const HODDashboard       = lazy(() => import('./pages/hod/HODDashboard'));
const TeacherDashboard   = lazy(() => import('./pages/teacher/TeacherDashboard'));
const StudentDashboard   = lazy(() => import('./pages/student/StudentDashboard'));
const FaceEnrollmentPage = lazy(() => import('./pages/student/FaceEnrollmentPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const TOTPSetupPage      = lazy(() => import('./pages/TOTPSetupPage'));

// ── Loading fallback ──────────────────────────────────────────────────
function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-surface">
      <div className="flex flex-col items-center gap-4">
        <div className="spinner !border-secondary !border-t-transparent w-10 h-10
                        !border-4 !w-10 !h-10"
             style={{ borderColor: '#e2e8f0', borderTopColor: '#3b82f6',
                      width: 40, height: 40, borderWidth: 4 }} />
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
    hod:       '/hod/dashboard',
    teacher:   '/teacher/dashboard',
    student:   '/student/dashboard',
  };
  return <Navigate to={destinations[user?.role] ?? '/login'} replace />;
}

// ── Route tree ────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* Public */}
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/unauthorized"    element={<UnauthorizedPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Root — dispatch by role */}
        <Route path="/" element={<RoleRedirect />} />

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

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

// ── Root export ───────────────────────────────────────────────────────
export default function App() {
  return (
    // AuthProvider needs to be inside BrowserRouter (provided in index.js)
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

