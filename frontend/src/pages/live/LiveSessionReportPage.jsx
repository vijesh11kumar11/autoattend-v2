/**
 * LiveSessionReportPage — alias re-export of SessionHealthReport.
 *
 * The actual report UI lives in SessionHealthReport.jsx and is mounted
 * by both:
 *   • TeacherDashboard nested router → /teacher/live/:sessionId/report
 *   • App.jsx top-level route        → /teacher/live/:sessionId/report
 *
 * Keeping the file as a thin re-export avoids duplicating ~200 lines of
 * report markup while still letting other code import the conventional
 * "LiveSessionReportPage" name (PS7-A, PS10).
 */
import SessionHealthReport from './SessionHealthReport';

export default SessionHealthReport;
