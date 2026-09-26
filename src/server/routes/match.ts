/**
 * 連想ペア出題API。
 *
 *   GET /api/match?difficulty=<presetId|band>&a=<title>
 *
 * - 通常: A=出題資格済み記事からランダム → B=assoc_pairs から帯条件で抽選
 * - a指定: 固定Aに対して帯条件を満たすBを抽選（カスタムゴール需要用）
 * - 応答には対称スタートページ候補も含める
 */
import { Router } from 'express';
import {
  getEligibleTitles,
  getPairsFrom,
  getPair,
  getInboundTitles,
  getPoolArticle,
  pickStartPage,
  getPoolStats,
} from '../pool';
import type { AssocPair, FameGate, PairBand } from '../pool';
import { fetchRandomArticles } from '../wiki-api';

const router = Router();

/** difficultyプリセットID → 帯 */
const BAND_MAP: Record<string, PairBand> = {
  very_easy: 'ideal',
  easy: 'ideal',
  medium: 'ideal',
  hard: 'hard',
  very_hard: 'hard',
};

/** リクエストで許容する difficulty 値（プリセット + 出題帯リテラル。weak/near/far は出題対象外） */
const VALID_DIFFICULTIES = new Set([...Object.keys(BAND_MAP), 'ideal', 'hard']);

/** 「語として難しい」系統を弾くカテゴリ（部分一致）: 元号・条約等の形式名・用語集・旧国家・スタブ・一覧 */
const HARD_WORD_CATS = [
  '元号', '条約', '法令', '法典', '用語',
  'かつて存在した', 'スタブ', '一覧', '身分制度', '廃れた職業',
];

/** difficultyプリセットID → 両端の有名度ゲート（pv優遇はlinksin取得失敗の救済）
 *  帯は関係の遠近だけを見るため、読みにくい語が混ざらないよう別軸で絞る */
const FAME_MAP: Record<string, FameGate> = {
  very_easy: { pv: 4000, li: 300, pvRescue: 12000, maxLen: 14, blockCats: HARD_WORD_CATS, blockYear: true }, // 有名語のみ（138記事/882組）
  easy: { pv: 4000, li: 300, pvRescue: 12000, maxLen: 14, blockCats: HARD_WORD_CATS, blockYear: true },
  medium: { pv: 2000, li: 200, pvRescue: 8000, blockCats: HARD_WORD_CATS, blockYear: true }, // 中堅語まで（260記事/2818組）
  hard: { pv: 0, li: 0, pvRescue: 0 },
  very_hard: { pv: 0, li: 0, pvRescue: 0 },
};

function resolveBand(difficulty?: string): PairBand[] {
  if (!difficulty) return ['ideal'];
  if (difficulty === 'ideal' || difficulty === 'hard' || difficulty === 'weak') {
    return [difficulty];
  }
  // hard要求時のみidealへフォールバック。ideal要求時にhardへ落とすと
  // 「ちょうど良い」で遠すぎペアが混ざるため落とさない
  const band = BAND_MAP[difficulty];
  return band === 'hard' ? ['hard', 'ideal'] : ['ideal'];
}

function resolveFame(difficulty?: string): FameGate | undefined {
  if (!difficulty) return undefined;
  if (difficulty === 'ideal' || difficulty === 'hard' || difficulty === 'weak') return undefined;
  const g = FAME_MAP[difficulty];
  return g && g.pv > 0 ? g : undefined;
}

function drawB(a: string, bands: PairBand[], fame?: FameGate): AssocPair | undefined {
  for (const band of bands) {
    const pairs = getPairsFrom(a, band, fame);
    if (pairs.length > 0) {
      return pairs[Math.floor(Math.random() * pairs.length)];
    }
  }
  return undefined;
}

function symmetricStart(a: string, b: string): string | undefined {
  // 両ゴールへの停車場（どちらかのゴールに直リンクするページ）とゴール自体は除外
  const exclude = new Set<string>([a, b]);
  for (const t of getInboundTitles(a)) exclude.add(t);
  for (const t of getInboundTitles(b)) exclude.add(t);
  return pickStartPage([...exclude]);
}

router.get('/match', async (req, res) => {
  try {
    const difficulty = req.query.difficulty as string | undefined;
    const fixedA = req.query.a as string | undefined;
    if (difficulty !== undefined && !VALID_DIFFICULTIES.has(difficulty)) {
      return res.status(400).json({
        error: `unknown difficulty: "${difficulty}"`,
        valid: [...VALID_DIFFICULTIES],
      });
    }
    const bands = resolveBand(difficulty);
    const fame = resolveFame(difficulty);

    const stats = getPoolStats();
    if (stats.eligible === 0 || stats.pairs === 0) {
      const fallback = await fetchRandomArticles(3);
      return res.json({
        a: fallback[0],
        b: fallback[1] ?? fallback[0],
        start: fallback[2] ?? fallback[0],
        fallback: true,
        difficulty: difficulty ?? 'ideal',
        band: 'random',
        message:
          '連想プールが未構築です。`npx tsx src/server/pool-collect.ts` → `npx tsx src/server/assoc.ts` を実行してください。',
      });
    }

    let a: string | undefined;
    if (fixedA) {
      const art = getPoolArticle(fixedA);
      if (!art?.eligible) {
        return res.status(404).json({
          error: `"${fixedA}" は出題プールに未収録（または資格外）です`,
          hint: '収録記事のみゴールにできます',
        });
      }
      a = fixedA;
    }

    // A未定: 帯に合うBを持つAを抽選（最大30回試行）
    let pair: AssocPair | undefined;
    if (!a) {
      const elig = getEligibleTitles(fame);
      for (let i = 0; i < 30 && elig.length > 0; i++) {
        const cand = elig[Math.floor(Math.random() * elig.length)];
        const p = drawB(cand, bands, fame);
        if (p) {
          a = cand;
          pair = p;
          break;
        }
      }
    } else {
      // 固定Aはユーザー指定のためA側フロアなし。Bには難易度のフロアを適用
      pair = drawB(a, bands, fame);
    }

    if (!a || !pair) {
      return res.status(404).json({
        error: '条件を満たすペアが見つかりませんでした',
        difficulty,
        hint: '難易度を変えるか、プールを拡大してください',
      });
    }

    res.json({
      a: pair.a,
      b: pair.b,
      band: pair.band,
      difficulty: difficulty ?? 'ideal',
      start: symmetricStart(pair.a, pair.b),
      stats: {
        bend: [pair.bendAb, pair.bendBa],
        duel: pair.duel,
        paths3: [pair.paths3Ab, pair.paths3Ba],
        domRel: pair.domRel,
        direct: pair.direct,
      },
    });
  } catch (e) {
    console.error('[match] error:', e);
    res.status(500).json({ error: 'match failed' });
  }
});

router.get('/pair', (req, res) => {
  const a = req.query.a as string;
  const b = req.query.b as string;
  if (!a || !b) return res.status(400).json({ error: 'a and b required' });
  const p = getPair(a, b) ?? getPair(b, a);
  if (!p) return res.status(404).json({ error: 'pair not in assoc table' });
  res.json(p);
});

export default router;
