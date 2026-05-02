import {
  fetchRandomArticles,
  fetchArticleMeta,
  fetchBacklinks,
  fetchPageViews,
  fetchXToolsStats,
} from './wiki-api';
import { calculateRawScore, updatePercentiles } from './scoring';
import { upsertArticle, getArticleCount, articleExists } from './db';
import { GENERAL_TOPICS } from './general-topics';
import type { ArticleMeta, ArticleRecord } from '../types/difficulty';

interface CollectOptions {
  count?: number;
  mode?: 'random' | 'popular' | 'category' | 'general';
  category?: string;
  dryRun?: boolean;
}

export async function collectArticles(options: CollectOptions = {}): Promise<{
  collected: number;
  failed: number;
  skipped: number;
  articles: ArticleRecord[];
}> {
  const { count = 100, mode = 'random', dryRun = false } = options;

  let titles: string[] = [];

  if (mode === 'random') {
    titles = await fetchRandomArticles(Math.min(count, 500));
  } else if (mode === 'popular') {
    titles = await fetchPopularArticles(Math.min(count, 100));
  } else if (mode === 'category' && options.category) {
    titles = await fetchCategoryArticles(options.category, Math.min(count, 500));
  } else if (mode === 'general') {
    const shuffled = [...GENERAL_TOPICS].sort(() => Math.random() - 0.5);
    titles = shuffled;
  }

  const metas: ArticleMeta[] = [];
  let failed = 0;
  let skipped = 0;
  let processedCount = 0;

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];

    if (!dryRun && articleExists(title)) {
      skipped++;
      continue;
    }

    try {
      await new Promise((r) => setTimeout(r, 2000));
      const meta = await collectArticleMeta(title);
      if (!meta) {
        failed++;
        continue;
      }
      metas.push(meta);

      processedCount++;
      if (processedCount % 10 === 0) {
        console.log(`Collected metadata ${processedCount} (target: ${count})...`);
      }

      if (metas.length >= count) break;
    } catch (err) {
      console.error(`Failed to collect "${title}":`, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  async function tryCollectExtra(extraTitles: string[]) {
    for (const title of extraTitles) {
      if (metas.some((m) => m.title === title)) continue;
      if (!dryRun && articleExists(title)) {
        skipped++;
        continue;
      }

      try {
        await new Promise((r) => setTimeout(r, 2000));
        const meta = await collectArticleMeta(title);
        if (!meta) {
          failed++;
          continue;
        }
        metas.push(meta);
        processedCount++;
        if (metas.length >= count) break;
      } catch (err) {
        console.error(`Failed to collect "${title}":`, err instanceof Error ? err.message : String(err));
        failed++;
      }
    }
  }

  if (mode === 'random' && metas.length < count) {
    const maxExtraAttempts = 5;
    for (let attempt = 0; attempt < maxExtraAttempts && metas.length < count; attempt++) {
      const extraNeeded = count - metas.length;
      console.log(`Need ${extraNeeded} more new articles. Fetching extra random batch ${attempt + 1}/${maxExtraAttempts}...`);
      const extraTitles = await fetchRandomArticles(Math.min(extraNeeded * 2, 100));
      await tryCollectExtra(extraTitles);
    }
  }

  if (mode === 'general' && metas.length < count) {
    const remaining = titles.filter((t) => !metas.some((m) => m.title === t));
    console.log(`Need ${count - metas.length} more new articles. Using remaining ${remaining.length} general topics...`);
    await tryCollectExtra(remaining);
  }

  if ((mode === 'popular' || mode === 'category') && metas.length < count) {
    const extraNeeded = count - metas.length;
    console.log(`Need ${extraNeeded} more new articles. Switching to random mode for extras...`);
    const extraTitles = await fetchRandomArticles(Math.min(extraNeeded * 2, 100));
    await tryCollectExtra(extraTitles);
  }

  const rawScores = metas.map((m) => calculateRawScore(m));
  const scoredWithPercentiles = updatePercentiles(rawScores);

  const results: ArticleRecord[] = metas.map((meta, idx) => ({
    ...meta,
    normalizedScore: scoredWithPercentiles[idx].normalizedScore,
    percentile: scoredWithPercentiles[idx].percentile,
    factorsJson: JSON.stringify(scoredWithPercentiles[idx].factors),
  }));

  if (!dryRun) {
    for (const record of results) {
      upsertArticle(record);
    }
  }

  return { collected: results.length, failed, skipped, articles: results };
}

async function collectArticleMeta(title: string): Promise<ArticleMeta | null> {
  const metaList = await fetchArticleMeta([title]);
  const meta = metaList[0];
  if (!meta || !meta.title) return null;

  const backlinks = await fetchBacklinks(title).catch(() => 0);
  const pageviews = await fetchPageViews(title, 30).catch(() => 0);
  const xtools = await fetchXToolsStats(title).catch(() => ({ linksIn: 0, linksOut: 0, prose: 0 }));

  const pageId = meta.pageId || 0;
  const pageSize = meta.pageSize || 0;
  const linkCount = meta.linkCount || xtools.linksOut || 0;

  if (pageId <= 0 || backlinks <= 0) {
    console.warn(
      `[Collect] Skipping invalid article "${title}": pageId=${pageId}, backlinks=${backlinks}`
    );
    return null;
  }

  return {
    title: meta.title,
    pageId,
    backlinks: backlinks || 0,
    pageviews: pageviews || 0,
    pageSize,
    linkCount,
    categoryDepth: 0,
    lastUpdated: Date.now(),
  };
}

async function fetchPopularArticles(count: number): Promise<string[]> {
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/ja.wikipedia/all-access/2025/04/all-days`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WikipediaSoccerGame/1.0 (Collector)' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ articles?: Array<{ article: string; views: number }> }>;
    };
    const articles = data.items?.[0]?.articles || [];
    return articles
      .filter((a) => !a.article.includes(':'))
      .slice(0, count)
      .map((a) => decodeURIComponent(a.article.replace(/_/g, ' ')));
  } catch {
    return [];
  }
}

async function fetchCategoryArticles(category: string, count: number): Promise<string[]> {
  const { fetchCategoryMembers } = await import('./wiki-api');
  return fetchCategoryMembers(`Category:${category}`, count);
}

function isMainModule(): boolean {
  const mainPath = process.argv[1];
  if (!mainPath) return false;
  return mainPath.replace(/\\/g, '/').toLowerCase().includes('batch-collect');
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  const countIndex = args.indexOf('--count');
  const count = countIndex >= 0 ? parseInt(args[countIndex + 1], 10) || 100 : 100;
  const modeIndex = args.indexOf('--mode');
  const mode = (modeIndex >= 0 ? args[modeIndex + 1] : 'random') as 'random' | 'popular' | 'category' | 'general';
  const dryRun = args.includes('--dry-run');
  const categoryIndex = args.indexOf('--category');
  const category = categoryIndex >= 0 ? args[categoryIndex + 1] : undefined;

  console.log(`Starting collection: mode=${mode}, count=${count}, dryRun=${dryRun}`);

  const startCount = getArticleCount();
  collectArticles({ count, mode, dryRun, category })
    .then((result) => {
      const endCount = getArticleCount();
      console.log(`\nCollection complete:`);
      console.log(`  New articles: ${result.collected}`);
      console.log(`  Failed: ${result.failed}`);
      console.log(`  Skipped (already exists): ${result.skipped}`);
      console.log(`  DB before: ${startCount}, after: ${endCount} (+${endCount - startCount})`);

      if (result.articles.length > 0) {
        console.log('\nTop 10 by score:');
        const sorted = [...result.articles].sort((a, b) => b.normalizedScore - a.normalizedScore);
        sorted.slice(0, 10).forEach((a) => {
          console.log(`  ${a.normalizedScore.toFixed(3)} - ${a.title} (bl=${a.backlinks}, pv=${a.pageviews})`);
        });
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Collection failed:', err);
      process.exit(1);
    });
}
