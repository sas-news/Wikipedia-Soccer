import { useMemo } from 'react';
import { Trophy, Share2, Play, Home, ExternalLink } from 'lucide-react';
import type { SharedResult } from '../shared/result';

interface Props {
  result: SharedResult;
  shareUrl: string;
  onPlaySame: () => void;
  onExit: () => void;
  onToast: (msg: string) => void;
}

// ?r= で共有された対戦結果の閲覧画面（結果の再生・同一お題での再対戦につなぐ）
export default function SharedResult({ result, shareUrl, onPlaySame, onExit, onToast }: Props) {
  const winnerGoal = result.g[result.w - 1];
  const loserGoal = result.g[result.w === 1 ? 1 : 0];
  const moves = result.h.length - 1;
  // h[0] はスタート地点（移動ではない）で player=1 として記録されるため -1
  const p1Moves = useMemo(() => result.h.filter(e => e[1] === 1).length - 1, [result]);
  const p2Moves = result.h.length - p1Moves - 1;
  const shareText = `Wikipedia Soccer | 「${result.s}」から ${moves}手で「${winnerGoal}」に到達！`;

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
            <Trophy className="w-8 h-8 text-yellow-600" />
          </div>
          <p className="text-xs font-bold text-gray-400 tracking-widest">対戦結果</p>
          <h1 className="text-3xl font-bold text-gray-900">Player {result.w} の勝利！</h1>
          <p className="text-gray-600 font-medium">
            「{result.s}」から {moves}手で「{winnerGoal}」に到達
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="font-bold text-red-600">Player 1</p>
            <p className="text-gray-700 break-all">目標: {result.g[0]}</p>
            <p className="text-gray-500 text-xs mt-1">{p1Moves}手</p>
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="font-bold text-blue-600">Player 2</p>
            <p className="text-gray-700 break-all">目標: {result.g[1]}</p>
            <p className="text-gray-500 text-xs mt-1">{p2Moves}手</p>
          </div>
        </div>

        <div className="text-left text-sm text-gray-500 bg-gray-50 p-4 rounded-lg max-h-56 overflow-y-auto">
          <p className="font-bold mb-2 text-gray-700">移動履歴:</p>
          <div className="flex flex-wrap gap-1 leading-relaxed items-center">
            {result.h.map(([title, player], i) => (
              <span key={i} className="flex items-center gap-1">
                <a
                  href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`font-bold hover:underline ${player === 1 ? 'text-red-500' : 'text-blue-500'}`}
                >
                  {title}
                </a>
                {i < result.h.length - 1 && <span className="text-gray-400 mx-1 flex-shrink-0">→</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            惜敗側の目標: {loserGoal}
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={onPlaySame}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4" /> このお題で遊ぶ
          </button>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (navigator.share) {
                  try {
                    await navigator.share({ title: 'Wikipedia Soccer', text: shareText, url: shareUrl });
                    return;
                  } catch {
                    // キャンセル時はクリップボードへ
                  }
                }
                try {
                  await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
                  onToast('結果リンクをコピーしました');
                } catch {
                  window.prompt('以下をコピーしてください', `${shareText} ${shareUrl}`);
                }
              }}
              className="flex-1 py-2 px-4 border-2 border-sky-500 text-sky-600 font-bold rounded-xl hover:bg-sky-50 transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <Share2 className="w-4 h-4" /> 結果をシェア
            </button>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 px-4 border-2 border-gray-900 text-gray-900 font-bold rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-1.5 text-sm"
            >
              <ExternalLink className="w-4 h-4" /> Xでポスト
            </a>
          </div>
          <button
            onClick={onExit}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 underline flex items-center justify-center gap-1"
          >
            <Home className="w-3.5 h-3.5" /> トップへ戻る
          </button>
        </div>
      </div>
    </div>
  );
}
