/**
 * AutoAttend AI v2.0 — Article Detail Page
 *
 * Full article view with hero image, markdown body,
 * related articles, and back-to-feed navigation.
 * Shared across all roles.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import api from '../../api/axios';

const CAT_BADGE = {
  jobs: 'bg-blue-100 text-blue-700',
  education: 'bg-emerald-100 text-emerald-700',
  ai: 'bg-purple-100 text-purple-700',
  technology: 'bg-orange-100 text-orange-700',
  future: 'bg-pink-100 text-pink-700',
};

function RelatedCard({ article, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  const badge = CAT_BADGE[article.category] || CAT_BADGE.education;

  return (
    <button
      onClick={() => onClick(article)}
      className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden text-left
                       hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col"
    >
      <div className="h-32 bg-gradient-to-br from-slate-200 to-indigo-50 overflow-hidden relative">
        {article.image_url && !imgErr ? (
          <img
            src={article.image_url}
            alt=""
            loading="lazy"
            onError={() => setImgErr(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl opacity-25">
            📰
          </div>
        )}
        <span
          className={`absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full font-medium ${badge}`}
        >
          {article.category}
        </span>
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <h4 className="text-xs font-semibold text-slate-700 line-clamp-2 mb-1">{article.title}</h4>
        <span className="text-[10px] text-slate-400 mt-auto">
          ⏱ {article.reading_time} min read
        </span>
      </div>
    </button>
  );
}

export default function ArticleDetailPage() {
  const { articleId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [article, setArticle] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const cat = searchParams.get('cat') || 'all';

  useEffect(() => {
    window.scrollTo(0, 0);
    setLoading(true);
    setError('');
    api
      .get(`/feed/article/${articleId}`)
      .then((r) => {
        setArticle(r.data.article);
        setRelated(r.data.related || []);
      })
      .catch(() => setError('Article not found or failed to load.'))
      .finally(() => setLoading(false));
  }, [articleId]);

  const goBack = () => {
    const base = window.location.pathname.split('/feed')[0];
    navigate(`${base}/feed${cat !== 'all' ? `?cat=${cat}` : ''}`);
  };

  const openRelated = (a) => {
    const base = window.location.pathname.split('/feed')[0];
    navigate(`${base}/feed/${a.id}?cat=${cat}`);
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-32 bg-slate-200 rounded" />
        <div className="h-64 bg-slate-200 rounded-2xl" />
        <div className="space-y-3 max-w-3xl mx-auto">
          <div className="h-6 w-3/4 bg-slate-200 rounded" />
          <div className="h-4 w-1/4 bg-slate-100 rounded" />
          <div className="space-y-2 mt-6">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="h-3 bg-slate-100 rounded"
                style={{ width: `${75 + Math.random() * 25}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-5xl mb-4">😢</p>
        <p className="text-slate-600 font-medium">{error}</p>
        <button
          onClick={goBack}
          className="mt-4 px-5 py-2 bg-[#1a237e] text-white rounded-lg text-sm hover:bg-[#283593]"
        >
          ← Back to Feed
        </button>
      </div>
    );
  }

  if (!article) return null;

  const badge = CAT_BADGE[article.category] || CAT_BADGE.education;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={goBack}
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-[#1a237e] transition-colors"
      >
        ← Back to Feed
      </button>

      {/* Hero */}
      {article.image_url && (
        <div className="relative h-64 md:h-80 rounded-2xl overflow-hidden bg-gradient-to-br from-slate-300 to-indigo-200">
          <img src={article.image_url} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-4 flex items-center gap-3">
            <span className={`text-xs px-3 py-1 rounded-full font-medium ${badge}`}>
              {article.category}
            </span>
            <span className="text-xs text-white/80">⏱ {article.reading_time} min read</span>
          </div>
        </div>
      )}

      {/* Article body */}
      <article className="max-w-3xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800 leading-tight mb-3">
          {article.title}
        </h1>

        <div className="flex flex-wrap gap-3 text-xs text-slate-400 mb-6">
          {!article.image_url && (
            <span className={`px-2.5 py-0.5 rounded-full font-medium ${badge}`}>
              {article.category}
            </span>
          )}
          <span className="font-medium text-slate-500">{article.source_name}</span>
          <span>·</span>
          <span>{article.time_ago}</span>
          {!article.image_url && <span>· ⏱ {article.reading_time} min read</span>}
        </div>

        {/* Description */}
        {article.description && (
          <p className="text-slate-600 mb-6 leading-relaxed border-l-4 border-indigo-200 pl-4 italic">
            {article.description}
          </p>
        )}

        {/* Markdown body */}
        {article.full_content ? (
          <div className="article-body text-slate-700 text-[15px] leading-[1.85] space-y-4">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold text-slate-800 mt-8 mb-3 pb-2 border-b border-slate-100">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl font-bold text-slate-800 mt-8 mb-3 pb-2 border-b border-slate-100">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-lg font-semibold text-slate-800 mt-6 mb-2">{children}</h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-base font-semibold text-slate-700 mt-5 mb-2">{children}</h4>
                ),
                p: ({ children }) => (
                  <p className="mb-4 leading-[1.85] text-slate-600">{children}</p>
                ),
                ul: ({ children }) => <ul className="my-4 ml-1 space-y-2">{children}</ul>,
                ol: ({ children }) => (
                  <ol className="my-4 ml-1 space-y-2 list-decimal list-inside">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="flex gap-2 items-start text-slate-600 pl-2">
                    <span className="text-indigo-400 mt-1.5 text-xs flex-shrink-0">●</span>
                    <span className="flex-1">{children}</span>
                  </li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="my-5 pl-5 border-l-4 border-indigo-300 bg-indigo-50/50 py-3 pr-4 rounded-r-lg text-slate-600 italic">
                    {children}
                  </blockquote>
                ),
                strong: ({ children }) => (
                  <strong className="font-bold text-slate-800">{children}</strong>
                ),
                em: ({ children }) => <em className="italic text-slate-500">{children}</em>,
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline underline-offset-2 decoration-blue-200 hover:decoration-blue-400 transition-colors"
                  >
                    {children}
                  </a>
                ),
                hr: () => <hr className="my-8 border-slate-200" />,
                code: ({ children }) => (
                  <code className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-sm font-mono">
                    {children}
                  </code>
                ),
                pre: ({ children }) => (
                  <pre className="bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto text-sm my-4">
                    {children}
                  </pre>
                ),
              }}
            >
              {article.full_content}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-slate-500 text-sm bg-slate-50 p-6 rounded-xl text-center">
            Full article content is not available here.
            <br />
            <a
              href={article.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 font-medium hover:underline"
            >
              Read the full article on {article.source_name} →
            </a>
          </p>
        )}

        {/* Source link */}
        {article.source_url && (
          <div className="mt-8 text-center">
            <a
              href={article.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#1a237e] text-white rounded-lg
                          hover:bg-[#283593] transition-colors text-sm"
            >
              🔗 Read on {article.source_name}
            </a>
          </div>
        )}
      </article>

      {/* Related articles */}
      {related.length > 0 && (
        <div className="max-w-3xl mx-auto mt-12 pt-8 border-t border-slate-100">
          <h2 className="text-lg font-bold text-slate-700 mb-4">More like this</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {related.map((a) => (
              <RelatedCard key={a.id} article={a} onClick={openRelated} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
