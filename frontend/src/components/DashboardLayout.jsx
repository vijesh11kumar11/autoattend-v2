/**
 * AutoAttend AI v2.0 — DashboardLayout
 *
 * Shared wrapper for all role dashboards.
 * Renders Sidebar + Navbar + <main> content area.
 * Manages sidebar collapsed state.
 *
 * Usage:
 *   <DashboardLayout>
 *     <Routes>…</Routes>
 *   </DashboardLayout>
 */

import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';

// Maps pathname → page title shown in Navbar
const TITLE_MAP = {
  // Teacher
  '/teacher/dashboard': 'Dashboard',
  '/teacher/qr':        'Generate QR',
  '/teacher/classes':   'My Classes',
  '/teacher/history':   'Attendance History',
  '/teacher/reports':   'Reports',
  // HOD
  '/hod/dashboard':     'Overview',
  '/hod/teachers':      'Teachers',
  '/hod/students':      'Students',
  '/hod/subjects':      'Subjects',
  '/hod/timetable':     'Timetable',
  '/hod/reports':       'Reports',
  '/hod/alerts':        'Alerts',
  '/hod/face-reenroll': 'Face Re-enroll Requests',
  // Principal
  '/principal/dashboard':   'Overview',
  '/principal/departments': 'Departments',
  '/principal/reports':     'College Reports',
  '/principal/alerts':      'Alerts',
  '/principal/audit':       'Audit Log',
  // Student
  '/student/dashboard':   'Dashboard',
  '/student/scan-qr':     'Scan QR',
  '/student/attendance':  'My Attendance',
  '/student/timetable':   'Timetable',
  '/student/download':    'Download Report',
};

export default function DashboardLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const title = TITLE_MAP[pathname] ?? 'AutoAttend AI';

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

      <Navbar title={title} collapsed={collapsed} />

      <main
        className="transition-all duration-200 ease-in-out"
        style={{
          marginLeft: collapsed
            ? 'var(--sidebar-collapsed-width)'
            : 'var(--sidebar-width)',
          marginTop:  'var(--navbar-height)',
          minHeight:  'calc(100vh - var(--navbar-height))',
          padding:    '1.5rem',
        }}
      >
        {children}
      </main>
    </div>
  );
}
