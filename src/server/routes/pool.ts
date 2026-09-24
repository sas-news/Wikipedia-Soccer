/**
 * ゴールプール内訳API（連想ペアシステムの可視化用）
 *
 *   GET /api/pool/stats                    収録規模・帯分布・ドメイン分布
 *   GET /api/pool/articles?band=&q=&limit=  記事一覧（帯別ペア数つき）
 *   GET /api/pool/pairs?a=<title>           ある記事起点のペア一覧
 */
import { Router } from 'express';
import {
  getPoolStats,
  getBandCounts,
  getDomainCounts,
  getPoolArticleList,
  getPairsForArticle,
} from '../pool';
import type { PairBand } from '../pool';

const router = Router();
const BANDS: PairBand[] = ['ideal', 'hard', 'near', 'weak'];

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
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    })
  );
});

router.get('/pool/pairs', (req, res) => {
  const a = req.query.a as string;
  if (!a) return res.status(400).json({ error: 'a required' });
  res.json({ pairs: getPairsForArticle(a, req.query.limit ? Number(req.query.limit) : undefined) });
});

export default router;
