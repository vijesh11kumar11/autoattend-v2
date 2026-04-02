import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from '../../components/DashboardLayout';
import GenerateQRPage from './GenerateQRPage';
import AttendancePage from './AttendancePage';

function TeacherHome() {
  return (
    <div className="card p-8 text-center text-slate-400 space-y-2">
      <span className="text-5xl">👩‍🏫</span>
      <p className="font-medium text-slate-600">Teacher Dashboard — coming soon</p>
    </div>
  );
}

function ClassesStub() {
  return (
    <div className="card p-8 text-center text-slate-400 space-y-2">
      <span className="text-5xl">📖</span>
      <p className="font-medium text-slate-600">My Classes — coming soon</p>
    </div>
  );
}

function ReportsStub() {
  return (
    <div className="card p-8 text-center text-slate-400 space-y-2">
      <span className="text-5xl">📊</span>
      <p className="font-medium text-slate-600">Reports — coming soon</p>
    </div>
  );
}

export default function TeacherDashboard() {
  return (
    <DashboardLayout>
      <Routes>
        <Route path="dashboard" element={<TeacherHome />} />
        <Route path="qr"        element={<GenerateQRPage />} />
        <Route path="classes"   element={<ClassesStub />} />
        <Route path="history"   element={<AttendancePage />} />
        <Route path="reports"   element={<ReportsStub />} />
        <Route path="*"         element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardLayout>
  );
}
