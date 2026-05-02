import React, { useState, useEffect } from 'react';
import { Dices, Star, Info, Settings } from 'lucide-react';
import type { DifficultyPreset } from '../types/difficulty';

interface DifficultySelectorProps {
  selectedPreset: string | null;
  onSelect: (presetId: string | null) => void;
  disabled?: boolean;
}

export default function DifficultySelector({
  selectedPreset,
  onSelect,
  disabled = false,
}: DifficultySelectorProps) {
  const [presets, setPresets] = useState<DifficultyPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredPreset, setHoveredPreset] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/difficulty/presets')
      .then((res) => res.json())
      .then((data) => {
        setPresets(data.presets || []);
        setLoading(false);
      })
      .catch(() => {
        setError('プリセットの読み込みに失敗しました');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="h-5 w-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-red-600 py-2">{error}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <button
          onClick={() => onSelect(null)}
          disabled={disabled}
          className={`flex flex-col items-center p-3 rounded-xl border transition-all ${
            selectedPreset === null
              ? 'bg-gray-900 border-gray-900 text-white shadow-lg'
              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <Dices className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold">完全ランダム</span>
        </button>

        <button
          onClick={() => onSelect('custom')}
          disabled={disabled}
          className={`flex flex-col items-center p-3 rounded-xl border transition-all ${
            selectedPreset === 'custom'
              ? 'bg-gray-900 border-gray-900 text-white shadow-lg'
              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <Settings className="w-5 h-5 mb-1" />
          <span className="text-xs font-bold">カスタム</span>
        </button>

        {presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => onSelect(preset.id)}
            disabled={disabled}
            onMouseEnter={() => setHoveredPreset(preset.id)}
            onMouseLeave={() => setHoveredPreset(null)}
            className={`relative flex flex-col items-center p-3 rounded-xl border transition-all ${
              selectedPreset === preset.id
                ? 'bg-gray-900 border-gray-900 text-white shadow-lg'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="flex gap-0.5 mb-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`w-3 h-3 ${
                    i < preset.starRating
                      ? selectedPreset === preset.id
                        ? 'text-yellow-300 fill-yellow-300'
                        : 'text-yellow-500 fill-yellow-500'
                      : selectedPreset === preset.id
                        ? 'text-gray-500'
                        : 'text-gray-300'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs font-bold">{preset.name}</span>

            {hoveredPreset === preset.id && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-xl z-50 pointer-events-none">
                <div className="flex items-start gap-1">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{preset.description}</span>
                </div>
                <div className="mt-1 text-gray-400">
                  スコア: {preset.scoreRange[0].toFixed(2)} - {preset.scoreRange[1].toFixed(2)}
                </div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
