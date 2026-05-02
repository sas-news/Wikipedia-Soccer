import { initDatabase, getArticleCount, upsertArticle, isDatabaseSeeded } from './db';
import { collectArticles } from './batch-collect';
import { fetchArticleMeta, fetchBacklinks, fetchPageViews, fetchXToolsStats } from './wiki-api';
import { calculateRawScore, updatePercentiles } from './scoring';
import type { ArticleMeta, ArticleRecord } from '../types/difficulty';

const SEED_COUNT_GENERAL = 80;
const SEED_COUNT_POPULAR = 10;
const SEED_COUNT_PER_CATEGORY = 3;
const MAJOR_CATEGORIES = ['科学', '歴史', '地理'];

const EASY_ARTICLES = [
  '日本', 'アメリカ合衆国', '中国', 'イギリス', 'ドイツ',
  'フランス', 'イタリア', 'オーストラリア', 'カナダ', 'ロシア',
  '東京', '大阪', '京都', '名古屋', '札幌',
  '野球', 'サッカー', 'バスケットボール', 'テニス', 'オリンピック',
  '織田信長', '徳川家康', '豊臣秀吉', '坂本龍馬', '聖徳太子',
  '地球', '太陽', '月', '宇宙', '太平洋',
];

export async function seedDatabase(): Promise<void> {
  initDatabase();

  if (isDatabaseSeeded()) {
    console.log(`[DifficultyDB] Already seeded with ${getArticleCount()} articles. Skipping.`);
    return;
  }

  if (process.env.SKIP_DIFFICULTY_SEED === '1') {
    console.log('[DifficultyDB] SKIP_DIFFICULTY_SEED=1. Skipping seed.');
    return;
  }

  console.log('[DifficultyDB] Starting initial seed...');

  let totalCollected = 0;

  try {
    console.log(`[DifficultyDB] Collecting ${EASY_ARTICLES.length} easy articles...`);
    const easyMetas: ArticleMeta[] = [];
    for (const title of EASY_ARTICLES) {
      try {
        await new Promise((r) => setTimeout(r, 2500));
        const metaList = await fetchArticleMeta([title]);
        const meta = metaList[0];
        if (!meta || !meta.title) continue;
        const backlinks = await fetchBacklinks(title).catch(() => 0);
        const pageviews = await fetchPageViews(title, 30).catch(() => 0);
        const xtools = await fetchXToolsStats(title).catch(() => ({ linksIn: 0, linksOut: 0, prose: 0 }));

        const pageId = meta.pageId || 0;
        const pageSize = meta.pageSize || 0;
        const linkCount = meta.linkCount || xtools.linksOut || 0;

        if (pageId <= 0 || pageSize <= 0 || backlinks <= 0) {
          console.warn(
            `[DifficultyDB] Skipping invalid easy article "${title}": pageId=${pageId}, pageSize=${pageSize}, backlinks=${backlinks}`
          );
          continue;
        }

        easyMetas.push({
          title: meta.title,
          pageId,
          backlinks: backlinks || 0,
          pageviews: pageviews || 0,
          pageSize,
          linkCount,
          categoryDepth: 0,
          lastUpdated: Date.now(),
        });
      } catch (e) {
        console.error(`[DifficultyDB] Failed to collect easy article "${title}":`, e);
      }
    }
    const easyScores = easyMetas.map((m) => calculateRawScore(m));
    const easyPercentiles = updatePercentiles(easyScores);
    for (let i = 0; i < easyMetas.length; i++) {
      const record: ArticleRecord = {
        ...easyMetas[i],
        normalizedScore: easyPercentiles[i].normalizedScore,
        percentile: easyPercentiles[i].percentile,
        factorsJson: JSON.stringify(easyPercentiles[i].factors),
      };
      upsertArticle(record);
      totalCollected++;
    }
    console.log(`[DifficultyDB] Easy articles: ${easyMetas.length} seeded`);
  } catch (e) {
    console.error('[DifficultyDB] Failed to seed easy articles:', e);
  }

  try {
    console.log(`[DifficultyDB] Collecting ${SEED_COUNT_GENERAL} general articles...`);
    const generalResult = await collectArticles({ count: SEED_COUNT_GENERAL, mode: 'general' });
    totalCollected += generalResult.collected;
    console.log(`[DifficultyDB] General articles: ${generalResult.collected} collected, ${generalResult.failed} failed`);
  } catch (e) {
    console.error('[DifficultyDB] Failed to collect general articles:', e);
  }

  try {
    console.log(`[DifficultyDB] Collecting ${SEED_COUNT_POPULAR} popular articles...`);
    const popularResult = await collectArticles({ count: SEED_COUNT_POPULAR, mode: 'popular' });
    totalCollected += popularResult.collected;
    console.log(`[DifficultyDB] Popular articles: ${popularResult.collected} collected, ${popularResult.failed} failed`);
  } catch (e) {
    console.error('[DifficultyDB] Failed to collect popular articles:', e);
  }

  for (const category of MAJOR_CATEGORIES) {
    try {
      console.log(`[DifficultyDB] Collecting ${SEED_COUNT_PER_CATEGORY} articles from category "${category}"...`);
      const catResult = await collectArticles({
        count: SEED_COUNT_PER_CATEGORY,
        mode: 'category',
        category,
      });
      totalCollected += catResult.collected;
      console.log(`[DifficultyDB] Category "${category}": ${catResult.collected} collected, ${catResult.failed} failed`);
    } catch (e) {
      console.error(`[DifficultyDB] Failed to collect category "${category}":`, e);
    }
  }

  console.log(`[DifficultyDB] Seed complete. Total collected: ${totalCollected}. DB now has ${getArticleCount()} articles.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[DifficultyDB] Seed failed:', e);
      process.exit(1);
    });
}
