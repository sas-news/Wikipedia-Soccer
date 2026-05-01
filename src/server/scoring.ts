import type {
  ArticleMeta,
  DifficultyScore,
  ScoringWeights,
  CustomDifficultyParams,
} from '../types/difficulty';
import { DEFAULT_WEIGHTS, DEFAULT_RANGES } from '../types/difficulty';

export function normalizeValue(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  const clamped = Math.max(min, Math.min(max, value));
  return (clamped - min) / (max - min);
}

export function normalizeLogValue(value: number, min: number, max: number): number {
  if (value <= 0) return 0;
  const logValue = Math.log(value + 1);
  const logMin = Math.log(min + 1);
  const logMax = Math.log(max + 1);
  return normalizeValue(logValue, logMin, logMax);
}

export function calculateRawScore(
  meta: ArticleMeta,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): DifficultyScore {
  const backlinksNorm = normalizeLogValue(
    meta.backlinks,
    DEFAULT_RANGES.backlinks.min,
    DEFAULT_RANGES.backlinks.max
  );

  const pageviewsNorm = normalizeLogValue(
    meta.pageviews,
    DEFAULT_RANGES.pageviews.min,
    DEFAULT_RANGES.pageviews.max
  );

  const pageSizeNorm = normalizeValue(
    meta.pageSize,
    DEFAULT_RANGES.pageSize.min,
    DEFAULT_RANGES.pageSize.max
  );

  const linkDensity = meta.pageSize > 0 ? meta.linkCount / meta.pageSize : 0;
  const linkDensityNorm = normalizeValue(
    linkDensity,
    DEFAULT_RANGES.linkDensity.min,
    DEFAULT_RANGES.linkDensity.max
  );

  const categoryDepthNorm = 1 - normalizeValue(
    meta.categoryDepth,
    DEFAULT_RANGES.categoryDepth.min,
    DEFAULT_RANGES.categoryDepth.max
  );

  const factors = {
    backlinks: backlinksNorm,
    pageviews: pageviewsNorm,
    pageSize: pageSizeNorm,
    linkDensity: linkDensityNorm,
    categoryDepth: categoryDepthNorm,
  };

  const rawScore =
    weights.backlinks * factors.backlinks +
    weights.pageviews * factors.pageviews +
    weights.pageSize * factors.pageSize +
    weights.linkDensity * factors.linkDensity +
    weights.categoryDepth * factors.categoryDepth;

  const normalizedScore = Math.max(0, Math.min(1, rawScore));

  return {
    rawScore,
    normalizedScore,
    percentile: 0,
    factors,
  };
}

export function calculateCustomScore(
  meta: ArticleMeta,
  params: CustomDifficultyParams
): DifficultyScore {
  const weights: ScoringWeights = {
    ...DEFAULT_WEIGHTS,
    ...params.weights,
  };

  const ranges = {
    backlinks: params.backlinksRange ?? DEFAULT_RANGES.backlinks,
    pageviews: params.pageviewsRange ?? DEFAULT_RANGES.pageviews,
    pageSize: params.pageSizeRange ?? DEFAULT_RANGES.pageSize,
    linkDensity: params.linkDensityRange ?? DEFAULT_RANGES.linkDensity,
    categoryDepth: params.categoryDepthRange ?? DEFAULT_RANGES.categoryDepth,
  };

  const backlinksNorm = normalizeLogValue(
    meta.backlinks,
    ranges.backlinks.min,
    ranges.backlinks.max
  );

  const pageviewsNorm = normalizeLogValue(
    meta.pageviews,
    ranges.pageviews.min,
    ranges.pageviews.max
  );

  const pageSizeNorm = normalizeValue(
    meta.pageSize,
    ranges.pageSize.min,
    ranges.pageSize.max
  );

  const linkDensity = meta.pageSize > 0 ? meta.linkCount / meta.pageSize : 0;
  const linkDensityNorm = normalizeValue(
    linkDensity,
    ranges.linkDensity.min,
    ranges.linkDensity.max
  );

  const categoryDepthNorm = 1 - normalizeValue(
    meta.categoryDepth,
    ranges.categoryDepth.min,
    ranges.categoryDepth.max
  );

  const factors = {
    backlinks: backlinksNorm,
    pageviews: pageviewsNorm,
    pageSize: pageSizeNorm,
    linkDensity: linkDensityNorm,
    categoryDepth: categoryDepthNorm,
  };

  const rawScore =
    weights.backlinks * factors.backlinks +
    weights.pageviews * factors.pageviews +
    weights.pageSize * factors.pageSize +
    weights.linkDensity * factors.linkDensity +
    weights.categoryDepth * factors.categoryDepth;

  const normalizedScore = Math.max(0, Math.min(1, rawScore));

  return {
    rawScore,
    normalizedScore,
    percentile: 0,
    factors,
  };
}

export function updatePercentiles(
  scores: DifficultyScore[]
): DifficultyScore[] {
  const sorted = [...scores].sort((a, b) => a.normalizedScore - b.normalizedScore);
  const total = sorted.length;

  return scores.map((score) => {
    const rank = sorted.filter((s) => s.normalizedScore < score.normalizedScore).length;
    const percentile = total > 1 ? rank / (total - 1) : 0.5;
    return { ...score, percentile };
  });
}

export function isWithinCustomRange(
  meta: ArticleMeta,
  params: CustomDifficultyParams
): boolean {
  if (params.backlinksRange) {
    if (meta.backlinks < params.backlinksRange.min || meta.backlinks > params.backlinksRange.max) {
      return false;
    }
  }
  if (params.pageviewsRange) {
    if (meta.pageviews < params.pageviewsRange.min || meta.pageviews > params.pageviewsRange.max) {
      return false;
    }
  }
  if (params.pageSizeRange) {
    if (meta.pageSize < params.pageSizeRange.min || meta.pageSize > params.pageSizeRange.max) {
      return false;
    }
  }
  if (params.linkDensityRange) {
    const density = meta.pageSize > 0 ? meta.linkCount / meta.pageSize : 0;
    if (density < params.linkDensityRange.min || density > params.linkDensityRange.max) {
      return false;
    }
  }
  if (params.categoryDepthRange) {
    if (meta.categoryDepth < params.categoryDepthRange.min || meta.categoryDepth > params.categoryDepthRange.max) {
      return false;
    }
  }
  return true;
}
