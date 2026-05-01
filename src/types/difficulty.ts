/**
 * Wikipedia記事のメタデータ
 * 難易度スコア計算に使用される各種指標
 */
export interface ArticleMeta {
  /** 記事タイトル（日本語） */
  title: string;
  /** WikipediaページID */
  pageId: number;
  /** 被リンク数（他の記事からのリンク数） */
  backlinks: number;
  /** 直近30日のページビュー合計 */
  pageviews: number;
  /** ページサイズ（バイト） */
  pageSize: number;
  /** ページ内のリンク数 */
  linkCount: number;
  /** 主要カテゴリからの深度（0=最上位） */
  categoryDepth: number;
  /** 最終更新日時（Unix timestamp） */
  lastUpdated: number;
}

/**
 * 難易度スコアの計算結果
 */
export interface DifficultyScore {
  /** 生スコア（加重和、理論上は制限なし） */
  rawScore: number;
  /** 正規化スコア（0-1範囲） */
  normalizedScore: number;
  /** 既存記事群中的パーセンタイル（0-1） */
  percentile: number;
  /** 各因子の寄与度 */
  factors: {
    backlinks: number;
    pageviews: number;
    pageSize: number;
    linkDensity: number;
    categoryDepth: number;
  };
}

/**
 * 難易度プリセット定義
 */
export interface DifficultyPreset {
  /** プリセットID（URLパラメータ等に使用） */
  id: string;
  /** 表示名（日本語） */
  name: string;
  /** 説明文 */
  description: string;
  /** 難易度スコア範囲 [min, max]（0-1） */
  scoreRange: [number, number];
  /** 推定難易度を示す星の数（1-5） */
  starRating: number;
  /** このプリセット用のデフォルト重み（未指定時はグローバルデフォルト） */
  defaultWeights?: ScoringWeights;
}

/**
 * スコアリング用の重み設定
 * 各因子の重要度（0-1）
 */
export interface ScoringWeights {
  /** 被リンク数の重み */
  backlinks: number;
  /** ページビューの重み */
  pageviews: number;
  /** ページサイズの重み */
  pageSize: number;
  /** リンク密度の重み */
  linkDensity: number;
  /** カテゴリ深度の重み */
  categoryDepth: number;
}

/**
 * カスタム難易度設定パラメータ
 * 各指標の閾値と重みを詳細に指定
 */
export interface CustomDifficultyParams {
  /** 被リンク数の範囲 */
  backlinksRange?: { min: number; max: number };
  /** ページビューの範囲 */
  pageviewsRange?: { min: number; max: number };
  /** ページサイズの範囲（バイト） */
  pageSizeRange?: { min: number; max: number };
  /** リンク密度の範囲 */
  linkDensityRange?: { min: number; max: number };
  /** カテゴリ深度の範囲 */
  categoryDepthRange?: { min: number; max: number };
  /** 各因子の重み（未指定時はデフォルト） */
  weights?: Partial<ScoringWeights>;
}

/**
 * DBに保存される記事レコード
 */
export interface ArticleRecord extends ArticleMeta {
  /** 正規化された難易度スコア */
  normalizedScore: number;
  /** パーセンタイル */
  percentile: number;
  /** スコア計算時の生データ（JSON文字列） */
  factorsJson?: string;
}

/**
 * /api/random レスポンス（難易度指定時）
 */
export interface RandomArticleResponse {
  title: string;
  /** 使用された難易度プリセットID */
  difficulty?: string;
  /** フォールバックが発生したか */
  fallback?: boolean;
  /** フォールバック理由や情報メッセージ */
  message?: string;
}

/**
 * /api/difficulty/presets レスポンス
 */
export interface PresetsResponse {
  presets: DifficultyPreset[];
}

/**
 * /api/difficulty/custom レスポンス
 */
export interface CustomDifficultyResponse {
  title: string;
  params: CustomDifficultyParams;
  score: DifficultyScore;
}

/**
 * /api/difficulty/stats レスポンス
 */
export interface DifficultyStatsResponse {
  totalArticles: number;
  scoreDistribution: number[];
  lastUpdated: string;
}

/**
 * ゲーム設定に含まれる難易度設定（セーブデータ用）
 */
export interface GameDifficultySettings {
  /** 目標1の難易度モード */
  p1DifficultyMode: 'preset' | 'custom' | 'none';
  /** 目標2の難易度モード */
  p2DifficultyMode: 'preset' | 'custom' | 'none';
  /** 目標1のプリセットID */
  p1DifficultyPreset: string;
  /** 目標2のプリセットID */
  p2DifficultyPreset: string;
  /** 目標1のカスタムパラメータ */
  p1CustomParams?: CustomDifficultyParams;
  /** 目標2のカスタムパラメータ */
  p2CustomParams?: CustomDifficultyParams;
}

/**
 * 値をmin-maxの範囲で正規化する関数の型
 */
export type NormalizeFunction = (value: number, min: number, max: number) => number;

/**
 * デフォルトのスコアリング重み
 * backlinks 30%, pageviews 30%, linkDensity 20%, categoryDepth 15%, pageSize 5%
 */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  backlinks: 0.30,
  pageviews: 0.30,
  pageSize: 0.05,
  linkDensity: 0.20,
  categoryDepth: 0.15,
};

/**
 * 各指標の正規化用デフォルト範囲
 */
export const DEFAULT_RANGES = {
  backlinks: { min: 0, max: 10000 },
  pageviews: { min: 0, max: 500000 },
  pageSize: { min: 500, max: 500000 },
  linkDensity: { min: 0.0001, max: 0.01 },
  categoryDepth: { min: 0, max: 10 },
};

/**
 * カテゴリ深度の計算に使用する主要カテゴリ（日本語Wikipedia）
 */
export const MAJOR_CATEGORIES = [
  '科学',
  '歴史',
  '地理',
  '人物',
  '文化',
  'スポーツ',
  '技術',
  '社会',
];
