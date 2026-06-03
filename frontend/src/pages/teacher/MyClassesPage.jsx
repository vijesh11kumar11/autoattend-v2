import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const DAY_COLORS = {
  Monday: 'border-l-blue-500',
  Tuesday: 'border-l-emerald-500',
  Wednesday: 'border-l-purple-500',
  Thursday: 'border-l-amber-500',
  Friday: 'border-l-red-500',
  Saturday: 'border-l-slate-400',
};

export default function MyClassesPage() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get(`/faculty/${user.id}/classes`), api.get('/faculty/my-timetable')])
      .then(([classRes, ttRes]) => {
        setSubjects(classRes.data || []);
        setTimetable(ttRes.data?.timetable || []);
      })
      .catch(() => setError('Failed to load class data.'))
      .finally(() => setLoading(false));
  }, [user.id]);

  if (loading) {
    return (
      <div className="card p-10 text-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-[#1a237e] rounded-full animate-spin mx-auto" />
        <p className="text-slate-400 text-sm mt-3">Loading classes…</p>
      </div>
    );
  }

  if (error) {
    return <div className="card p-8 text-center text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Subjects Grid */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700 flex items-center justify-between">
          <span>📚 My Subjects</span>
          <span className="text-sm font-normal text-slate-400">
            {subjects.length} subject{subjects.length !== 1 ? 's' : ''}
          </span>
        </div>
        {subjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {subjects.map((s) => (
              <div key={s.id} className="border rounded-xl p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-700">{s.name}</p>
                    <p className="text-sm text-slate-400 mt-0.5">{s.code}</p>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">
                    Sem {s.semester}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400">No subjects assigned.</div>
        )}
      </div>

      {/* Weekly Timetable */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b font-semibold text-slate-700">
          📅 Weekly Timetable
        </div>
        {timetable.length > 0 ? (
          <div className="divide-y">
            {timetable.map((day) => (
              <div key={day.day} className="p-4">
                <h3 className="font-semibold text-slate-700 mb-3">{day.day}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {day.slots.map((slot, i) => (
                    <div
                      key={i}
                      className={`border-l-4 ${DAY_COLORS[day.day] || 'border-l-slate-300'} bg-slate-50 rounded-r-lg p-3`}
                    >
                      <p className="font-medium text-slate-700 text-sm">{slot.subject_name}</p>
                      <p className="text-xs text-slate-400">{slot.subject_code}</p>
                      <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                        <span className="font-mono">
                          {slot.start_time} – {slot.end_time}
                        </span>
                        <span>🏫 {slot.room}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400">
            <span className="text-3xl block mb-2">📭</span>
            <p>No timetable entries found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
