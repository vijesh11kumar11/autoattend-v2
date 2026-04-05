/**
 * AutoAttend AI v2.0 — News Feed Page
 *
 * Premium education & career news feed with category filtering,
 * skeleton loading, and card-based article display.
 * Shared across all roles.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/axios';

const CATEGORIES = [
  { key: 'all',        label: 'All',            icon: '🌐' },
  { key: 'jobs',       label: 'Jobs',           icon: '💼' },
  { key: 'education',  label: 'Education',      icon: '🎓' },
  { key: 'ai',         label: 'AI & Tech',      icon: '🤖' },
  { key: 'technology', label: 'Technology',      icon: '💻' },
  { key: 'future',     label: 'Future',         icon: '🚀' },
];

const CAT_BADGE = {
  jobs:       'bg-blue-100 text-blue-700',
  education:  'bg-emerald-100 text-emerald-700',
  ai:         'bg-purple-100 text-purple-700',
  technology: 'bg-orange-100 text-orange-700',
  future:     'bg-pink-100 text-pink-700',
};

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden animate-pulse">
      <div className="h-44 bg-gradient-to-br from-slate-200 to-slate-100" />
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-16 bg-slate-200 rounded" />
          <div className="h-3 w-20 bg-slate-100 rounded" />
        </div>
        <div className="h-4 w-full bg-slate-200 rounded" />
        <div className="h-4 w-3/4 bg-slate-200 rounded" />
        <div className="h-3 w-full bg-slate-100 rounded" />
        <div className="h-3 w-2/3 bg-slate-100 rounded" />
        <div className="flex items-center justify-between pt-2">
          <div className="h-6 w-20 bg-slate-100 rounded-full" />
          <div className="h-8 w-28 bg-slate-200 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function FeedCard({ article, onReadMore }) {
  const [imgError, setImgError] = useState(false);
  const badge = CAT_BADGE[article.category] || CAT_BADGE.education;

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden
                    hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
      {/* Image */}
      <div className="relative h-44 overflow-hidden bg-gradient-to-br from-slate-200 to-indigo-100">
        {article.image_url && !imgError ? (
          <img src={article.image_url} alt="" loading="lazy"
               onError={() => setImgError(true)}
               className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl opacity-30">
            {CATEGORIES.find(c => c.key === article.category)?.icon || '📰'}
          </div>
        )}
        <span className={`absolute top-3 left-3 text-xs px-2.5 py-1 rounded-full font-medium ${badge} backdrop-blur-sm`}>
          {article.category}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
          <span className="font-medium text-slate-500">{article.source_name}</span>
          <span>·</span>
          <span>{article.time_ago}</span>
        </div>

        <h3 className="font-semibold text-slate-800 text-sm leading-snug mb-2 line-clamp-2">
          {article.title}
        </h3>

        <p className="text-xs text-slate-500 leading-relaxed mb-3 line-clamp-2 flex-1">
          {article.description}
        </p>

        <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-50">
          <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
            ⏱ {article.reading_time} min read
          </span>
          <div className="flex items-center gap-2">
            {article.source_url && (
              <a href={article.source_url} target="_blank" rel="noopener noreferrer"
                 onClick={e => e.stopPropagation()}
                 className="text-xs text-slate-400 hover:text-blue-500">
                🔗 Source
              </a>
            )}
            <button onClick={() => onReadMore(article)}
                    className="text-xs px-3 py-1.5 bg-[#1a237e] text-white rounded-lg hover:bg-[#283593] transition-colors">
              Read Full Article
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FeedPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [articles, setArticles]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [category, setCategory]   = useState(searchParams.get('cat') || 'all');
  const [page, setPage]           = useState(1);
  const [hasMore, setHasMore]     = useState(false);
  const [total, setTotal]         = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  const fetchFeed = useCallback(async (cat, pg, append = false, query = '') => {
    if (!append) setLoading(true);
    setError('');
    try {
      const params = { page: pg };
      if (query) {
        params.search = query;
      } else {
        params.category = cat;
      }
      const r = await api.get('/feed', { params });
      const d = r.data;
      if (append) {
        setArticles(prev => [...prev, ...d.articles]);
      } else {
        setArticles(d.articles);
      }
      setHasMore(d.has_more);
      setTotal(d.total);
    } catch {
      setError('Failed to load feed. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (activeSearch) return; // don't fetch category when in search mode
    setPage(1);
    fetchFeed(category, 1);
    setSearchParams(category !== 'all' ? { cat: category } : {});
  }, [category]);

  const refresh = () => {
    setRefreshing(true);
    setPage(1);
    if (activeSearch) {
      fetchFeed(category, 1, false, activeSearch);
    } else {
      fetchFeed(category, 1);
    }
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    if (activeSearch) {
      fetchFeed(category, next, true, activeSearch);
    } else {
      fetchFeed(category, next, true);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setActiveSearch(q);
    setPage(1);
    fetchFeed(category, 1, false, q);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
    setPage(1);
    fetchFeed(category, 1);
  };

  const readMore = (article) => {
    // Navigate relative to current role dashboard
    const base = window.location.pathname.split('/feed')[0];
    navigate(`${base}/feed/${article.id}?cat=${category}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Education & Career Feed</h1>
          <p className="text-sm text-slate-400 mt-1">Stay updated with the latest in tech, AI, jobs and education</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button onClick={refresh} disabled={refreshing}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm
                             text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50">
            <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
            {refreshing ? 'Refreshing…' : 'Refresh Feed'}
          </button>
          <span className="text-[10px] text-slate-300">Content updates every 60 minutes</span>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search news… e.g. AI jobs, React, machine learning"
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm
                         text-slate-700 placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300
                         transition-all"
            />
          </div>
          <button type="submit" disabled={!searchQuery.trim()}
                  className="px-5 py-2.5 bg-[#1a237e] text-white text-sm rounded-xl hover:bg-[#283593]
                             transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            Search
          </button>
          {activeSearch && (
            <button type="button" onClick={clearSearch}
                    className="px-4 py-2.5 bg-white border border-slate-200 text-sm text-slate-500 rounded-xl
                               hover:bg-slate-50 transition-colors">
              ✕ Clear
            </button>
          )}
        </div>
        {activeSearch && (
          <p className="text-xs text-indigo-500 mt-2 font-medium">
            🔍 Showing results for "{activeSearch}"
          </p>
        )}
      </form>

      {/* Category Tabs */}
      <div className={`flex gap-2 overflow-x-auto pb-1 scrollbar-hide ${activeSearch ? 'opacity-40 pointer-events-none' : ''}`}>
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap
                             transition-all duration-200 border
                             ${category === c.key
                               ? 'bg-[#1a237e] text-white border-[#1a237e] shadow-md shadow-indigo-200'
                               : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <span>{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="card p-8 text-center">
          <p className="text-red-500 mb-3">{error}</p>
          <button onClick={refresh} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            🔄 Retry
          </button>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && !refreshing && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Articles grid */}
      {!loading && !error && articles.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-slate-500 font-medium">No articles found</p>
          <p className="text-sm text-slate-400 mt-1">Try another category or refresh the feed.</p>
        </div>
      )}

      {!loading && articles.length > 0 && (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map(a => (
              <FeedCard key={a.id} article={a} onReadMore={readMore} />
            ))}
          </div>

          {hasMore && (
            <div className="text-center pt-4">
              <button onClick={loadMore}
                      className="px-6 py-2.5 bg-white border border-slate-200 rounded-lg text-sm
                                 text-slate-600 hover:bg-slate-50 transition-all">
                Load More ({total - articles.length} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
