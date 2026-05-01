import React, { useState, useCallback } from 'react';
import { Settings, RotateCcw, Play, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { CustomDifficultyParams, ScoringWeights } from '../types/difficulty';
import { DEFAULT_WEIGHTS, DEFAULT_RANGES } from '../types/difficulty';

interface CustomDifficultyPanelProps {
  onTest?: (params: CustomDifficultyParams) => void;
  disabled?: boolean;
}

const STORAGE_KEY = 'wiki_soccer_custom_difficulty';

interface RangeValue {
  min: number;
  max: number;
}

function loadSavedParams(): {
  ranges: Record<string, RangeValue>;
  weights: ScoringWeights;
} {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved) as { ranges: Record<string, RangeValue>; weights: ScoringWeights };
    }
  } catch {
    return {
      ranges: {
        backlinks: { ...DEFAULT_RANGES.backlinks },
        pageviews: { ...DEFAULT_RANGES.pageviews },
        pageSize: { ...DEFAULT_RANGES.pageSize },
        linkDensity: { ...DEFAULT_RANGES.linkDensity },
        categoryDepth: { ...DEFAULT_RANGES.categoryDepth },
      },
      weights: { ...DEFAULT_WEIGHTS },
    };
  }
  return {
    ranges: {
      backlinks: { ...DEFAULT_RANGES.backlinks },
      pageviews: { ...DEFAULT_RANGES.pageviews },
      pageSize: { ...DEFAULT_RANGES.pageSize },
      linkDensity: { ...DEFAULT_RANGES.linkDensity },
      categoryDepth: { ...DEFAULT_RANGES.categoryDepth },
    },
    weights: { ...DEFAULT_WEIGHTS },
  };
}

function saveParams(ranges: Record<string, RangeValue>, weights: ScoringWeights) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ranges, weights }));
}

export default function CustomDifficultyPanel({ onTest, disabled = false }: CustomDifficultyPanelProps) {
  const saved = loadSavedParams();
  const [expanded, setExpanded] = useState(false);
  const [ranges, setRanges] = useState<Record<string, RangeValue>>(saved.ranges);
  const [weights, setWeights] = useState<ScoringWeights>(saved.weights);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ title: string; score: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback(() => {
    const newErrors: Record<string, string> = {};
    for (const [key, range] of Object.entries(ranges) as [string, RangeValue][]) {
      if (range.min > range.max) {
        newErrors[key] = '最小値は最大値以下である必要があります';
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [ranges]);

  const updateRange = (key: string, field: 'min' | 'max', value: number) => {
    setRanges((prev) => {
      const next = { ...prev, [key]: { ...prev[key], [field]: value } };
      saveParams(next, weights);
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const updateWeight = (key: keyof ScoringWeights, value: number) => {
    setWeights((prev) => {
      const next = { ...prev, [key]: value };
      saveParams(ranges, next);
      return next;
    });
  };

  const handleReset = () => {
    setRanges({
      backlinks: { ...DEFAULT_RANGES.backlinks },
      pageviews: { ...DEFAULT_RANGES.pageviews },
      pageSize: { ...DEFAULT_RANGES.pageSize },
      linkDensity: { ...DEFAULT_RANGES.linkDensity },
      categoryDepth: { ...DEFAULT_RANGES.categoryDepth },
    });
    setWeights({ ...DEFAULT_WEIGHTS });
    setErrors({});
    setTestResult(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleTest = async () => {
    if (!validate()) return;
    setTesting(true);
    setTestResult(null);

    const params: CustomDifficultyParams = {
      backlinksRange: ranges.backlinks,
      pageviewsRange: ranges.pageviews,
      pageSizeRange: ranges.pageSize,
      linkDensityRange: ranges.linkDensity,
      categoryDepthRange: ranges.categoryDepth,
      weights,
    };

    try {
      if (onTest) {
        onTest(params);
        return;
      }

      const res = await fetch('/api/difficulty/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (data.title) {
        setTestResult({ title: data.title, score: data.score });
      }
    } catch {
      setTestResult({ title: 'エラー', score: 0 });
    } finally {
      setTesting(false);
    }
  };

  const weightSum = (Object.values(weights) as number[]).reduce((a, b) => a + b, 0);

  const rangeFields = [
    { key: 'backlinks', label: '被リンク数', min: 0, max: 100000, step: 1 },
    { key: 'pageviews', label: 'ページビュー', min: 0, max: 50000000, step: 100 },
    { key: 'pageSize', label: 'ページサイズ（バイト）', min: 0, max: 1000000, step: 100 },
    { key: 'linkDensity', label: 'リンク密度', min: 0, max: 0.05, step: 0.0001 },
    { key: 'categoryDepth', label: 'カテゴリ深度', min: 0, max: 20, step: 1 },
  ];

  const weightFields: Array<{ key: keyof ScoringWeights; label: string }> = [
    { key: 'backlinks', label: '被リンク数' },
    { key: 'pageviews', label: 'ページビュー' },
    { key: 'pageSize', label: 'ページサイズ' },
    { key: 'linkDensity', label: 'リンク密度' },
    { key: 'categoryDepth', label: 'カテゴリ深度' },
  ];

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        disabled={disabled}
        className={`w-full flex items-center justify-between p-3 text-sm font-bold transition-colors ${
          expanded ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-gray-500" />
          <span>高度な設定</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 bg-gray-50">
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">指標の範囲</h4>
            {rangeFields.map((field) => (
              <div key={field.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-700">{field.label}</span>
                  {errors[field.key] && (
                    <span className="text-xs text-red-600">{errors[field.key]}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={ranges[field.key].min}
                    onChange={(e) => updateRange(field.key, 'min', parseFloat(e.target.value) || 0)}
                    className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-900"
                    placeholder="最小値"
                    step={field.step}
                    min={field.min}
                    max={field.max}
                  />
                  <span className="text-xs text-gray-400 self-center">〜</span>
                  <input
                    type="number"
                    value={ranges[field.key].max}
                    onChange={(e) => updateRange(field.key, 'max', parseFloat(e.target.value) || 0)}
                    className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-900"
                    placeholder="最大値"
                    step={field.step}
                    min={field.min}
                    max={field.max}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              重み付け（合計: {weightSum.toFixed(2)}）
            </h4>
            {weightFields.map((field) => (
              <div key={field.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-700">{field.label}</span>
                  <span className="text-xs text-gray-500">{(weights[field.key] as number).toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weights[field.key]}
                  onChange={(e) => updateWeight(field.key, parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={disabled}
              className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" />
              リセット
            </button>
            <button
              onClick={handleTest}
              disabled={disabled || testing || Object.keys(errors).length > 0}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-bold text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              テスト実行
            </button>
          </div>

          {testResult && (
            <div className="p-3 bg-white border border-gray-200 rounded-lg">
              <div className="text-xs text-gray-500">テスト結果</div>
              <div className="text-sm font-bold text-gray-900">{testResult.title}</div>
              <div className="text-xs text-gray-500">スコア: {testResult.score.toFixed(3)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
