/**
 * 連想ペア出題システムのDB層。
 * 旧 difficulty スコア体系とは別テーブル群（pool_* / assoc_pairs）で管理する。
 *
 * - pool_articles: プール収録記事（有名度・プール内被リンク数・ドメイン・出題資格）
 * - pool_links:    記事間の発リンク（集合演算の元データ）
 * - pool_cats:     記事のカテゴリ集合（ドメイン推論用）
 * - assoc_pairs:   全ペア連想メトリクスの前計算結果（帯分類済み）
 */
import { getDb } from './db';
import type { DomainRel } from './domains';

export type PairBand = 'ideal' | 'hard' | 'weak' | 'near';

export interface PoolArticle {
  title: string;
  pageviews: number;
  linksin: number;
  inPool: number;
  outCount: number;
  domains: string[];
  eligible: boolean;
}

export interface AssocPair {
  a: string;
  b: string;
  bendAb: number;
  bendBa: number;
  duel: number;
  paths3Ab: number;
  paths3Ba: number;
  domRel: DomainRel;
  direct: boolean;
  band: PairBand;
}

export function initPoolSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS pool_articles (
      title TEXT PRIMARY KEY,
      pageviews INTEGER NOT NULL DEFAULT 0,
      linksin INTEGER NOT NULL DEFAULT 0,
      in_pool INTEGER NOT NULL DEFAULT 0,
      out_count INTEGER NOT NULL DEFAULT 0,
      domains TEXT NOT NULL DEFAULT '[]',
      eligible INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pool_links (
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      PRIMARY KEY (src, dst)
    );
    CREATE INDEX IF NOT EXISTS idx_pool_links_dst ON pool_links(dst);

    CREATE TABLE IF NOT EXISTS pool_cats (
      title TEXT NOT NULL,
      cat TEXT NOT NULL,
      PRIMARY KEY (title, cat)
    );
    CREATE INDEX IF NOT EXISTS idx_pool_cats_cat ON pool_cats(cat);

    CREATE TABLE IF NOT EXISTS assoc_pairs (
      a TEXT NOT NULL,
      b TEXT NOT NULL,
      bend_ab INTEGER NOT NULL,
      bend_ba INTEGER NOT NULL,
      duel INTEGER NOT NULL,
      paths3_ab INTEGER NOT NULL,
      paths3_ba INTEGER NOT NULL,
      dom_rel TEXT NOT NULL,
      direct INTEGER NOT NULL,
      band TEXT NOT NULL,
      PRIMARY KEY (a, b)
    );
    CREATE INDEX IF NOT EXISTS idx_assoc_a_band ON assoc_pairs(a, band);
    CREATE INDEX IF NOT EXISTS idx_assoc_b_band ON assoc_pairs(b, band);
  `);
}

// ---------- pool_articles ----------

export function upsertPoolArticle(a: {
  title: string;
  pageviews?: number;
  linksin?: number;
  domains?: string[];
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO pool_articles (title, pageviews, linksin, domains, updated_at)
    VALUES (@title, @pageviews, @linksin, @domains, @updatedAt)
    ON CONFLICT(title) DO UPDATE SET
      pageviews = excluded.pageviews,
      linksin = excluded.linksin,
      domains = excluded.domains,
      updated_at = excluded.updated_at
  `).run({
    title: a.title,
    pageviews: a.pageviews ?? 0,
    linksin: a.linksin ?? 0,
    domains: JSON.stringify(a.domains ?? []),
    updatedAt: Date.now(),
  });
}

export function isPoolArticleEnriched(title: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT updated_at FROM pool_articles WHERE title = ?')
    .get(title) as { updated_at: number } | undefined;
  return !!row && row.updated_at > 0;
}

export function getPoolArticle(title: string): PoolArticle | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM pool_articles WHERE title = ?')
    .get(title) as any;
  if (!row) return undefined;
  return {
    title: row.title,
    pageviews: row.pageviews,
    linksin: row.linksin,
    inPool: row.in_pool,
    outCount: row.out_count,
    domains: JSON.parse(row.domains),
    eligible: !!row.eligible,
  };
}

// ---------- pool_links / pool_cats ----------

export function insertLinks(src: string, dsts: string[]): void {
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO pool_links (src, dst) VALUES (?, ?)');
  const tx = db.transaction((items: string[]) => {
    for (const d of items) stmt.run(src, d);
  });
  tx(dsts);
}

export function insertCats(title: string, cats: string[]): void {
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO pool_cats (title, cat) VALUES (?, ?)');
  const tx = db.transaction((items: string[]) => {
    for (const c of items) stmt.run(title, c);
  });
  tx(cats);
}

/** 全リンクをメモリ上のOUT/INマップとしてロード（assoc計算用） */
export function loadLinkMaps(): {
  out: Map<string, Set<string>>;
  inMap: Map<string, Set<string>>;
} {
  const db = getDb();
  const out = new Map<string, Set<string>>();
  const inMap = new Map<string, Set<string>>();
  const rows = db.prepare('SELECT src, dst FROM pool_links').all() as Array<{
    src: string;
    dst: string;
  }>;
  for (const { src, dst } of rows) {
    let o = out.get(src);
    if (!o) out.set(src, (o = new Set()));
    o.add(dst);
    let i = inMap.get(dst);
    if (!i) inMap.set(dst, (i = new Set()));
    i.add(src);
  }
  return { out, inMap };
}

/** プール内被リンク数・発リンク数を更新し、出題資格を確定する */
export function finalizePoolDegrees(): void {
  const db = getDb();
  db.exec(`
    UPDATE pool_articles SET
      in_pool = (SELECT COUNT(*) FROM pool_links WHERE dst = pool_articles.title AND src IN (SELECT title FROM pool_articles)),
      out_count = (SELECT COUNT(*) FROM pool_links WHERE src = pool_articles.title)
  `);
  // 出題資格: プール内被リンク>=3 かつ (pv>=200 または linksin>=50)
  db.exec(`
    UPDATE pool_articles SET eligible = CASE
      WHEN in_pool >= 3 AND (pageviews >= 200 OR linksin >= 50) THEN 1 ELSE 0 END
  `);
}

export function getEligibleTitles(): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT title FROM pool_articles WHERE eligible = 1')
    .all() as Array<{ title: string }>;
  return rows.map((r) => r.title);
}

export function getPoolStats(): {
  articles: number;
  eligible: number;
  links: number;
  pairs: number;
} {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    articles: one('SELECT COUNT(*) c FROM pool_articles'),
    eligible: one('SELECT COUNT(*) c FROM pool_articles WHERE eligible=1'),
    links: one('SELECT COUNT(*) c FROM pool_links'),
    pairs: one('SELECT COUNT(*) c FROM assoc_pairs'),
  };
}

// ---------- assoc_pairs ----------

export function insertAssocPair(p: AssocPair): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO assoc_pairs
      (a, b, bend_ab, bend_ba, duel, paths3_ab, paths3_ba, dom_rel, direct, band)
    VALUES (@a, @b, @bendAb, @bendBa, @duel, @paths3Ab, @paths3Ba, @domRel, @direct, @band)
  `).run({
    ...p,
    direct: p.direct ? 1 : 0,
  });
}

export function insertAssocPairsBulk(pairs: AssocPair[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO assoc_pairs
      (a, b, bend_ab, bend_ba, duel, paths3_ab, paths3_ba, dom_rel, direct, band)
    VALUES (@a, @b, @bendAb, @bendBa, @duel, @paths3Ab, @paths3Ba, @domRel, @direct, @band)
  `);
  const tx = db.transaction((items: AssocPair[]) => {
    for (const p of items) {
      stmt.run({ ...p, direct: p.direct ? 1 : 0 });
    }
  });
  tx(pairs);
}

export function clearAssocPairs(): void {
  getDb().exec('DELETE FROM assoc_pairs');
}

/** A起点で指定帯のペアを全件取得 */
export function getPairsFrom(a: string, band: PairBand): AssocPair[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM assoc_pairs WHERE a = ? AND band = ?')
    .all(a, band) as any[];
  return rows.map(rowToPair);
}

/** ペア (a,b) の単一取得（任意方向） */
export function getPair(a: string, b: string): AssocPair | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM assoc_pairs WHERE a = ? AND b = ?')
    .get(a, b) as any;
  return row ? rowToPair(row) : undefined;
}

function rowToPair(row: any): AssocPair {
  return {
    a: row.a,
    b: row.b,
    bendAb: row.bend_ab,
    bendBa: row.bend_ba,
    duel: row.duel,
    paths3Ab: row.paths3_ab,
    paths3Ba: row.paths3_ba,
    domRel: row.dom_rel,
    direct: !!row.direct,
    band: row.band,
  };
}

/** ある記事にリンクしているプール内記事（停車場集合） */
export function getInboundTitles(title: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT src FROM pool_links WHERE dst = ? AND src IN (SELECT title FROM pool_articles)`
    )
    .all(title) as Array<{ src: string }>;
  return rows.map((r) => r.src);
}

/** スタートページ候補: 出題資格あり・両ゴール・双方の停車場を除く */
export function pickStartPage(exclude: string[]): string | undefined {
  const db = getDb();
  const placeholders = exclude.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT title FROM pool_articles
       WHERE eligible = 1 AND title NOT IN (${placeholders})
       ORDER BY RANDOM() LIMIT 1`
    )
    .get(...exclude) as { title: string } | undefined;
  return row?.title;
}
