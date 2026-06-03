/**
 * AutoAttend AI v2.0 — Smart Suggestion Box
 * Shared across all roles with role-specific tabs and content.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════ */
const ROLE_CFG = {
  student: {
    icon: '💡',
    title: 'Suggestion Box',
    sub: 'Your voice matters — share feedback anonymously',
    bg: 'from-indigo-600 to-purple-600',
  },
  teacher: {
    icon: '📬',
    title: 'Student Feedback',
    sub: 'See what your students are saying about your classes',
    bg: 'from-blue-600 to-cyan-600',
  },
  hod: {
    icon: '📊',
    title: 'Department Feedback Analysis',
    sub: 'AI-powered insights from your department',
    bg: 'from-[#1a237e] to-indigo-700',
  },
  principal: {
    icon: '🏛️',
    title: 'Institution Feedback Dashboard',
    sub: "Complete picture of your institution's pulse",
    bg: 'from-[#4a0000] to-purple-900',
  },
};

const TABS = {
  student: ['submit', 'my'],
  teacher: ['teacher-fb', 'submit', 'my'],
  hod: ['ai', 'all', 'submit', 'my'],
  principal: ['ai', 'all', 'submit', 'my'],
};

const TAB_LABELS = {
  ai: 'AI Analysis',
  all: 'All Feedback',
  submit: 'Submit Feedback',
  my: 'My Submissions',
  'teacher-fb': 'Student Feedback',
};

const CATEGORIES = [
  { key: 'teaching_quality', icon: '🎓', label: 'Teaching Quality' },
  { key: 'infrastructure', icon: '🏗️', label: 'Infrastructure' },
  { key: 'syllabus', icon: '📚', label: 'Syllabus & Curriculum' },
  { key: 'administration', icon: '⚙️', label: 'Administration' },
  { key: 'canteen', icon: '🍽️', label: 'Canteen & Food' },
  { key: 'hostel', icon: '🏠', label: 'Hostel & Accommodation' },
  { key: 'sports', icon: '⚽', label: 'Sports & Recreation' },
  { key: 'library', icon: '📖', label: 'Library & Resources' },
  { key: 'other', icon: '💡', label: 'General Suggestion' },
];
const TEACHER_EXTRA_CATS = [
  { key: 'class_environment', icon: '📝', label: 'My Class Environment' },
  { key: 'student_engagement', icon: '🎯', label: 'Student Engagement' },
];

const PRIORITY_OPTS = [
  {
    key: 'low',
    icon: '💬',
    label: 'Just sharing',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
  },
  {
    key: 'medium',
    icon: '⚡',
    label: 'This needs attention',
    color: 'bg-orange-50 border-orange-200 text-orange-700',
  },
  {
    key: 'high',
    icon: '🔥',
    label: 'This is urgent',
    color: 'bg-red-50 border-red-200 text-red-700',
  },
];

const SENTIMENT_BADGE = {
  positive: 'bg-emerald-100 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  negative: 'bg-red-100 text-red-700',
  mixed: 'bg-amber-100 text-amber-700',
};

const PRIORITY_BADGE = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-orange-100 text-orange-700',
  high: 'bg-red-100 text-red-700',
  critical: 'bg-red-200 text-red-800 animate-pulse',
};

const STATUS_BADGE = {
  pending: 'bg-slate-100 text-slate-600',
  reviewed: 'bg-blue-100 text-blue-700',
  actioned: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-red-100 text-red-700',
};

const LOADING_STEPS = [
  'Collecting all feedback...',
  'Sending to Gemini AI...',
  'Analysing patterns...',
  'Generating insights...',
];

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */
export default function SuggestionBoxPage() {
  const { user } = useAuth();
  const role = user?.role || 'student';
  const cfg = ROLE_CFG[role] || ROLE_CFG.student;
  const tabs = TABS[role] || TABS.student;
  const [activeTab, setActiveTab] = useState(tabs[0]);

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className={`bg-gradient-to-r ${cfg.bg} rounded-2xl p-6 md:p-8 text-white`}>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
          <span className="text-3xl">{cfg.icon}</span>
          {cfg.title}
        </h1>
        <p className="text-white/70 mt-1 text-sm">{cfg.sub}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all
              ${activeTab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="animate-fade-in">
        {activeTab === 'submit' && <SubmitTab role={role} />}
        {activeTab === 'my' && <MySubmissionsTab />}
        {activeTab === 'teacher-fb' && <TeacherFeedbackTab />}
        {activeTab === 'ai' && <AIAnalysisTab role={role} />}
        {activeTab === 'all' && <AllFeedbackTab role={role} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SUBMIT TAB
   ═══════════════════════════════════════════════════════════════════════ */
function SubmitTab({ role }) {
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('low');
  const [subjectId, setSubjectId] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (role === 'student') {
      api
        .get('/student-portal/subjects')
        .then((r) => {
          setSubjects(Array.isArray(r.data) ? r.data : r.data.subjects || []);
        })
        .catch(() => {});
    }
  }, [role]);

  const cats = useMemo(
    () => (role === 'teacher' ? [...CATEGORIES, ...TEACHER_EXTRA_CATS] : CATEGORIES),
    [role]
  );

  const placeholder =
    role === 'teacher'
      ? 'Share your thoughts about the department, infrastructure, or administration.'
      : 'Describe your experience, suggestion, or complaint. Be specific — this helps authorities take real action.';

  const handleSubmit = async () => {
    if (!category) {
      setError('Please select a category');
      return;
    }
    if (message.trim().length < 20) {
      setError('Feedback must be at least 20 characters');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api.post('/suggestions/submit', {
        category,
        target_scope: subjectId ? 'subject' : 'general',
        target_subject_id: subjectId || null,
        message: message.trim(),
        is_anonymous: true,
        priority,
      });
      setSuccess(true);
      setCategory('');
      setMessage('');
      setPriority('low');
      setSubjectId('');
      setTimeout(() => setSuccess(false), 5000);
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-10 text-center space-y-4">
        <div className="text-6xl">✅</div>
        <h2 className="text-xl font-bold text-emerald-700">Feedback Submitted!</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Your feedback has been submitted anonymously. Thank you for helping improve our
          institution!
        </p>
        <button
          onClick={() => setSuccess(false)}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
        >
          Submit Another
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 space-y-6">
      {/* Anonymous notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <span className="text-2xl flex-shrink-0">🔒</span>
        <div>
          <p className="text-sm font-semibold text-blue-800">
            Your identity is completely anonymous.
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            No one — not your teacher, HOD, or principal — can ever see who submitted this feedback.
          </p>
        </div>
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}

      {/* Category */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">Category</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {cats.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                setCategory(c.key);
                setError('');
              }}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md
                ${category === c.key ? 'border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-100' : 'border-slate-100 hover:border-slate-200'}`}
            >
              <span className="text-xl">{c.icon}</span>
              <span
                className={`text-sm font-medium ${category === c.key ? 'text-indigo-700' : 'text-slate-700'}`}
              >
                {c.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Subject selector (student only) */}
      {role === 'student' && subjects.length > 0 && (
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Who is this about? (optional)
          </label>
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="">General — not about any specific subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Message */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Your Feedback</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder}
          rows={5}
          maxLength={1000}
          className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
        />
        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>Min 20 characters</span>
          <span className={message.length < 20 ? 'text-red-400' : ''}>{message.length}/1000</span>
        </div>
      </div>

      {/* Priority */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          How urgent is this?
        </label>
        <div className="grid grid-cols-3 gap-3">
          {PRIORITY_OPTS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPriority(p.key)}
              className={`p-3 rounded-xl border-2 text-center transition-all
                ${priority === p.key ? `border-indigo-500 ${p.color} shadow-md` : 'border-slate-100 hover:border-slate-200'}`}
            >
              <span className="text-xl block mb-1">{p.icon}</span>
              <p className="text-xs font-semibold">{p.label}</p>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3.5 rounded-xl text-white font-semibold text-sm bg-gradient-to-r from-indigo-600 to-purple-600
          hover:opacity-90 transition-all shadow-lg disabled:opacity-50"
      >
        {submitting ? '⏳ Submitting...' : '📤 Submit Anonymously'}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MY SUBMISSIONS TAB
   ═══════════════════════════════════════════════════════════════════════ */
function MySubmissionsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/suggestions/my-submissions')
      .then((r) => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonCards count={3} />;

  if (!items.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center">
        <div className="text-5xl mb-3">📭</div>
        <p className="text-slate-400 text-sm">
          You haven't submitted any feedback yet. Your anonymous voice can help improve the
          institution!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((s) => (
        <SuggestionCard key={s.id} s={s} />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TEACHER FEEDBACK TAB
   ═══════════════════════════════════════════════════════════════════════ */
function TeacherFeedbackTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/suggestions/teacher-feedback')
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonCards count={3} />;

  if (!data?.grouped_feedback?.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center">
        <div className="text-5xl mb-3">📭</div>
        <p className="text-slate-400 text-sm">
          No student feedback received yet for your subjects.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
        ℹ️ These are anonymous submissions from your students. Student identities are completely
        protected.
      </div>
      {data.grouped_feedback.map((group, gi) => (
        <div key={gi}>
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-bold text-slate-700">
              📚 {group.subject?.name || 'Unknown Subject'}
            </h3>
            {group.feedback?.length > 0 &&
              (() => {
                const sentiments = group.feedback.map((f) => f.sentiment).filter(Boolean);
                const neg = sentiments.filter((s) => s === 'negative').length;
                const pos = sentiments.filter((s) => s === 'positive').length;
                const avg =
                  sentiments.length === 0
                    ? null
                    : pos > neg
                      ? 'positive'
                      : neg > pos
                        ? 'negative'
                        : 'neutral';
                return avg ? (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${SENTIMENT_BADGE[avg]}`}
                  >
                    {avg}
                  </span>
                ) : null;
              })()}
            <span className="text-[10px] text-slate-400">
              {group.feedback?.length || 0} feedback
            </span>
          </div>
          <div className="space-y-2.5 pl-4 border-l-2 border-blue-200">
            {group.feedback.map((f) => (
              <SuggestionCard key={f.id} s={f} compact />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   AI ANALYSIS TAB
   ═══════════════════════════════════════════════════════════════════════ */
function AIAnalysisTab({ role }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [error, setError] = useState('');

  const scope = role === 'principal' ? 'institution' : 'department';
  const endpoint =
    scope === 'institution'
      ? '/suggestions/institution-analysis'
      : '/suggestions/department-analysis';

  useEffect(() => {
    api
      .get(endpoint)
      .then((r) => {
        if (r.data.report) setReport(r.data.report);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [endpoint]);

  // Loading step animation
  useEffect(() => {
    if (!generating) return;
    setGenStep(0);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i < 4) setGenStep(i);
      else clearInterval(iv);
    }, 2500);
    return () => clearInterval(iv);
  }, [generating]);

  const generateReport = async () => {
    setGenerating(true);
    setError('');
    try {
      const r = await api.post('/suggestions/generate-ai-report', { scope });
      setReport(r.data.report);
    } catch (e) {
      setError(e.response?.data?.detail || 'AI analysis failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <SkeletonCards count={4} />;

  if (generating) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center space-y-6">
        <div className="w-16 h-16 mx-auto border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
        <div className="space-y-3 max-w-xs mx-auto">
          {LOADING_STEPS.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 text-sm transition-all duration-500 ${i <= genStep ? 'opacity-100' : 'opacity-20'}`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                ${i < genStep ? 'bg-emerald-500 text-white' : i === genStep ? 'bg-indigo-600 text-white animate-pulse' : 'bg-slate-200 text-slate-400'}`}
              >
                {i < genStep ? '✓' : i + 1}
              </span>
              <span className={i <= genStep ? 'text-slate-700' : 'text-slate-400'}>{step}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400">This may take 15–30 seconds</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-10 text-center space-y-4">
        <div className="text-6xl">🤖</div>
        <h2 className="text-lg font-bold text-slate-700">No AI Analysis Yet</h2>
        <p className="text-sm text-slate-400 max-w-md mx-auto">
          Click Generate AI Analysis to get instant AI-powered insights from all feedback
          submissions.
        </p>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <button
          onClick={generateReport}
          className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-lg"
        >
          🤖 Generate AI Analysis
        </button>
      </div>
    );
  }

  const rd = report.report_data || {};

  return (
    <div className="space-y-6">
      {/* Header + regen */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-400">
          Last generated:{' '}
          {report.generated_at ? new Date(report.generated_at).toLocaleString() : '—'}
          <span className="ml-2 px-2 py-0.5 bg-slate-100 rounded-full">{report.ai_provider}</span>
        </div>
        <button
          onClick={generateReport}
          className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-xs font-semibold hover:opacity-90"
        >
          🤖 Regenerate
        </button>
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Feedback" value={rd.total_analysed || 0} icon="📋" />
        <MoodScoreCard score={rd.mood_score ?? 50} />
        <SentimentBarCard breakdown={rd.sentiment_breakdown} overall={rd.overall_sentiment} />
        <StatCard
          label="Urgent Items"
          value={(rd.urgent_attention || []).length}
          icon="🚨"
          valueClass={(rd.urgent_attention || []).length > 0 ? 'text-red-600' : ''}
        />
      </div>

      {/* Executive summary */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <p className="text-xs font-semibold text-indigo-600 mb-2">✨ AI Generated Summary</p>
        <p className="text-sm text-slate-700 leading-relaxed">{rd.executive_summary}</p>
        {rd.trend_insight && (
          <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
            📈 {rd.trend_insight}
          </p>
        )}
      </div>

      {/* Top Issues */}
      {rd.top_issues?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">🔍 Top Issues</h3>
          <div className="space-y-3">
            {rd.top_issues.map((issue, i) => (
              <div
                key={i}
                className={`bg-white rounded-xl border shadow-sm p-4 ${issue.severity === 'critical' ? 'border-red-300 ring-1 ring-red-100 animate-[pulse-border_2s_ease-in-out_infinite]' : 'border-slate-100'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {issue.rank || i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-slate-800 text-sm">{issue.issue_title}</h4>
                    <p className="text-xs text-slate-500 mt-1">{issue.issue_description}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                        {issue.category}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${PRIORITY_BADGE[issue.severity] || PRIORITY_BADGE.medium}`}
                      >
                        {issue.severity}
                      </span>
                      {issue.affected_count && (
                        <span className="text-[10px] px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                          ~{issue.affected_count} affected
                        </span>
                      )}
                    </div>
                    {issue.suggested_action && (
                      <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-xs text-amber-800">💡 {issue.suggested_action}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Themes + Highlights */}
      <div className="grid gap-4 md:grid-cols-2">
        {rd.recurring_themes?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">🔄 Recurring Themes</h3>
            <div className="flex flex-wrap gap-2">
              {rd.recurring_themes.map((t, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs font-medium"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
        {rd.positive_highlights?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">✅ Positive Highlights</h3>
            <div className="space-y-2">
              {rd.positive_highlights.map((h, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg"
                >
                  <span className="text-emerald-500 text-sm flex-shrink-0">✓</span>
                  <p className="text-xs text-emerald-800">{h}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recommendations */}
      {rd.actionable_recommendations?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            📌 Actionable Recommendations
          </h3>
          <div className="space-y-2">
            {rd.actionable_recommendations.map((rec, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-white rounded-xl border border-slate-100 shadow-sm p-4 border-l-4 border-l-[#1a237e]"
              >
                <div className="w-6 h-6 rounded bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <p className="text-sm text-slate-700">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {rd.category_breakdown && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">📊 Category Breakdown</h3>
          <CategoryBarChart data={rd.category_breakdown} />
        </div>
      )}

      {/* Urgent attention */}
      {rd.urgent_attention?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-red-600 mb-3">🚨 Needs Urgent Attention</h3>
          <div className="space-y-2">
            {rd.urgent_attention.map((u, i) => (
              <div key={i} className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-800">{u.issue}</p>
                <p className="text-xs text-red-600 mt-1">💡 {u.recommended_action}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ALL FEEDBACK TAB  (HOD + Principal)
   ═══════════════════════════════════════════════════════════════════════ */
function AllFeedbackTab({ role }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ category: '', sentiment: '', priority: '', status: '' });
  const [respondModal, setRespondModal] = useState(null);

  const scope = role === 'principal' ? 'institution' : 'department';
  const endpoint =
    scope === 'institution'
      ? '/suggestions/institution-analysis'
      : '/suggestions/department-analysis';

  const fetchData = useCallback(() => {
    setLoading(true);
    api
      .get(endpoint)
      .then((r) => setItems(r.data.suggestions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [endpoint]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(
    () =>
      items.filter(
        (s) =>
          (!filter.category || s.category === filter.category) &&
          (!filter.sentiment || s.sentiment === filter.sentiment) &&
          (!filter.priority || s.priority === filter.priority) &&
          (!filter.status || s.status === filter.status)
      ),
    [items, filter]
  );

  if (loading) return <SkeletonCards count={4} />;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <FilterSelect
          label="Category"
          value={filter.category}
          onChange={(v) => setFilter((f) => ({ ...f, category: v }))}
          options={CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
        />
        <FilterSelect
          label="Sentiment"
          value={filter.sentiment}
          onChange={(v) => setFilter((f) => ({ ...f, sentiment: v }))}
          options={['positive', 'neutral', 'negative', 'mixed'].map((v) => ({
            value: v,
            label: v,
          }))}
        />
        <FilterSelect
          label="Priority"
          value={filter.priority}
          onChange={(v) => setFilter((f) => ({ ...f, priority: v }))}
          options={['low', 'medium', 'high', 'critical'].map((v) => ({ value: v, label: v }))}
        />
        <FilterSelect
          label="Status"
          value={filter.status}
          onChange={(v) => setFilter((f) => ({ ...f, status: v }))}
          options={['pending', 'reviewed', 'actioned', 'dismissed'].map((v) => ({
            value: v,
            label: v,
          }))}
        />
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} results</span>
      </div>

      {!filtered.length && (
        <div className="bg-white rounded-xl border border-slate-100 p-8 text-center text-sm text-slate-400">
          No feedback matches filters.
        </div>
      )}

      {filtered.map((s) => (
        <SuggestionCard key={s.id} s={s} showRespond onRespond={() => setRespondModal(s)} />
      ))}

      {/* Respond Modal */}
      {respondModal && (
        <RespondModal
          suggestion={respondModal}
          onClose={() => {
            setRespondModal(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SHARED SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════ */

function SuggestionCard({ s, compact, showRespond, onRespond }) {
  const catObj = [...CATEGORIES, ...TEACHER_EXTRA_CATS].find((c) => c.key === s.category);
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs px-2.5 py-0.5 bg-indigo-50 text-indigo-700 rounded-full font-medium">
          {catObj?.icon || '💡'} {catObj?.label || s.category}
        </span>
        {s.sentiment && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${SENTIMENT_BADGE[s.sentiment] || ''}`}
          >
            {s.sentiment}
          </span>
        )}
        {s.priority && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_BADGE[s.priority] || ''}`}
          >
            {s.priority}
          </span>
        )}
        {s.status && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[s.status] || ''}`}
          >
            {s.status}
          </span>
        )}
        <span className="text-[10px] text-slate-400 ml-auto">
          {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : ''}
        </span>
      </div>
      <p className={`text-sm text-slate-700 ${compact ? 'line-clamp-3' : ''}`}>{s.message}</p>
      {s.admin_response && (
        <div className="mt-3 p-3 bg-[#1a237e] rounded-lg">
          <p className="text-[10px] text-white/60 font-semibold mb-1">📣 Official Response</p>
          <p className="text-xs text-white/90">{s.admin_response}</p>
        </div>
      )}
      {showRespond && !s.admin_response && (
        <button
          onClick={onRespond}
          className="mt-2 text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
        >
          💬 Respond
        </button>
      )}
    </div>
  );
}

function RespondModal({ suggestion, onClose }) {
  const [response, setResponse] = useState('');
  const [status, setStatus] = useState('reviewed');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!response.trim()) {
      setError('Response cannot be empty');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/suggestions/${suggestion.id}/respond`, {
        admin_response: response.trim(),
        status,
      });
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-slate-800">Respond to Feedback</h3>
        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 max-h-32 overflow-y-auto">
          {suggestion.message}
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          rows={4}
          placeholder="Write your official response..."
          className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
        />
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500">Status:</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            <option value="reviewed">Reviewed</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Response'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200"
    >
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function StatCard({ label, value, icon, valueClass = '' }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 text-center">
      <span className="text-2xl block mb-1">{icon}</span>
      <p className={`text-2xl font-bold ${valueClass || 'text-slate-800'}`}>{value}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function MoodScoreCard({ score }) {
  const color = score <= 40 ? '#ef4444' : score <= 70 ? '#f59e0b' : '#22c55e';
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col items-center">
      <div className="relative w-16 h-16 mb-1">
        <div
          className="w-16 h-16 rounded-full"
          style={{
            background: `conic-gradient(${color} ${score * 3.6}deg, #e2e8f0 ${score * 3.6}deg)`,
          }}
        >
          <div className="absolute inset-1.5 rounded-full bg-white flex items-center justify-center">
            <span className="text-lg font-bold" style={{ color }}>
              {score}
            </span>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-slate-400">Mood Score</p>
    </div>
  );
}

function SentimentBarCard({ breakdown, overall }) {
  const b = breakdown || {};
  const total =
    (b.positive_count || 0) +
      (b.neutral_count || 0) +
      (b.negative_count || 0) +
      (b.mixed_count || 0) || 1;
  const pct = (v) => Math.round(((v || 0) / total) * 100);
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <p className="text-[10px] text-slate-400 mb-2">Sentiment</p>
      <div className="flex h-4 rounded-full overflow-hidden mb-2">
        {pct(b.positive_count) > 0 && (
          <div className="bg-emerald-400" style={{ width: `${pct(b.positive_count)}%` }} />
        )}
        {pct(b.neutral_count) > 0 && (
          <div className="bg-slate-300" style={{ width: `${pct(b.neutral_count)}%` }} />
        )}
        {pct(b.negative_count) > 0 && (
          <div className="bg-red-400" style={{ width: `${pct(b.negative_count)}%` }} />
        )}
        {pct(b.mixed_count) > 0 && (
          <div className="bg-amber-400" style={{ width: `${pct(b.mixed_count)}%` }} />
        )}
      </div>
      <p className="text-[10px] text-slate-500 truncate">{overall || '—'}</p>
    </div>
  );
}

function CategoryBarChart({ data }) {
  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  const colors = [
    'bg-indigo-500',
    'bg-blue-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-red-500',
    'bg-purple-500',
    'bg-cyan-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-rose-500',
  ];
  const catLabel = {
    teaching_quality: 'Teaching Quality',
    infrastructure: 'Infrastructure',
    syllabus: 'Syllabus',
    administration: 'Admin',
    canteen: 'Canteen',
    hostel: 'Hostel',
    sports: 'Sports',
    library: 'Library',
    other: 'Other',
    class_environment: 'Class Env',
    student_engagement: 'Engagement',
  };
  return (
    <div className="space-y-2">
      {entries.map(([key, val], i) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-xs text-slate-600 w-28 text-right truncate">
            {catLabel[key] || key}
          </span>
          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
            <div
              className={`h-full ${colors[i % colors.length]} rounded-full transition-all duration-500`}
              style={{ width: `${Math.max((val / max) * 100, 8)}%` }}
            />
          </div>
          <span className="text-xs font-bold text-slate-700 w-8 text-right">{val}</span>
        </div>
      ))}
    </div>
  );
}

function SkeletonCards({ count = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 animate-pulse"
        >
          <div className="h-3 bg-slate-200 rounded w-1/3 mb-3" />
          <div className="h-3 bg-slate-100 rounded w-full mb-2" />
          <div className="h-3 bg-slate-100 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}
