import type { ReactNode } from 'react';
import { X, Target, Repeat, Globe, Lightbulb, Trophy, Github } from 'lucide-react';

const SectionTitle = ({ icon: Icon, children }: { icon: typeof Trophy; children: ReactNode }) => (
  <h3 className="font-bold text-gray-900 text-base flex items-center gap-1.5">
    <Icon className="w-4 h-4 text-amber-600" /> {children}
  </h3>
);

const LINKS = [
  { href: 'https://x.com/sas_shinbun', label: 'X: @sas_shinbun', glyph: '𝕏' },
  { href: 'https://sasnews.dev', label: 'HP: sasnews.dev', glyph: 'globe' },
  { href: 'https://github.com/sas-news/Wikipedia-Soccer', label: 'GitHub: sas-news/Wikipedia-Soccer', glyph: 'github' },
];

export const CreatorLinks = () => (
  <div className="flex justify-center gap-3">
    {LINKS.map(l => (
      <a
        key={l.href}
        href={l.href}
        target="_blank"
        rel="noopener noreferrer"
        title={l.label}
        aria-label={l.label}
        className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition-colors"
      >
        {l.glyph === 'globe' ? (
          <Globe className="w-4 h-4" />
        ) : l.glyph === 'github' ? (
          <Github className="w-4 h-4" />
        ) : (
          <span className="text-sm font-black">𝕏</span>
        )}
      </a>
    ))}
  </div>
);

const Diagram = () => (
  <svg viewBox="0 0 440 190" className="w-full" role="img" aria-label="ゲームの流れ図">
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill="#9ca3af" />
      </marker>
    </defs>

    <rect x="20" y="70" width="110" height="50" rx="10" fill="#111827" />
    <text x="75" y="92" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700">スタート</text>
    <text x="75" y="108" textAnchor="middle" fill="#d1d5db" fontSize="10">同じページから</text>

    <path d="M132,82 C170,55 190,45 218,42" fill="none" stroke="#9ca3af" strokeWidth="2" markerEnd="url(#arr)" />
    <path d="M132,108 C170,135 190,145 218,148" fill="none" stroke="#9ca3af" strokeWidth="2" markerEnd="url(#arr)" />

    <rect x="222" y="18" width="200" height="48" rx="10" fill="#fef2f2" stroke="#fca5a5" />
    <text x="322" y="40" textAnchor="middle" fill="#b91c1c" fontSize="12" fontWeight="700">Player 1 のゴール</text>
    <text x="322" y="56" textAnchor="middle" fill="#ef4444" fontSize="10">例: 大相撲</text>

    <rect x="222" y="124" width="200" height="48" rx="10" fill="#eff6ff" stroke="#93c5fd" />
    <text x="322" y="146" textAnchor="middle" fill="#1d4ed8" fontSize="12" fontWeight="700">Player 2 のゴール</text>
    <text x="322" y="162" textAnchor="middle" fill="#3b82f6" fontSize="10">例: 歌舞伎</text>

    <text x="176" y="34" textAnchor="middle" fill="#6b7280" fontSize="10">リンクを辿る</text>
    <text x="176" y="168" textAnchor="middle" fill="#6b7280" fontSize="10">リンクを辿る</text>
  </svg>
);

const TurnDiagram = () => (
  <svg viewBox="0 0 440 120" className="w-full" role="img" aria-label="ターン制の図">
    <defs>
      <marker id="arr2" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill="#9ca3af" />
      </marker>
    </defs>
    <rect x="14" y="30" width="120" height="60" rx="10" fill="#fef2f2" stroke="#fca5a5" />
    <text x="74" y="55" textAnchor="middle" fill="#b91c1c" fontSize="12" fontWeight="700">P1 のターン</text>
    <text x="74" y="72" textAnchor="middle" fill="#ef4444" fontSize="10">規定回数まで移動</text>

    <path d="M140,60 h30" stroke="#9ca3af" strokeWidth="2" markerEnd="url(#arr2)" />

    <rect x="176" y="30" width="120" height="60" rx="10" fill="#eff6ff" stroke="#93c5fd" />
    <text x="236" y="55" textAnchor="middle" fill="#1d4ed8" fontSize="12" fontWeight="700">P2 のターン</text>
    <text x="236" y="72" textAnchor="middle" fill="#3b82f6" fontSize="10">規定回数まで移動</text>

    <path d="M302,60 h30" stroke="#9ca3af" strokeWidth="2" markerEnd="url(#arr2)" />

    <rect x="338" y="30" width="88" height="60" rx="10" fill="#f0fdf4" stroke="#86efac" />
    <text x="382" y="55" textAnchor="middle" fill="#15803d" fontSize="12" fontWeight="700">交互に</text>
    <text x="382" y="72" textAnchor="middle" fill="#16a34a" fontSize="10">繰り返し</text>
  </svg>
);

export default function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gray-900 text-white px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-xl font-bold">遊び方・ルール</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors" aria-label="閉じる">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-7 text-sm leading-relaxed text-gray-700">
          <section className="space-y-2">
            <SectionTitle icon={Trophy}>Wikipedia Soccer とは</SectionTitle>
            <p>
              Wikipediaの記事どうしを<b>リンクをクリックして移動</b>していく2人対戦ゲーム。
              同じスタートページから出発して、<b>相手より先に自分のゴール記事にたどり着いた人が勝ち</b>です。
              ゴールに「近づく」ほど相手に妨害されるので、駆け引きが生まれます。
            </p>
            <div className="bg-slate-50 rounded-xl border border-gray-200 p-3">
              <Diagram />
            </div>
          </section>

          <section className="space-y-2">
            <SectionTitle icon={Target}>ゴールの決め方</SectionTitle>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>ペアで出題</b>: 「やさしい / ちょうど良い / 難しい」から、連想距離がちょうど良い記事の組を自動抽選（おすすめ）</li>
              <li><b>手入力</b>: 各プレイヤーが自分のゴール記事を自由に指定</li>
            </ul>
            <p className="text-xs text-gray-500">相手のゴールは秘密 — 自分のゴールだけが分かればOK。</p>
          </section>

          <section className="space-y-2">
            <SectionTitle icon={Repeat}>交互ターン制</SectionTitle>
            <div className="bg-slate-50 rounded-xl border border-gray-200 p-3">
              <TurnDiagram />
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>ページ内の<b>リンクをクリック＝1移動</b>。1ターンに動ける回数は設定で決まる（初期: 1ターン目1回 / 以降2回）</li>
              <li>回数を使い切るとターン終了。<b>自分のターン中に自分のゴールへ到達すれば勝利</b></li>
              <li>迷ったら<b>「戻る」</b>で1手前に戻れる（ターン内のみ。オンライン対戦では相手の承認が必要）</li>
              <li>制限時間を設定すると、時間切れでターン交代（または1移動ごとの秒数制限）</li>
            </ul>
          </section>

          <section className="space-y-2">
            <SectionTitle icon={Globe}>オンライン対戦</SectionTitle>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Room IDを共有</b>して参加。先に入った2人が対戦、3人目以降は観戦者</li>
              <li>回線が切れても<b>同じRoom IDで入り直せば途中から再開</b>できます</li>
              <li>「中断」で両者一時停止、「保存して中断」から再開できます</li>
            </ul>
          </section>

          <section className="space-y-2">
            <SectionTitle icon={Lightbulb}>コツ</SectionTitle>
            <ul className="list-disc pl-5 space-y-1">
              <li>いきなりゴールを目指さず、<b>大きなテーマ（「スポーツ」「日本」など）を経由</b>すると道が開けやすい</li>
              <li>相手がゴールに近づいたら、リンクを辿って<b>妨害</b>しよう — ページの占有は共有</li>
              <li>「目標確認」ボタンを<b>押している間だけ</b>自分のゴールを確認できる（相手に見られないよう配慮）</li>
            </ul>
          </section>

          <footer className="pt-4 border-t border-gray-200 space-y-2">
            <p className="text-xs text-gray-500 font-bold text-center">制作者リンク</p>
            <CreatorLinks />
          </footer>
        </div>
      </div>
    </div>
  );
}
