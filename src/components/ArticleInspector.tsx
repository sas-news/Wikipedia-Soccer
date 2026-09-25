import React, { useState, useEffect, useRef } from 'react';
import { Search, BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import BackButton from './BackButton';

const BAND_LABELS: Record<string, string> = {
  ideal: 'ちょうど良い',
  hard: '難しい',
  near: '近すぎ',
  weak: '関連薄め',
};
const BAND_ORDER = ['ideal', 'hard', 'near', 'weak'];
const BAND_DESC: Record<string, string> = {
  ideal: 'ゲームで出題される帯（連想距離がちょうど良い組み合わせ）',
  hard: 'ゲームの「難しい」で出題される帯（遠いが届く）',
  near: '近すぎて出題されない組み合わせ',
  weak: '関連が薄すぎて出題されない組み合わせ',
};

interface PoolStats {
  articles: number;
  eligible: number;
  links: number;
  pairs: number;
  byBand: Record<string, number>;
  byDomain: Record<string, number>;
}

interface PoolArticle {
  title: string;
  eligible: boolean;
  inPool: number;
  outCount: number;
  pageviews: number;
  linksin: number;
  domains: string[];
  pairCount: number;
}

interface AssocPair {
  a: string;
  b: string;
  bendAb: number;
  bendBa: number;
  duel: number;
  paths3Ab: number;
  paths3Ba: number;
  domRel: string;
  direct: boolean;
  band: string;
}

interface Props {
  onBack: () => void;
}

const BAND_BADGE: Record<string, string> = {
  ideal: 'bg-emerald-100 text-emerald-800',
  hard: 'bg-orange-100 text-orange-800',
  near: 'bg-rose-100 text-rose-800',
  weak: 'bg-slate-100 text-slate-600',
};

export default function ArticleInspector({ onBack }: Props) {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [tab, setTab] = useState<'articles' | 'pairs'>('articles');

  // 記事タブ
  const [articles, setArticles] = useState<PoolArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pairs, setPairs] = useState<AssocPair[]>([]);
  const [pairsLoading, setPairsLoading] = useState(false);

  // ペアタブ
  const [pairBand, setPairBand] = useState<string>('ideal');
  const [bandPairs, setBandPairs] = useState<AssocPair[]>([]);
  const [bandLoading, setBandLoading] = useState(false);

  useEffect(() => {
    fetch('/api/pool/stats')
      .then((r) => r.json())
      .then((d) => setStats(d));
  }, []);

  useEffect(() => {
    if (tab !== 'articles') return;
    setLoading(true);
    const params = new URLSearchParams({ limit: '300' });
    if (eligibleOnly) params.set('eligible', '1');
    if (search.trim()) params.set('q', search.trim());
    fetch(`/api/pool/articles?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setArticles(d.articles || []);
        setTotal(d.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tab, eligibleOnly, search]);

  useEffect(() => {
    if (tab !== 'pairs') return;
    setBandLoading(true);
    fetch(`/api/pool/pairs?band=${pairBand}&limit=60`)
      .then((r) => r.json())
      .then((d) => {
        setBandPairs(d.pairs || []);
        setBandLoading(false);
      })
      .catch(() => setBandLoading(false));
  }, [tab, pairBand]);

  const expandedRef = useRef<string | null>(null);

  const toggleExpand = (title: string) => {
    if (expanded === title) {
      expandedRef.current = null;
      setExpanded(null);
      return;
    }
    expandedRef.current = title;
    setExpanded(title);
    setPairs([]);
    setPairsLoading(true);
    fetch(`/api/pool/pairs?a=${encodeURIComponent(title)}&limit=20`)
      .then((r) => r.json())
      .then((d) => {
        if (expandedRef.current !== title) return;
        setPairs(d.pairs || []);
        setPairsLoading(false);
      })
      .catch(() => {
        if (expandedRef.current === title) setPairsLoading(false);
      });
  };

  const tabBtn = (t: 'articles' | 'pairs', label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${
        tab === t ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <BackButton onClick={onBack} />
          <h1 className="text-2xl font-bold">ゴールプール内訳</h1>
        </div>

        {stats && (
          <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-gray-500" />
              <h2 className="font-bold text-gray-900">収集状況</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 p-3 rounded-lg text-center">
                <div className="text-2xl font-bold text-gray-900">{stats.articles.toLocaleString()}</div>
                <div className="text-xs text-gray-500">収録記事</div>
              </div>
              <div className="bg-emerald-50 p-3 rounded-lg text-center">
                <div className="text-2xl font-bold text-emerald-700">{stats.eligible.toLocaleString()}</div>
                <div className="text-xs text-gray-500">出題資格あり</div>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg text-center">
                <div className="text-2xl font-bold text-gray-900">{stats.links.toLocaleString()}</div>
                <div className="text-xs text-gray-500">プール内リンク</div>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg text-center">
                <div className="text-2xl font-bold text-gray-900">{stats.pairs.toLocaleString()}</div>
                <div className="text-xs text-gray-500">連想ペア総数</div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {BAND_ORDER.map((band) => (
                <button
                  key={band}
                  onClick={() => { setPairBand(band); setTab('pairs'); }}
                  className="bg-gray-50 hover:bg-gray-100 p-3 rounded-lg text-center transition-colors"
                  title={`${BAND_LABELS[band]}のペアを見る`}
                >
                  <div className="text-lg font-bold text-gray-900">
                    {(stats.byBand[band] ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">{BAND_LABELS[band]}</div>
                </button>
              ))}
            </div>
            {Object.keys(stats.byDomain).length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {Object.entries(stats.byDomain)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .map(([d, c]) => (
                    <span key={d} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full">
                      {d}: {c}
                    </span>
                  ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 mb-4">
          {tabBtn('articles', '収録記事')}
          {tabBtn('pairs', '出題ペア（帯別）')}
        </div>

        {tab === 'articles' && (
          <>
            <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 mb-6">
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
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
                <label className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={eligibleOnly}
                    onChange={(e) => setEligibleOnly(e.target.checked)}
                    className="w-4 h-4 accent-gray-900"
                  />
                  出題される記事のみ
                </label>
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
                      <th className="text-center px-4 py-3 font-bold text-gray-700">出題</th>
                      <th className="text-right px-4 py-3 font-bold text-gray-700">ペア数</th>
                      <th className="text-right px-4 py-3 font-bold text-gray-700">被リンク</th>
                      <th className="text-right px-4 py-3 font-bold text-gray-700">30日PV</th>
                      <th className="text-left px-4 py-3 font-bold text-gray-700">ドメイン</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {articles.map((article) => (
                      <React.Fragment key={article.title}>
                        <tr
                          className="hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => toggleExpand(article.title)}
                        >
                          <td className="px-4 py-3 font-medium text-gray-900">
                            <span className="inline-flex items-center gap-1">
                              {expanded === article.title ? (
                                <ChevronDown className="w-3 h-3 text-gray-400" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-gray-400" />
                              )}
                              {article.title}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {article.eligible ? (
                              <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                                可
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-700">
                            {article.pairCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-700">
                            {article.linksin.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-700">
                            {article.pageviews.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            {article.domains.join('・') || '—'}
                          </td>
                        </tr>
                        {expanded === article.title && (
                          <tr>
                            <td colSpan={6} className="px-4 py-3 bg-slate-50">
                              {pairsLoading ? (
                                <div className="text-xs text-gray-500">ペア読み込み中...</div>
                              ) : pairs.length === 0 ? (
                                <div className="text-xs text-gray-500">連想ペアなし</div>
                              ) : (
                                <div className="space-y-1">
                                  {pairs.map((p) => (
                                    <div key={p.b} className="flex items-center gap-2 text-xs">
                                      <span
                                        className={`px-2 py-0.5 rounded-full font-bold ${BAND_BADGE[p.band] ?? ''}`}
                                      >
                                        {BAND_LABELS[p.band] ?? p.band}
                                      </span>
                                      <a
                                        href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(p.b)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-medium text-gray-800 hover:underline"
                                      >
                                        {p.b}
                                      </a>
                                      <span className="text-gray-400">
                                        bend {p.bendAb}/{p.bendBa}・duel {p.duel}・3手 {p.paths3Ab}/{p.paths3Ba}・{p.domRel}
                                        {p.direct ? '・直結' : ''}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {articles.length === 0 && (
                  <div className="text-center py-12 text-gray-500 text-sm">記事が見つかりません</div>
                )}
                {articles.length > 0 && (
                  <div className="text-center py-2 text-xs text-gray-400 border-t border-gray-100">
                    全{total.toLocaleString()}件中 {articles.length}件表示（行を押すとペア詳細）
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'pairs' && (
          <>
            <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 mb-6">
              <div className="flex gap-2 flex-wrap mb-2">
                {BAND_ORDER.map((band) => (
                  <button
                    key={band}
                    onClick={() => setPairBand(band)}
                    className={`px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${
                      pairBand === band
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {BAND_LABELS[band]}
                    {stats && <span className="ml-1 font-normal">({(stats.byBand[band] ?? 0).toLocaleString()})</span>}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">{BAND_DESC[pairBand]}</p>
            </div>

            {bandLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-bold text-gray-700">ペア</th>
                      <th className="text-right px-4 py-3 font-bold text-gray-700" title="両方向の踏み台記事数">中継ぎ</th>
                      <th className="text-right px-4 py-3 font-bold text-gray-700" title="共通リンク先の数">共通リンク</th>
                      <th className="text-left px-4 py-3 font-bold text-gray-700">ドメイン</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bandPairs.map((p) => (
                      <tr key={`${p.a}×${p.b}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <a href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(p.a)}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{p.a}</a>
                          <span className="text-gray-400 mx-1.5">×</span>
                          <a href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(p.b)}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{p.b}</a>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-700">
                          {p.bendAb}/{p.bendBa}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-700">{p.duel}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{p.domRel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bandPairs.length === 0 && (
                  <div className="text-center py-12 text-gray-500 text-sm">この帯のペアはありません</div>
                )}
                {bandPairs.length > 0 && (
                  <div className="text-center py-2 text-xs text-gray-400 border-t border-gray-100">
                    関連度の高い順に上位{bandPairs.length}件を表示
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
