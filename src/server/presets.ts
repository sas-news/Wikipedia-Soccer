import type { DifficultyPreset, ScoringWeights } from '../types/difficulty';
import { DEFAULT_WEIGHTS } from '../types/difficulty';

export const DIFFICULTY_PRESETS: DifficultyPreset[] = [
  {
    id: 'very_easy',
    name: '超初級',
    description: '非常に人気のある記事。国名、有名人物、主要都市など、誰でも到達できる話題。',
    scoreRange: [0.55, 1.00],
    starRating: 1,
  },
  {
    id: 'easy',
    name: '初級',
    description: '人気のある記事。比較的簡単に到達できる話題。',
    scoreRange: [0.40, 0.65],
    starRating: 2,
  },
  {
    id: 'medium',
    name: '中級',
    description: '一般的な知識が必要な記事。適度な難易度。',
    scoreRange: [0.25, 0.50],
    starRating: 3,
  },
  {
    id: 'hard',
    name: '上級',
    description: '専門的な知識やマイナーな話題。到達には工夫が必要。',
    scoreRange: [0.15, 0.35],
    starRating: 4,
  },
  {
    id: 'very_hard',
    name: '超上級',
    description: '非常にマイナーな記事。広い知識と戦略が必要。',
    scoreRange: [0.00, 0.20],
    starRating: 5,
  },
];

export function getPresetById(id: string): DifficultyPreset | undefined {
  return DIFFICULTY_PRESETS.find((p) => p.id === id);
}

export function getAllPresets(): DifficultyPreset[] {
  return [...DIFFICULTY_PRESETS];
}

export function getPresetScoreRange(id: string): [number, number] | undefined {
  const preset = getPresetById(id);
  return preset ? preset.scoreRange : undefined;
}

export function validatePresetId(id: string): boolean {
  return DIFFICULTY_PRESETS.some((p) => p.id === id);
}

export function getPresetWeights(id: string): ScoringWeights {
  const preset = getPresetById(id);
  return preset?.defaultWeights ?? DEFAULT_WEIGHTS;
}
