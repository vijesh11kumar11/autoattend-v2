import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from '../../components/DashboardLayout';
import GenerateQRPage from './GenerateQRPage';

function TeacherHome() {
  return (
    <div className="card p-8 text-center text-slate-400 space-y-2">
      <span className="text-5xl">👩‍🏫</span>
      <p className="font-medium text-slate-600">Teacher Dashboard — coming soon</p>
    </div>
  );
}

export default function TeacherDashboard() {
  return (
    <DashboardLayout>
      <Routes>
        <Route path="dashboard" element={<TeacherHome />} />
        <Route path="qr"        element={<GenerateQRPage />} />
        <Route path="*"         element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardLayout>
  );
}
