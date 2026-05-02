# Wikipedia Soccer - 難易度付きランダム目標選択

2人対戦型Wikipediaレースゲーム。目標ページを難易度に応じてランダムに選択できる機能を搭載。

## 機能

- **難易度プリセット**: 超初級・初級・中級・上級・超上級の5段階から目標ページを自動選択
- **カスタム難易度**: 被リンク数・ページビュー・ページサイズ・リンク密度・カテゴリ深度を詳細に調整
- **完全ランダム**: 従来通りの完全ランダムも選択可能（後方互換）
- **オンライン対戦**: Socket.ioによるリアルタイム対戦＋難易度設定同期

## インストール

```bash
npm install
```

## 開発サーバーの起動

```bash
npm run dev
```

サーバーが `http://localhost:3011` で起動します。

### 初回起動時のシード

初回起動時、自動的に難易度データベースに約130記事が収集されます（バックグラウンド実行）。完了まで2-3分かかります。コンソールに進捗が表示されます。

収集内容:
- **基礎項目（30件）**: 日本、アメリカ、地球、野球など誰でも知っている話題
- **一般話題（80件）**: 地理・歴史・科学・芸術など百科事典の基礎的な項目を厳選
- **人気記事（10件）**: 直近のページビュー上位記事
- **カテゴリ別（9件）**: 科学・歴史・地理カテゴリから各3件

シードをスキップする場合：

```bash
# Windows
$env:SKIP_DIFFICULTY_SEED=1; npm run dev

# macOS/Linux
SKIP_DIFFICULTY_SEED=1 npm run dev
```

## 難易度データベースの手動更新

既存のDBに追加で記事を収集する：

```bash
# 基礎的な一般話題を50件追加（推奨）
npx tsx src/server/batch-collect.ts --count 50 --mode general

# 人気記事を30件追加
npx tsx src/server/batch-collect.ts --count 30 --mode popular

# 特定カテゴリから収集
npx tsx src/server/batch-collect.ts --count 20 --mode category --category 科学

# 書き込みテスト（実際にはDBに保存しない）
npx tsx src/server/batch-collect.ts --count 10 --mode general --dry-run
```

**モードの違い**:
- `general`: 地理・歴史・科学・芸術などの基礎的な百科事典項目を収集。**偏りが少なく最も推奨**
- `popular`: 直近のページビュー上位記事。トレンドや芸能人に偏りやすい
- `category`: 指定したカテゴリに属する記事を収集
- `random`: 完全ランダム。品質・難易度のバランスが取れにくい

DBファイルは `data/difficulty.db` に保存されます（.gitignore対象）。

## API エンドポイント

| メソッド | エンドポイント | 説明 |
|---------|--------------|------|
| GET | `/api/random` | 完全ランダム（従来通り） |
| GET | `/api/random?difficulty=easy` | 難易度指定ランダム |
| GET | `/api/difficulty/presets` | プリセット一覧取得 |
| POST | `/api/difficulty/custom` | カスタム難易度パラメータで記事取得 |
| GET | `/api/difficulty/stats` | DB統計（記事数・スコア分布） |

### カスタム難易度の例

```bash
curl -X POST http://localhost:3011/api/difficulty/custom \
  -H "Content-Type: application/json" \
  -d '{
    "backlinksRange": {"min": 100, "max": 1000},
    "pageviewsRange": {"min": 1000, "max": 100000},
    "weights": {"backlinks": 0.5, "pageviews": 0.5}
  }'
```

## 難易度スコアリング

到達可能性（中心性）を重視した複合スコア。

### 計算式

```
score = Σ(weight_i × normalize(metric_i))
```

### デフォルト重み

| 指標 | 重み | 説明 |
|------|------|------|
| 被リンク数 | 30% | 他記事からのリンクが多いほど中心性が高く到達しやすい |
| ページビュー | 30% | 閲覧数が多いほど主要な話題で到達しやすい |
| リンク密度 | 20% | ページ内リンクが多いほどナビゲーションしやすい |
| カテゴリ深度 | 15% | カテゴリ木の深い位置はマイナーで到達しにくい |
| ページサイズ | 5% | 極端に大きいページは読みにくい |

### プリセット一覧

| ID | 名前 | スコア範囲 | 星 | 特徴 |
|----|------|-----------|-----|------|
| very_easy | 超初級 | 0.70〜1.00 | 1 | 人気記事、誰でも到達可能 |
| easy | 初級 | 0.50〜0.85 | 2 | 比較的簡単に到達できる話題 |
| medium | 中級 | 0.30〜0.60 | 3 | 一般的な知識が必要 |
| hard | 上級 | 0.15〜0.40 | 4 | 専門的・マイナーな話題 |
| very_hard | 超上級 | 0.00〜0.25 | 5 | 非常にマイナー、戦略が必要 |

## 技術スタック

- **Frontend**: React 19 + TypeScript + TailwindCSS + Vite
- **Backend**: Express + Socket.io + better-sqlite3
- **API**: MediaWiki API + Wikimedia REST API + XTools API

## プロジェクト構成

```
src/
  types/
    difficulty.ts          # 難易度関連の型定義
  server/
    db.ts                  # SQLiteデータベース
    wiki-api.ts            # Wikipedia APIラッパー
    presets.ts             # 難易度プリセット設定
    scoring.ts             # スコアリングエンジン
    batch-collect.ts       # 記事一括収集スクリプト
    seed.ts                # 初期データシード
    routes/
      difficulty.ts        # APIルート
  components/
    DifficultySelector.tsx   # プリセット選択UI
    CustomDifficultyPanel.tsx # カスタム設定UI
  App.tsx                  # メインアプリ
server.ts                  # サーバー起動
```

## 注意事項

- **データベース**: `data/difficulty.db` は gitignore 対象です。新規環境では初回起動時に自動シードが実行されます。
- **Wikipedia API**: 読み取りに厳しいレート制限はありませんが、適切なUser-Agentを設定しています。
- **ページビュー**: Wikimedia REST APIの30日制限により、直近30日分の合計値を使用しています。
- **Wikipedia2Vec**: 初期リリースには含まれていません（将来拡張予定）。
