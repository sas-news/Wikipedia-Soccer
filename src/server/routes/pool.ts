/**
 * ゴールプール内訳API（連想ペアシステムの可視化用）
 *
 *   GET /api/pool/stats                    収録規模・帯分布・ドメイン分布
 *   GET /api/pool/articles?band=&q=&eligible=&limit=  記事一覧（帯別ペア数つき）
 *   GET /api/pool/pairs?a=<title>           ある記事起点のペア一覧
 *   GET /api/pool/pairs?band=<band>         帯別のペア一覧
 */
import { Router } from 'express';
import {
  getPoolStats,
  getBandCounts,
  getDomainCounts,
  getPoolArticleList,
  getPairsForArticle,
  getPairsByBand,
} from '../pool';
import type { PairBand } from '../pool';

const router = Router();
const BANDS: PairBand[] = ['ideal', 'hard', 'near', 'weak'];

/** クエリを安全な整数に変換（非数・NaN・負数は undefined に倒す） */
function toInt(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

router.get('/pool/stats', (_req, res) => {
  const s = getPoolStats();
  res.json({ ...s, byBand: getBandCounts(), byDomain: getDomainCounts() });
});

router.get('/pool/articles', (req, res) => {
  const band = req.query.band as string | undefined;
  res.json(
    getPoolArticleList({
      band: BANDS.includes(band as PairBand) ? (band as PairBand) : undefined,
      q: req.query.q as string | undefined,
      eligibleOnly: req.query.eligible === '1',
      limit: toInt(req.query.limit),
      offset: toInt(req.query.offset),
    })
  );
});

router.get('/pool/pairs', (req, res) => {
  const a = req.query.a as string | undefined;
  const band = req.query.band as string | undefined;
  const limit = toInt(req.query.limit);
  if (a) return res.json({ pairs: getPairsForArticle(a, limit) });
  if (band && BANDS.includes(band as PairBand)) {
    return res.json({ pairs: getPairsByBand(band as PairBand, limit) });
  }
  res.status(400).json({ error: 'a or band required' });
});

export default router;
