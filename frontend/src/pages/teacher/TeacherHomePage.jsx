import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const StatCard = ({ icon, label, value, color }) => (
  <div className="card p-5 flex items-center gap-4">
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${color}`}>
      {icon}
    </div>
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
    </div>
  </div>
);

export default function TeacherHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/faculty/my-dashboard')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load dashboard data.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading dashboard…</p>
      </div>
    );
  }

  if (error) {
    return <div className="card p-8 text-center text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="card bg-gradient-to-r from-[#1a237e] to-[#283593] p-6 text-white">
        <h1 className="text-xl font-bold">Welcome back, {data.teacher_name}!</h1>
        <p className="text-blue-200 text-sm mt-1">Here's your teaching overview for today.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="📚" label="My Subjects" value={data.total_subjects} color="bg-blue-50" />
        <StatCard icon="📋" label="Total Sessions" value={data.total_sessions} color="bg-green-50" />
        <StatCard icon="🔴" label="Active Now" value={data.active_sessions} color="bg-red-50" />
        <StatCard icon="📊" label="Avg Attendance" value={`${data.avg_attendance}%`} color="bg-amber-50" />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => navigate('/teacher/qr')}
          className="card p-5 text-center hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-[#1a237e]"
        >
          <span className="text-3xl block mb-2">📱</span>
          <p className="font-semibold text-slate-700">Generate QR</p>
          <p className="text-xs text-slate-400 mt-1">Start attendance session</p>
        </button>
        <button
          onClick={() => navigate('/teacher/history')}
          className="card p-5 text-center hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-[#1a237e]"
        >
          <span className="text-3xl block mb-2">📜</span>
          <p className="font-semibold text-slate-700">Attendance History</p>
          <p className="text-xs text-slate-400 mt-1">View past sessions</p>
        </button>
        <button
          onClick={() => navigate('/teacher/classes')}
          className="card p-5 text-center hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-[#1a237e]"
        >
          <span className="text-3xl block mb-2">📖</span>
          <p className="font-semibold text-slate-700">My Classes</p>
          <p className="text-xs text-slate-400 mt-1">Timetable & subjects</p>
        </button>
      </div>

      {/* Today's Timetable */}
      {data.timetable_today?.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">
            📅 Today's Timetable
          </div>
          <div className="divide-y">
            {data.timetable_today.map((slot, i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-700">{slot.subject_name} <span className="text-slate-400 text-sm">({slot.subject_code})</span></p>
                  <p className="text-xs text-slate-400">Room: {slot.room}</p>
                </div>
                <div className="text-sm font-mono text-slate-500">
                  {slot.start_time} – {slot.end_time}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's Sessions */}
      {data.todays_sessions?.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">
            🎯 Today's Attendance Sessions
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-400 uppercase border-b">
                <th className="px-5 py-2 text-left">Subject</th>
                <th className="px-5 py-2 text-left">Time</th>
                <th className="px-5 py-2 text-left">Status</th>
                <th className="px-5 py-2 text-left">Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.todays_sessions.map(s => {
                const pct = s.total_students ? Math.round((s.present_count / s.total_students) * 100) : 0;
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-medium text-slate-700">
                      {s.subject_name} <span className="text-slate-400">({s.subject_code})</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">{s.start_time?.slice(0, 5)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${
                        s.status === 'active' ? 'bg-green-100 text-green-700' :
                        s.status === 'ended'  ? 'bg-blue-100 text-blue-700'  : 'bg-amber-100 text-amber-700'
                      }`}>{s.status}</span>
                    </td>
                    <td className="px-5 py-3 text-sm">
                      <span className="font-bold">{s.present_count}/{s.total_students}</span>
                      <span className="text-slate-400 ml-1">({pct}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-6 text-center text-slate-400">
          <span className="text-3xl block mb-2">📭</span>
          <p>No attendance sessions today yet.</p>
          <button
            onClick={() => navigate('/teacher/qr')}
            className="mt-3 px-4 py-2 bg-[#1a237e] text-white text-sm font-semibold rounded-lg hover:bg-[#283593]"
          >
            Start a Session
          </button>
        </div>
      )}

      {/* Subjects List */}
      {data.subjects?.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">
            📚 My Subjects
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {data.subjects.map(s => (
              <div key={s.id} className="border rounded-xl p-4 hover:shadow-md transition-shadow">
                <p className="font-semibold text-slate-700">{s.name}</p>
                <p className="text-sm text-slate-400">{s.code} · Semester {s.semester}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
