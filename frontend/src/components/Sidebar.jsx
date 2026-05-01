/**
 * AutoAttend AI v2.0 — Sidebar
 *
 * Features:
 * • Role-aware navigation (principal / hod / teacher / student)
 * • Collapsible: icon-only mode when collapsed
 * • Active link highlight via react-router NavLink
 * • User avatar (initials) with role badge
 * • Logout button at bottom
 *
 * Usage: <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
 */

import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// ── Nav items per role ────────────────────────────────────────────────
const NAV_ITEMS = {
  principal: [
    { to: '/principal/dashboard',   icon: '🏠', label: 'Overview'     },
    { to: '/principal/departments', icon: '🏛️', label: 'Departments'  },
    { to: '/principal/reports',     icon: '📊', label: 'Reports'      },
    { to: '/principal/alerts',      icon: '🔔', label: 'Alerts'       },
    { to: '/principal/audit',       icon: '🔍', label: 'Audit'        },
    { to: '/principal/feed',        icon: '📰', label: 'News Feed'    },
    { to: '/principal/career',      icon: '🎯', label: 'Career Roadmap' },
    { to: '/principal/suggestions',  icon: '💡', label: 'Suggestion Box' },
    { to: '/principal/classpulse',  icon: '📚', label: 'ClassPulse'    },
  ],
  hod: [
    { to: '/hod/dashboard',         icon: '🏠', label: 'Overview'            },
    { to: '/hod/section-analytics', icon: '📊', label: 'Sections'            },
    { to: '/hod/students',          icon: '🎓', label: 'Students'            },
    { to: '/hod/teachers',          icon: '👩‍🏫', label: 'Teachers'           },
    { to: '/hod/teacher-perf',      icon: '📈', label: 'Teacher Performance' },
    { to: '/hod/timetable',         icon: '🗓️', label: 'Timetable'          },
    { to: '/hod/tutors',            icon: '📝', label: 'Tutor Management'    },
    { to: '/hod/tutor-overview',    icon: '👥', label: 'Tutor Overview'      },
    { to: '/hod/reports',           icon: '📋', label: 'Reports'             },
    { to: '/hod/disputes',          icon: '⚖️', label: 'Disputes'            },
    { to: '/hod/semester-progress', icon: '🔮', label: 'Semester Progress'   },
    { to: '/hod/alerts',            icon: '🔔', label: 'Alerts'              },
    { to: '/hod/leave-requests',    icon: '✋', label: 'Leave Approvals'     },
    { to: '/hod/face-reenroll',     icon: '🤳', label: 'Face Re-enroll'      },
    { to: '/hod/feed',              icon: '📰', label: 'News Feed'           },
    { to: '/hod/career',            icon: '🎯', label: 'Career Roadmap'     },
    { to: '/hod/suggestions',      icon: '💡', label: 'Suggestion Box'    },
    { to: '/hod/classpulse',       icon: '📚', label: 'ClassPulse'          },
  ],
  teacher: [
    { to: '/teacher/dashboard', icon: '🏠', label: 'Dashboard'          },
    { to: '/teacher/classes',   icon: '📖', label: 'My Timetable'       },
    { to: '/teacher/qr',        icon: '📱', label: 'Generate QR'        },
    { to: '/teacher/history',   icon: '📋', label: 'Attendance History' },
    { to: '/teacher/reports',        icon: '📊', label: 'Reports'            },
    { to: '/teacher/ward-students', icon: '🎓', label: 'Ward Students'     },
    { to: '/teacher/leave-requests', icon: '✋', label: 'Leave Requests'     },
    { to: '/teacher/twm',           icon: '🤝', label: 'TWM Meetings'       },
    { to: '/teacher/disputes',       icon: '⚖️', label: 'Disputes'            },
    { to: '/teacher/feed',          icon: '📰', label: 'News Feed'           },
    { to: '/teacher/career',        icon: '🎯', label: 'Career Roadmap'     },
    { to: '/teacher/suggestions',  icon: '💡', label: 'Suggestion Box'    },
    { to: '/teacher/classpulse',   icon: '📚', label: 'ClassPulse'         },
  ],
  student: [
    { to: '/student/dashboard',  icon: '🏠', label: 'Dashboard'         },
    { to: '/student/scan-qr',    icon: '📷', label: 'Scan QR'           },
    { to: '/student/attendance', icon: '✅', label: 'My Attendance'     },
    { to: '/student/timetable',  icon: '🗓️', label: 'Timetable'        },
    { to: '/student/leaves',     icon: '📋', label: 'Leave Requests'   },
    { to: '/student/disputes',   icon: '⚖️', label: 'Disputes'          },
    { to: '/student/download',   icon: '⬇️', label: 'Download Report'   },
    { to: '/student/feed',       icon: '📰', label: 'News Feed'       },
    { to: '/student/career',     icon: '🎯', label: 'Career Roadmap' },
    { to: '/student/suggestions', icon: '💡', label: 'Suggestion Box' },
    { to: '/student/classpulse', icon: '📚', label: 'ClassPulse'      },
  ],
};

const ROLE_BADGE_CLASS = {
  principal: 'badge-principal',
  hod:       'badge-hod',
  teacher:   'badge-teacher',
  student:   'badge-student',
};

const ROLE_LABEL = {
  principal: 'Principal',
  hod:       'HOD',
  teacher:   'Teacher',
  student:   'Student',
};

// ── Initials avatar ───────────────────────────────────────────────────
function Avatar({ name, size = 'md' }) {
  const initials = (name || 'U')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  const sz = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div className={`${sz} rounded-full bg-white/20 flex items-center justify-center
                     font-bold text-white flex-shrink-0 select-none`}>
      {initials}
    </div>
  );
}

// ── Chevron icon ──────────────────────────────────────────────────────
function ChevronIcon({ right }) {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
            d={right ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Sidebar component
// ═══════════════════════════════════════════════════════════════════════

export default function Sidebar({ collapsed = false, onToggle }) {
  const { user, logout } = useAuth();
  const role   = user?.role || 'student';
  const items  = NAV_ITEMS[role] ?? [];

  return (
    <aside
      className="fixed left-0 top-0 h-full flex flex-col z-40 transition-all duration-200"
      style={{
        width:      collapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)',
        background: 'linear-gradient(180deg, #1a237e 0%, #0d174f 100%)',
      }}
    >
      {/* ── Header: logo + collapse button ── */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-white/10">
        {!collapsed && (
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="text-2xl leading-none">🎓</span>
            <span className="text-white font-bold text-sm whitespace-nowrap truncate">
              AutoAttend AI
            </span>
          </div>
        )}
        {collapsed && <span className="text-2xl mx-auto leading-none">🎓</span>}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10
                     transition-colors flex-shrink-0"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronIcon right={collapsed} />
        </button>
      </div>

      {/* ── User card ── */}
      <div className={`flex items-center gap-3 px-3 py-4 border-b border-white/10
                       ${collapsed ? 'justify-center' : ''}`}>
        <Avatar name={user?.name} />
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-white text-sm font-semibold truncate leading-tight">
              {user?.name || 'User'}
            </p>
            <span className={`mt-0.5 ${ROLE_BADGE_CLASS[role]}`}>
              {ROLE_LABEL[role]}
            </span>
          </div>
        )}
      </div>

      {/* ── Navigation links ── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {items.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              isActive ? 'sidebar-link-active' : 'sidebar-link'
            }
            title={collapsed ? label : undefined}
          >
            <span className="text-lg leading-none flex-shrink-0">{icon}</span>
            {!collapsed && (
              <span className="truncate">{label}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Logout ── */}
      <div className="px-2 py-3 border-t border-white/10">
        <button
          onClick={logout}
          className="sidebar-link w-full"
          title={collapsed ? 'Logout' : undefined}
        >
          <span className="text-lg leading-none flex-shrink-0">🚪</span>
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}

