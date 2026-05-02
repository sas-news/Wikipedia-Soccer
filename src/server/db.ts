import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { ArticleRecord } from '../types/difficulty';

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'difficulty.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initSchema() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      page_id INTEGER,
      backlinks INTEGER NOT NULL DEFAULT 0,
      pageviews REAL NOT NULL DEFAULT 0,
      page_size INTEGER NOT NULL DEFAULT 0,
      link_count INTEGER NOT NULL DEFAULT 0,
      category_depth INTEGER NOT NULL DEFAULT 0,
      normalized_score REAL NOT NULL DEFAULT 0,
      percentile REAL NOT NULL DEFAULT 0,
      factors_json TEXT,
      last_updated INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scoring_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL,
      calculated_at INTEGER NOT NULL,
      factors TEXT,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(normalized_score);
    CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(last_updated);
  `);
}

export function initDatabase(): void {
  initSchema();
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function upsertArticle(article: ArticleRecord): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO articles (
      id, title, page_id, backlinks, pageviews, page_size,
      link_count, category_depth, normalized_score, percentile,
      factors_json, last_updated
    ) VALUES (
      @id, @title, @pageId, @backlinks, @pageviews, @pageSize,
      @linkCount, @categoryDepth, @normalizedScore, @percentile,
      @factorsJson, @lastUpdated
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      page_id = excluded.page_id,
      backlinks = excluded.backlinks,
      pageviews = excluded.pageviews,
      page_size = excluded.page_size,
      link_count = excluded.link_count,
      category_depth = excluded.category_depth,
      normalized_score = excluded.normalized_score,
      percentile = excluded.percentile,
      factors_json = excluded.factors_json,
      last_updated = excluded.last_updated
  `);

  stmt.run({
    id: article.title,
    title: article.title,
    pageId: article.pageId,
    backlinks: article.backlinks,
    pageviews: article.pageviews,
    pageSize: article.pageSize,
    linkCount: article.linkCount,
    categoryDepth: article.categoryDepth,
    normalizedScore: article.normalizedScore,
    percentile: article.percentile,
    factorsJson: article.factorsJson ?? null,
    lastUpdated: article.lastUpdated,
  });
}

export function getArticleByScoreRange(
  minScore: number,
  maxScore: number,
  limit = 1
): ArticleRecord[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM articles
    WHERE normalized_score BETWEEN @minScore AND @maxScore
    ORDER BY RANDOM()
    LIMIT @limit
  `);
  return stmt.all({ minScore, maxScore, limit }) as ArticleRecord[];
}

export function getArticleCount(): number {
  const database = getDb();
  const result = database.prepare('SELECT COUNT(*) as count FROM articles').get() as {
    count: number;
  };
  return result.count;
}

export function getScoreDistribution(buckets = 10): number[] {
  const database = getDb();
  const distribution: number[] = new Array(buckets).fill(0);
  const rows = database
    .prepare(
      `
      SELECT CAST(normalized_score * ${buckets} AS INTEGER) as bucket, COUNT(*) as count
      FROM articles
      GROUP BY bucket
    `
    )
    .all() as Array<{ bucket: number; count: number }>;

  for (const row of rows) {
    const idx = Math.min(row.bucket, buckets - 1);
    distribution[idx] = row.count;
  }
  return distribution;
}

export function getLastUpdated(): number {
  const database = getDb();
  const result = database
    .prepare('SELECT MAX(last_updated) as max FROM articles')
    .get() as { max: number | null };
  return result.max ?? 0;
}

export function getAllArticles(
  sortBy: 'normalized_score' | 'backlinks' | 'pageviews' = 'normalized_score',
  order: 'asc' | 'desc' = 'desc',
  limit = 100,
  offset = 0
): ArticleRecord[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM articles
    ORDER BY ${sortBy} ${order.toUpperCase()}
    LIMIT @limit OFFSET @offset
  `);
  return stmt.all({ limit, offset }) as ArticleRecord[];
}

export function getArticlesByPreset(
  minScore: number,
  maxScore: number,
  limit = 100
): ArticleRecord[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM articles
    WHERE normalized_score BETWEEN @minScore AND @maxScore
    ORDER BY normalized_score DESC
    LIMIT @limit
  `);
  return stmt.all({ minScore, maxScore, limit }) as ArticleRecord[];
}

export function isDatabaseSeeded(): boolean {
  return getArticleCount() > 0;
}

export function removeInvalidArticles(): number {
  const database = getDb();
  const result = database
    .prepare("DELETE FROM articles WHERE backlinks <= 0 OR page_id <= 0 OR page_size <= 0")
    .run();
  return result.changes;
}
