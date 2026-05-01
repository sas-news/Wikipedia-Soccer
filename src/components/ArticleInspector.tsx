import React, { useState, useEffect } from 'react';
import { ArrowLeft, Search, BarChart3 } from 'lucide-react';

interface Article {
  title: string;
  normalized_score: number;
  backlinks: number;
  pageviews: number;
  page_size: number;
  link_count: number;
  category_depth: number;
  percentile: number;
}

interface Preset {
  id: string;
  name: string;
  scoreRange: [number, number];
}

interface Props {
  onBack: () => void;
}

export default function ArticleInspector({ onBack }: Props) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ totalArticles: number; scoreDistribution: number[] } | null>(null);

  useEffect(() => {
    fetch('/api/difficulty/presets')
      .then((r) => r.json())
      .then((d) => setPresets(d.presets || []));

    fetch('/api/difficulty/stats')
      .then((r) => r.json())
      .then((d) => setStats(d));

    loadArticles();
  }, []);

  const loadArticles = (preset?: string) => {
    setLoading(true);
    const url = preset
      ? `/api/difficulty/articles?preset=${preset}&limit=200`
      : '/api/difficulty/articles?limit=200';
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setArticles(d.articles || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const filtered = articles.filter((a) =>
    a.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={onBack}
            className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-2xl font-bold">難易度データベース内訳</h1>
        </div>

        {stats && (
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-gray-500" />
              <h2 className="font-bold text-gray-900">統計</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-gray-50 p-3 rounded-lg text-center">
                <div className="text-2xl font-bold text-gray-900">{stats.totalArticles}</div>
                <div className="text-xs text-gray-500">総記事数</div>
              </div>
              {stats.scoreDistribution.map((count, i) => (
                <div key={i} className="bg-gray-50 p-3 rounded-lg text-center">
                  <div className="text-lg font-bold text-gray-900">{count}</div>
                  <div className="text-xs text-gray-500">{i * 10}-{(i + 1) * 10}%</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="記事名で検索..."
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  setSelectedPreset(null);
                  loadArticles();
                }}
                className={`px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${
                  selectedPreset === null
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                すべて
              </button>
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPreset(p.id);
                    loadArticles(p.id);
                  }}
                  className={`px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${
                    selectedPreset === p.id
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-gray-700">記事名</th>
                  <th className="text-right px-4 py-3 font-bold text-gray-700">スコア</th>
                  <th className="text-right px-4 py-3 font-bold text-gray-700">被リンク</th>
                  <th className="text-right px-4 py-3 font-bold text-gray-700">閲覧数</th>
                  <th className="text-right px-4 py-3 font-bold text-gray-700">サイズ</th>
                  <th className="text-right px-4 py-3 font-bold text-gray-700">リンク数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((article) => (
                  <tr key={article.title} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <a
                        href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(article.title)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {article.title}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {article.normalized_score.toFixed(3)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {article.backlinks.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {article.pageviews.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {(article.page_size / 1024).toFixed(1)}KB
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {article.link_count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-500 text-sm">記事が見つかりません</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
