import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from '../../components/DashboardLayout';
import GenerateQRPage from './GenerateQRPage';
import AttendancePage from './AttendancePage';
import TeacherHome from './TeacherHomePage';
import MyClassesPage from './MyClassesPage';
import TeacherReportsPage from './TeacherReportsPage';
import TutorDashboardPage from './TutorDashboardPage';
import TWMPage from './TWMPage';
import LeaveRequestsPage from './LeaveRequestsPage';
import SubjectAnalyticsPage from './SubjectAnalyticsPage';
import TeacherDisputesPage from './TeacherDisputesPage';
import FeedPage from '../shared/FeedPage';
import ArticleDetailPage from '../shared/ArticleDetailPage';
import CareerRoadmapPage from '../shared/CareerRoadmapPage';
import SuggestionBoxPage from '../shared/SuggestionBoxPage';
import ClassPulsePage from './ClassPulsePage';
import TeacherLiveDashboard from '../live/TeacherLiveDashboard';
import TeacherPreClassBrief from '../live/TeacherPreClassBrief';
import SessionHealthReport from '../live/SessionHealthReport';
import StudentKnowledgeGraphPage from '../live/StudentKnowledgeGraphPage';

export default function TeacherDashboard() {
  return (
    <DashboardLayout>
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
        <Route path="classpulse"         element={<ClassPulsePage />} />
        <Route path="live"               element={<TeacherLiveDashboard />} />
        <Route path="live/:sessionId"    element={<TeacherLiveDashboard />} />
        <Route path="live/:sessionId/brief"  element={<TeacherPreClassBrief />} />
        <Route path="live/:sessionId/report" element={<SessionHealthReport />} />
        <Route path="student/:studentId/knowledge" element={<StudentKnowledgeGraphPage />} />
        <Route path="analytics/:subjectId" element={<SubjectAnalyticsPage />} />
        <Route path="*"              element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardLayout>
  );
}
