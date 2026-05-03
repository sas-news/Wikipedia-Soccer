import { randomInt } from 'node:crypto';
import type { ArticleMeta } from '../types/difficulty';

const USER_AGENT = 'WikipediaSoccerGame/1.0 (DifficultyScorer)';

function shuffleArray<T>(arr: T[]): T[] {
  const array = [...arr];
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

class SimpleCache {
  private cache = new Map<string, { value: unknown; expiry: number }>();

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, { value, expiry: Date.now() + ttlMs });
  }

  clear(): void {
    this.cache.clear();
  }
}

const apiCache = new SimpleCache();
const CACHE_TTL_SHORT = 60 * 60 * 1000;
const CACHE_TTL_LONG = 24 * 60 * 60 * 1000;
const BASE_API_URL = 'https://ja.wikipedia.org/w/api.php';
const REST_API_URL = 'https://wikimedia.org/api/rest_v1';
const XTOOLS_API_URL = 'https://xtools.wmflabs.org/api';

interface WikiApiResponse<T> {
  query?: T;
  error?: { code: string; info: string };
}

interface RandomPage {
  pageid: number;
  ns: number;
  title: string;
}

interface PageInfo {
  pageid: number;
  title: string;
  size: number;
  pageprops?: Record<string, string>;
}

interface BacklinkInfo {
  pageid: number;
  title: string;
}

function getDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3
): Promise<Response> {
  const opts: RequestInit = {
    ...options,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  };

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      if (!isJson) {
        const text = await res.text().catch(() => '');
        if (text.includes('You are manually') || text.includes('Rate limit')) {
          if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }
        }
        throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 100)}`);
      }

      if (res.status >= 500) {
        if (i < retries - 1) {
          const delay = Math.pow(2, i) * 2000 + 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      return res;
    } catch (err) {
      if (i < retries - 1) {
        const delay = Math.pow(2, i) * 2000 + 1000;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

export async function fetchRandomArticles(
  count = 1,
  options?: { noCache?: boolean }
): Promise<string[]> {
  const noCache = options?.noCache ?? false;
  const cacheKey = `random:${count}`;

  if (!noCache) {
    const cached = apiCache.get<string[]>(cacheKey);
    if (cached) return cached;
  }

  const fetchCount = noCache ? Math.max(count, 20) : count;
  const cacheBuster = noCache ? `&_cb=${Date.now()}` : '';
  const url = `${BASE_API_URL}?action=query&list=random&rnnamespace=0&rnlimit=${fetchCount}&format=json&origin=*${cacheBuster}`;

  const res = await fetchWithRetry(url);
  const data = (await res.json()) as WikiApiResponse<{ random: RandomPage[] }>;

  if (data.error) {
    throw new Error(`Wiki API error: ${data.error.code} - ${data.error.info}`);
  }

  let result = (data.query?.random || []).map((p) => p.title);

  if (noCache) {
    result = shuffleArray(result).slice(0, count);
  }

  if (!noCache) {
    apiCache.set(cacheKey, result, CACHE_TTL_SHORT);
  }
  return result;
}

export async function fetchArticleMeta(titles: string[]): Promise<Partial<ArticleMeta>[]> {
  if (titles.length === 0) return [];

  const titlesParam = titles.map((t) => encodeURIComponent(t)).join('|');
  const url = `${BASE_API_URL}?action=query&titles=${titlesParam}&prop=info|categories|links&inprop=size|url&cllimit=max&pllimit=max&format=json&origin=*`;

  const res = await fetchWithRetry(url);
  const data = (await res.json()) as WikiApiResponse<{
    pages: Record<string, PageInfo & { categories?: Array<{ title: string }>; links?: Array<{ title: string }> }>;
  }>;

  if (data.error) {
    throw new Error(`Wiki API error: ${data.error.code} - ${data.error.info}`);
  }

  const pages = data.query?.pages || {};
  const results: Partial<ArticleMeta>[] = [];

  for (const pageId of Object.keys(pages)) {
    const page = pages[pageId];
    if (!page || page.title === undefined) continue;
    if (page.pageid === undefined || page.pageid <= 0 || 'missing' in page) continue;

    const meta: Partial<ArticleMeta> = {
      title: page.title,
      pageId: page.pageid,
      pageSize: page.size || 0,
      linkCount: page.links?.length || 0,
    };

    results.push(meta);
  }

  return results;
}

export async function fetchBacklinks(title: string): Promise<number> {
  const url = `${BASE_API_URL}?action=query&list=backlinks&bltitle=${encodeURIComponent(title)}&bllimit=max&blnamespace=0&format=json&origin=*`;
  const res = await fetchWithRetry(url);
  const data = (await res.json()) as WikiApiResponse<{
    backlinks: BacklinkInfo[];
    backlinkscontinue?: string;
  }>;

  if (data.error) {
    throw new Error(`Wiki API error: ${data.error.code} - ${data.error.info}`);
  }

  let count = data.query?.backlinks?.length || 0;

  let continueToken = data.query?.backlinkscontinue;
  while (continueToken) {
    const contUrl = `${BASE_API_URL}?action=query&list=backlinks&bltitle=${encodeURIComponent(title)}&bllimit=max&blnamespace=0&blcontinue=${encodeURIComponent(continueToken)}&format=json&origin=*`;
    const contRes = await fetchWithRetry(contUrl);
    const contData = (await contRes.json()) as WikiApiResponse<{
      backlinks: BacklinkInfo[];
      backlinkscontinue?: string;
    }>;

    if (contData.error) break;
    count += contData.query?.backlinks?.length || 0;
    continueToken = contData.query?.backlinkscontinue;
  }

  return count;
}

export async function fetchPageViews(title: string, days = 30): Promise<number> {
  const end = getDateString(1);
  const start = getDateString(days);
  const encodedTitle = encodeURIComponent(title.replace(/ /g, '_'));
  const url = `${REST_API_URL}/metrics/pageviews/per-article/ja.wikipedia.org/all-access/all-agents/${encodedTitle}/daily/${start}/${end}`;
  const cacheKey = `views:${encodedTitle}:${start}:${end}`;

  const cached = apiCache.get<number>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const res = await fetchWithRetry(url, {}, 2);
    if (!res.ok) return 0;
    const data = (await res.json()) as { items?: Array<{ views: number }> };
    const result = (data.items || []).reduce((sum, item) => sum + (item.views || 0), 0);
    apiCache.set(cacheKey, result, CACHE_TTL_LONG);
    return result;
  } catch {
    return 0;
  }
}

export async function fetchXToolsStats(title: string): Promise<{
  linksIn: number;
  linksOut: number;
  prose: number;
}> {
  const encodedTitle = encodeURIComponent(title.replace(/ /g, '_'));

  try {
    const [linksRes, proseRes] = await Promise.all([
      fetchWithRetry(`${XTOOLS_API_URL}/page/links/ja.wikipedia.org/${encodedTitle}`, {}, 2),
      fetchWithRetry(`${XTOOLS_API_URL}/page/prose/ja.wikipedia.org/${encodedTitle}`, {}, 2),
    ]);

    const linksData = linksRes.ok ? ((await linksRes.json()) as { links_in?: number; links_out?: number }) : {};
    const proseData = proseRes.ok ? ((await proseRes.json()) as { prose?: { bytes?: number } }) : {};

    return {
      linksIn: linksData.links_in || 0,
      linksOut: linksData.links_out || 0,
      prose: proseData.prose?.bytes || 0,
    };
  } catch {
    return { linksIn: 0, linksOut: 0, prose: 0 };
  }
}

export async function fetchCategoryMembers(
  category: string,
  limit = 500
): Promise<string[]> {
  const url = `${BASE_API_URL}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(category)}&cmtype=page&cmlimit=${limit}&format=json&origin=*`;
  const res = await fetchWithRetry(url);
  const data = (await res.json()) as WikiApiResponse<{
    categorymembers: Array<{ title: string; ns: number }>;
  }>;

  if (data.error) {
    throw new Error(`Wiki API error: ${data.error.code} - ${data.error.info}`);
  }

  return (data.query?.categorymembers || []).map((m) => m.title);
}

export async function fetchOutgoingLinks(title: string, limit = 500): Promise<string[]> {
  const cacheKey = `links:out:${encodeURIComponent(title)}`;
  const cached = apiCache.get<string[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_API_URL}?action=query&titles=${encodeURIComponent(title)}&prop=links&plnamespace=0&pllimit=${limit}&format=json&origin=*`;
  const res = await fetchWithRetry(url);
  const data = (await res.json()) as WikiApiResponse<{
    pages: Record<string, { links?: Array<{ title: string }> }>;
  }>;

  if (data.error) {
    throw new Error(`Wiki API error: ${data.error.code} - ${data.error.info}`);
  }

  const pages = data.query?.pages || {};
  let results: string[] = [];
  for (const pageId of Object.keys(pages)) {
    const page = pages[pageId];
    if (page && page.links) {
      results = results.concat(page.links.map((l) => l.title).filter((t) => !t.includes(':')));
    }
  }

  apiCache.set(cacheKey, results, CACHE_TTL_SHORT);
  return results;
}

export async function fetchIncomingLinks(title: string, limit = 500): Promise<string[]> {
  const cacheKey = `links:in:${encodeURIComponent(title)}`;
  const cached = apiCache.get<string[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_API_URL}?action=query&titles=${encodeURIComponent(title)}&prop=linkshere&lhnamespace=0&lhlimit=${limit}&format=json&origin=*`;
  const res = await fetchWithRetry(url);
  const data = (await res.json()) as WikiApiResponse<{
    pages: Record<string, { linkshere?: Array<{ title: string }> }>;
  }>;

  if (data.error) {
    throw new Error(`Wiki API error: ${data.error.code} - ${data.error.info}`);
  }

  const pages = data.query?.pages || {};
  let results: string[] = [];
  for (const pageId of Object.keys(pages)) {
    const page = pages[pageId];
    if (page && page.linkshere) {
      results = results.concat(page.linkshere.map((l) => l.title).filter((t) => !t.includes(':')));
    }
  }

  apiCache.set(cacheKey, results, CACHE_TTL_SHORT);
  return results;
}
