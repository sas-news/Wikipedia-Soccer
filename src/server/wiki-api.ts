import { randomInt } from 'node:crypto';

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
const BASE_API_URL = 'https://ja.wikipedia.org/w/api.php';

interface WikiApiResponse<T> {
  query?: T;
  error?: { code: string; info: string };
}

interface RandomPage {
  pageid: number;
  ns: number;
  title: string;
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
