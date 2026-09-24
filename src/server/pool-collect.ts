/**
 * ゴール候補プールの収集スクリプト。
 *
 *   npx tsx src/server/pool-collect.ts [--fresh] [--limit N] [--concurrency N]
 *
 * 手順:
 *   1. POOL_CATEGORIES の categorymembers で候補タイトルを層別サンプル
 *   2. pageprops(dab) + info(length) をバッチ取得し、スタブ・曖昧さ回避・日付/一覧・名前空間を除外
 *   3. 記事ごとに parse(links|categories) + REST pageviews + linksto 検索を取得してDB書込み
 *   4. プール内被リンク数を集計し、出題資格(eligible)を確定
 */
import { getDb } from './db';
import {
  initPoolSchema,
  upsertPoolArticle,
  isPoolArticleEnriched,
  insertLinks,
  insertCats,
  finalizePoolDegrees,
  getPoolStats,
} from './pool';
import { POOL_CATEGORIES, domainsFromCats } from './domains';

const API = 'https://ja.wikipedia.org/w/api.php';
const REST_PV =
  'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ja.wikipedia.org/all-access/all-agents';
const UA = {
  'User-Agent':
    'WikipediaSoccerBot/0.2 (https://github.com/sas-news/Wikipedia-Soccer; pool collection)',
};

const NOISE_RE =
  /^(\d+年|\d+年代|\d+月|\d+月\d+日|\d+世紀|紀元前|.+年 \(.+\))|(一覧|リスト|年表)/;
const MIN_PAGE_LEN = 3000;
const DEFAULT_CONCURRENCY = 8;

// ---------- helpers ----------

async function fetchJson(url: string, retries = 5): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiUrl(params: Record<string, string | number>): string {
  const p = new URLSearchParams({ format: 'json' });
  for (const [k, v] of Object.entries(params)) p.set(k, String(v));
  return `${API}?${p.toString()}`;
}

// ---------- 1. discovery ----------

async function discoverTitles(): Promise<Map<string, Set<string>>> {
  const title2cats = new Map<string, Set<string>>();
  const catList = [...POOL_CATEGORIES];
  let done = 0;

  await Promise.all(
    new Array(Math.min(DEFAULT_CONCURRENCY, catList.length))
      .fill(0)
      .map(async function worker() {
        while (catList.length) {
          const cat = catList.shift()!;
          let cmcontinue: string | undefined;
          for (let page = 0; page < 4; page++) {
            const params: Record<string, string | number> = {
              action: 'query',
              list: 'categorymembers',
              cmtitle: `Category:${cat}`,
              cmtype: 'page',
              cmlimit: 500,
            };
            if (cmcontinue) params.cmcontinue = cmcontinue;
            try {
              const d = await fetchJson(apiUrl(params));
              for (const m of d.query?.categorymembers ?? []) {
                if (m.title.includes(':')) continue;
                let s = title2cats.get(m.title);
                if (!s) title2cats.set(m.title, (s = new Set()));
                s.add(cat);
              }
              cmcontinue = d.continue?.cmcontinue;
            } catch (e) {
              console.warn(`  [discover] ${cat} failed: ${e}`);
              break;
            }
            if (!cmcontinue) break;
          }
          if (++done % 10 === 0)
            console.log(`  discovered ${done}/${POOL_CATEGORIES.length} cats, ${title2cats.size} titles`);
        }
      })
  );
  return title2cats;
}

// ---------- 2. filter ----------

interface FilteredTitle {
  title: string;
  sourceCats: Set<string>;
}

async function filterTitles(
  title2cats: Map<string, Set<string>>
): Promise<FilteredTitle[]> {
  const out: FilteredTitle[] = [];
  const titles = [...title2cats.keys()];
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50).filter((t) => !NOISE_RE.test(t) && !t.includes(':'));
    if (!chunk.length) continue;
    const d = await fetchJson(
      apiUrl({
        action: 'query',
        titles: chunk.join('|'),
        prop: 'info|pageprops',
        ppprop: 'disambiguation',
        redirects: '1',
      })
    );
    const resolvedFrom = new Map<string, string>();
    for (const n of d.query?.normalized ?? []) resolvedFrom.set(n.to, n.from);
    for (const r of d.query?.redirects ?? []) resolvedFrom.set(r.to, r.from);
    for (const p of Object.values(d.query?.pages ?? {}) as any[]) {
      const t = p.title as string;
      if (p.missing !== undefined) continue;
      if (p.pageprops?.disambiguation !== undefined) continue;
      if ((p.length ?? 0) < MIN_PAGE_LEN) continue;
      const orig = resolvedFrom.get(t) ?? t;
      out.push({ title: t, sourceCats: title2cats.get(orig) ?? title2cats.get(t) ?? new Set() });
    }
  }
  return out;
}

// ---------- 3. enrich ----------

function last30dRange(): { start: string; end: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const end = new Date(Date.now() - 86400000);
  const start = new Date(end.getTime() - 29 * 86400000);
  return { start: fmt(start), end: fmt(end) };
}

async function enrichOne(t: string): Promise<{
  links: string[];
  cats: string[];
  pv: number;
  linksin: number;
} | null> {
  try {
    const d = await fetchJson(
      apiUrl({
        action: 'parse',
        page: t,
        prop: 'links|categories',
        redirects: '1',
      })
    );
    const p = d.parse;
    if (!p) return null;
    const links = [...new Set(
      (p.links ?? []).filter((l: any) => l.ns === 0).map((l: any) => l['*'] as string)
    )] as string[];
    const cats = [...new Set(
      (p.categories ?? []).map((c: any) => c['*'] as string)
    )] as string[];

    let pv = 0;
    try {
      const { start, end } = last30dRange();
      const enc = encodeURIComponent(t.replace(/ /g, '_'));
      const d2 = await fetchJson(`${REST_PV}/${enc}/daily/${start}/${end}`, 2);
      pv = (d2.items ?? []).reduce((s: number, i: any) => s + (i.views ?? 0), 0);
    } catch {
      /* pv stays 0 */
    }

    let linksin = 0;
    try {
      const d3 = await fetchJson(
        apiUrl({
          action: 'query',
          list: 'search',
          srsearch: `linksto:"${t}"`,
          srlimit: 0,
          srnamespace: 0,
        }),
        2
      );
      linksin = d3.query?.searchinfo?.totalhits ?? 0;
    } catch {
      /* linksin stays 0 */
    }

    return { links, cats, pv, linksin };
  } catch {
    return null;
  }
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  const fresh = args.includes('--fresh');
  const limitIdx = args.indexOf('--limit');
  const concIdx = args.indexOf('--concurrency');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Number(process.env.POOL_LIMIT) || 0;
  const concurrency = concIdx >= 0 ? Number(args[concIdx + 1]) : DEFAULT_CONCURRENCY;

  initPoolSchema();
  const db = getDb();
  if (fresh) {
    console.log('[pool] --fresh: dropping pool tables');
    db.exec('DELETE FROM pool_links; DELETE FROM pool_cats; DELETE FROM assoc_pairs; DELETE FROM pool_articles;');
  }

  console.log('[pool] discovery: fetching category members...');
  const t2c = await discoverTitles();
  console.log(`[pool] discovery: ${t2c.size} raw titles`);

  console.log('[pool] filtering (dab/stub/date/list)...');
  let filtered = await filterTitles(t2c);
  console.log(`[pool] filtered: ${filtered.length} titles`);
  if (limit > 0) filtered = filtered.slice(0, limit);

  const todo = filtered.filter((f) => !isPoolArticleEnriched(f.title));
  console.log(`[pool] enrich: ${todo.length} to fetch (${filtered.length - todo.length} cached)`);

  let idx = 0;
  let okCount = 0;
  let failCount = 0;
  const t0 = Date.now();
  await Promise.all(
    new Array(concurrency).fill(0).map(async function worker() {
      while (idx < todo.length) {
        const item = todo[idx++];
        const meta = await enrichOne(item.title);
        if (!meta) {
          failCount++;
          continue;
        }
        const domains = domainsFromCats(new Set([...item.sourceCats, ...meta.cats]));
        upsertPoolArticle({
          title: item.title,
          pageviews: meta.pv,
          linksin: meta.linksin,
          domains: [...domains],
        });
        insertLinks(item.title, meta.links);
        insertCats(item.title, meta.cats);
        okCount++;
        if (okCount % 100 === 0) {
          const sec = (Date.now() - t0) / 1000;
          console.log(
            `  enriched ${okCount}/${todo.length} (${sec.toFixed(0)}s, fail=${failCount})`
          );
        }
      }
    })
  );

  console.log('[pool] finalizing degrees & eligibility...');
  finalizePoolDegrees();
  const stats = getPoolStats();
  console.log(
    `[pool] done: ${stats.articles} articles (${stats.eligible} eligible), ${stats.links} links, failed=${failCount}`
  );
}

main().catch((e) => {
  console.error('[pool] fatal:', e);
  process.exit(1);
});
