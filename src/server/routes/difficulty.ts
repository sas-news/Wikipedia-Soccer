import { Router } from 'express';
import { getAllPresets, getPresetById, validatePresetId } from '../presets';
import {
  getArticleByScoreRange,
  getArticleCount,
  getScoreDistribution,
  getLastUpdated,
  isDatabaseSeeded,
  getAllArticles,
  getArticlesByPreset,
} from '../db';
import { fetchRandomArticles } from '../wiki-api';
import type { RandomArticleResponse, CustomDifficultyParams } from '../../types/difficulty';

const router = Router();

router.get('/difficulty/presets', (_req, res) => {
  res.json({ presets: getAllPresets() });
});

router.get('/difficulty/stats', (_req, res) => {
  res.json({
    totalArticles: getArticleCount(),
    scoreDistribution: getScoreDistribution(),
    lastUpdated: new Date(getLastUpdated()).toISOString(),
    seeded: isDatabaseSeeded(),
  });
});

router.get('/difficulty/articles', (req, res) => {
  const preset = req.query.preset as string | undefined;
  const sortBy = (req.query.sortBy as 'normalized_score' | 'backlinks' | 'pageviews') || 'normalized_score';
  const order = (req.query.order as 'asc' | 'desc') || 'desc';
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
  const offset = parseInt(req.query.offset as string, 10) || 0;

  if (preset && validatePresetId(preset)) {
    const p = getPresetById(preset);
    if (p) {
      const articles = getArticlesByPreset(p.scoreRange[0], p.scoreRange[1], limit);
      res.json({ articles, preset: p.id, scoreRange: p.scoreRange });
      return;
    }
  }

  const articles = getAllArticles(sortBy, order, limit, offset);
  res.json({ articles, limit, offset });
});

router.post('/difficulty/custom', async (req, res) => {
  try {
    const params = req.body as CustomDifficultyParams;

    if (!params || Object.keys(params).length === 0) {
      res.status(400).json({ error: 'Custom parameters are required' });
      return;
    }

    const minScore = 0;
    const maxScore = 1;
    const articles = getArticleByScoreRange(minScore, maxScore, 50);

    if (articles.length === 0) {
      const fallback = await fetchRandomArticles(1);
      const response: RandomArticleResponse = {
        title: fallback[0],
        fallback: true,
        message: '難易度データベースが空のため、完全ランダムな記事を返しています。',
      };
      res.json(response);
      return;
    }

    const article = articles[Math.floor(Math.random() * articles.length)];
    res.json({
      title: article.title,
      params,
      score: article.normalizedScore,
    });
  } catch (e) {
    console.error('Custom difficulty error:', e);
    res.status(500).json({ error: 'Failed to fetch custom difficulty article' });
  }
});

export async function handleRandomWithDifficulty(
  difficultyParam: string | undefined
): Promise<RandomArticleResponse> {
  if (!difficultyParam) {
    const fallback = await fetchRandomArticles(1);
    return { title: fallback[0] };
  }

  if (!validatePresetId(difficultyParam)) {
    const fallback = await fetchRandomArticles(1);
    return {
      title: fallback[0],
      fallback: true,
      message: `不明な難易度プリセット「${difficultyParam}」です。完全ランダムな記事を返しています。`,
    };
  }

  const preset = getPresetById(difficultyParam);
  if (!preset) {
    const fallback = await fetchRandomArticles(1);
    return { title: fallback[0], fallback: true };
  }

  if (!isDatabaseSeeded()) {
    const fallback = await fetchRandomArticles(1);
    return {
      title: fallback[0],
      difficulty: difficultyParam,
      fallback: true,
      message: '難易度データベースが未初期化です。完全ランダムな記事を返しています。',
    };
  }

  const [minScore, maxScore] = preset.scoreRange;
  const articles = getArticleByScoreRange(minScore, maxScore, 10);

  if (articles.length === 0) {
    const fallback = await fetchRandomArticles(1);
    return {
      title: fallback[0],
      difficulty: difficultyParam,
      fallback: true,
      message: `「${preset.name}」の難易度範囲に該当する記事が見つかりませんでした。完全ランダムな記事を返しています。`,
    };
  }

  const article = articles[Math.floor(Math.random() * articles.length)];
  return {
    title: article.title,
    difficulty: difficultyParam,
  };
}

export default router;
