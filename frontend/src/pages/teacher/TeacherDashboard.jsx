import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from '../../components/DashboardLayout';

// TeacherHome stays eager — it is the default landing route and avoids
// a flash of fallback on every login. Everything else is lazy so each
// sub-route fetches its own chunk on first visit (#97 code-splitting).
import TeacherHome from './TeacherHomePage';

const GenerateQRPage           = lazy(() => import('./GenerateQRPage'));
const AttendancePage           = lazy(() => import('./AttendancePage'));
const MyClassesPage            = lazy(() => import('./MyClassesPage'));
const TeacherReportsPage       = lazy(() => import('./TeacherReportsPage'));
const TutorDashboardPage       = lazy(() => import('./TutorDashboardPage'));
const TWMPage                  = lazy(() => import('./TWMPage'));
const LeaveRequestsPage        = lazy(() => import('./LeaveRequestsPage'));
const SubjectAnalyticsPage     = lazy(() => import('./SubjectAnalyticsPage'));
const TeacherDisputesPage      = lazy(() => import('./TeacherDisputesPage'));
const FeedPage                 = lazy(() => import('../shared/FeedPage'));
const ArticleDetailPage        = lazy(() => import('../shared/ArticleDetailPage'));
const CareerRoadmapPage        = lazy(() => import('../shared/CareerRoadmapPage'));
const SuggestionBoxPage        = lazy(() => import('../shared/SuggestionBoxPage'));
const ProfilePage              = lazy(() => import('../shared/ProfilePage'));
const NotificationsInboxPage   = lazy(() => import('../shared/NotificationsInboxPage'));
const ClassPulsePage           = lazy(() => import('./ClassPulsePage'));
const TeacherLiveDashboard     = lazy(() => import('../live/TeacherLiveDashboard'));
const TeacherPreClassBrief     = lazy(() => import('../live/TeacherPreClassBrief'));
const SessionHealthReport      = lazy(() => import('../live/SessionHealthReport'));
const SmartReplayPage          = lazy(() => import('../live/SmartReplayPage'));
const StudentKnowledgeGraphPage = lazy(() => import('../live/StudentKnowledgeGraphPage'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="spinner !w-8 !h-8 !border-4"
           style={{ borderColor: '#e2e8f0', borderTopColor: 'var(--color-secondary)',
                    width: 32, height: 32, borderWidth: 4,
                    borderRadius: '9999px', borderStyle: 'solid' }} />
    </div>
  );
}

export default function TeacherDashboard() {
  return (
    <DashboardLayout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="dashboard" element={<TeacherHome />} />
          <Route path="qr"        element={<GenerateQRPage />} />
          <Route path="classes"   element={<MyClassesPage />} />
          <Route path="history"   element={<AttendancePage />} />
          <Route path="reports"        element={<TeacherReportsPage />} />
          <Route path="ward-students" element={<TutorDashboardPage />} />
          <Route path="twm"            element={<TWMPage />} />
          <Route path="leave-requests" element={<LeaveRequestsPage />} />
          <Route path="disputes"        element={<TeacherDisputesPage />} />
          <Route path="feed"             element={<FeedPage />} />
          <Route path="feed/:articleId"  element={<ArticleDetailPage />} />
          <Route path="career"             element={<CareerRoadmapPage />} />
          <Route path="suggestions"        element={<SuggestionBoxPage />} />
          <Route path="profile"            element={<ProfilePage />} />
          <Route path="inbox"              element={<NotificationsInboxPage />} />
          <Route path="classpulse"         element={<ClassPulsePage />} />
          <Route path="live"               element={<TeacherLiveDashboard />} />
          <Route path="live/:sessionId"    element={<TeacherLiveDashboard />} />
          <Route path="live/:sessionId/brief"  element={<TeacherPreClassBrief />} />
          <Route path="live/:sessionId/report" element={<SessionHealthReport />} />
          <Route path="live/:sessionId/replay" element={<SmartReplayPage />} />
          <Route path="student/:studentId/knowledge" element={<StudentKnowledgeGraphPage />} />
          <Route path="analytics/:subjectId" element={<SubjectAnalyticsPage />} />
          <Route path="*"              element={<Navigate to="dashboard" replace />} />
        </Routes>
      </Suspense>
    </DashboardLayout>
  );
}
