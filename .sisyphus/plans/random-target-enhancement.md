# 目標ページ難易度付きランダム選択機能強化計画

## TL;DR

> **Quick Summary**: Wikipedia Soccerゲームに、目標ページの難易度に応じたランダム選択機能を追加する。到達可能性（中心性）に基づく複合スコアで難易度を定量化し、プリセット（初級・中級・上級など）と詳細数値カスタム設定の両方を提供する。
>
> **Deliverables**:
> - サーバーサイド難易度データベース（SQLite/LowDB）
> - 難易度スコアリングエンジン（被リンク数・ページビュー・カテゴリ深度・ページサイズ・リンク密度）
> - 新APIエンドポイント（`/api/random?difficulty=...`, `/api/difficulty/presets`, `/api/difficulty/custom`）
> - ゲーム設定UI（プリセット選択 + 高度カスタム設定パネル）
> - オンライン対戦時の難易度設定同期
>
> **Estimated Effort**: Large（約15-20タスク、3-4ウェーブ）
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Wave 1（基盤）→ Wave 2（コア並列）→ Wave 3（統合）→ Wave FINAL（検証）

---

## Context

### Original Request
目標ページのランダム機能を強化。現在の個別指定とは別に、難易度ごとにランダム記事が選ばれる機能を用意したい。完全ランダムだと絶対にたどり着けない場合があり、プレイヤーごとに難易度に差があると不公平。単語ベクトルや被リンク数・プレビュー数・親カテゴリの一致や近さなど、様々な要素を絡めて難易度調整をしたい。最終的にプリセットを使った難易度指定と、カスタムで高度な設定を行えるようにする。

### Interview Summary
**Key Discussions**:
- **対象言語**: 日本語Wikipediaのみ
- **スタートページ**: 完全ランダム（現状維持。Hubページ回避のため）
- **目標ページ**: 難易度調整付きランダム
- **スキル調整**: まずは静的プリセットで運用。将来的にプレイ履歴による動的調整を追加
- **難易度定義**: 到達可能性（中心性）を重視。被リンク数・ページビューで中心性を測定
- **カスタム設定**: 詳細な数値入力。各指標の閾値・重み付けを数値で指定可能
- **アーキテクチャ**: ハイブリッド。サーバーで難易度DBを構築・更新し、クライアントは参照

### Research Findings
- **MediaWiki API**: `list=random`, `prop=info|categories|links`, `list=backlinks` が利用可能
- **Wikimedia REST API**: ページビュー取得可能（30日間ずつ）
- **XTools API**: links_in, links_out, prose count が取得可能
- **Wikipedia2Vec**: 日本語対応あり（jaモデルが公開されている）
- **カテゴリ構造**: DAG（閉路あり）。再帰的な木構造走査は手動が必要
- **レート制限**: 読み取りに厳しい制限なし。User-Agent必須。pipeでバッチ処理可能

### Metis Review
Metisへの問い合わせはタイムアウトしたため、以下のギャップは独自に分析・解決した:
- **データベース選定**: SQLite（ファイルベース、軽量、導入コスト低）を採用
- **初期データ構築**: オンデマンドではなく、バッチ処理で人気記事・ランダム記事のメタデータを事前収集
- **ページビュー30日制限**: 月次データを蓄積して年間平均を算出
- **カテゴリ距離の計算コスト**: リアルタイム計算ではなく、DBに主要カテゴリ深度を事前計算して保存
- **Wikipedia2Vecの扱い**: サーバーでPythonスクリプト or Node.jsバインディングで実行。巨大モデルファイルの配布が課題のため、Phase 2（拡張）として分離

---

## Work Objectives

### Core Objective
日本語Wikipedia記事の到達可能性（中心性）に基づく難易度スコアを計算し、プレイヤーが選んだ難易度帯に応じて目標ページをランダムに選択できる機能を実装する。

### Concrete Deliverables
- `src/types/difficulty.ts` - 難易度関連の型定義
- `src/server/db.ts` - SQLiteデータベース接続・スキーマ管理
- `src/server/scoring.ts` - 難易度スコア計算エンジン
- `src/server/fetcher.ts` - Wikipedia APIラッパー
- `src/server/batch.ts` - 記事メタデータ収集バッチ
- `src/server/routes/difficulty.ts` - 難易度関連APIルート
- `src/components/DifficultySelector.tsx` - プリセット選択UI
- `src/components/CustomDifficultyPanel.tsx` - 高度カスタム設定UI
- `src/App.tsx`変更 - setupフェーズへの統合
- `server.ts`変更 - 新ルート登録

### Definition of Done
- [ ] `/api/random?difficulty=easy` で初級難易度の記事が返る
- [ ] `/api/difficulty/presets` でプリセット一覧が取得できる
- [ ] ゲーム設定画面で「目標ページ: ランダム（初級）」などが選べる
- [ ] 高度設定で各パラメータの閾値・重みを数値入力できる
- [ ] オンライン対戦時、難易度設定が両プレイヤーに同期される
- [ ] サーバー再起動後も難易度DBが保持される

### Must Have
- 難易度スコアリング（被リンク数・ページビュー・ページサイズ・リンク密度・カテゴリ深度）
- 少なくとも3つのプリセット（初級・中級・上級）
- カスタム設定での重み・閾値調整
- 日本語Wikipedia対応
- サーバーサイドでのデータ永続化（SQLite）

### Must NOT Have (Guardrails)
- **スタートページの難易度調整**: スタートは完全ランダム（現状維持）
- **Wikipedia2Vecのリアルタイム計算**: モデルサイズが大きいため、初期リリースには含めない（将来拡張）
- **全記事の網羅的インデックス**: Wikipedia日本語版は100万記事以上。全件は現実的ではない
- **クライアントサイドでの重い計算**: 計算はサーバーで行う
- **既存の手動入力機能の削除**: 個別指定は残す

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None（テストフレームワークなし）
- **Agent-Executed QA**: 全タスクに必須

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **API/Backend**: Use Bash (curl) - Send requests, assert status + response fields
- **Frontend/UI**: Use Playwright (playwright skill) - Navigate, interact, assert DOM, screenshot
- **Database**: Use Bash (sqlite3) - Query tables, assert row counts and column values

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - Start Immediately):
├── Task 1: Type definitions and scoring model design
├── Task 2: SQLite database setup and schema
├── Task 3: Wikipedia API fetcher utility
└── Task 4: Difficulty preset configuration

Wave 2 (Core Modules - MAX PARALLEL after Wave 1):
├── Task 5: Difficulty scoring engine implementation
├── Task 6: Article metadata batch collection script
├── Task 7: New API routes (/api/random, /api/difficulty/*)
├── Task 8: DifficultySelector preset UI component
├── Task 9: CustomDifficultyPanel advanced settings UI
└── Task 10: Seed initial difficulty database

Wave 3 (Integration - after Wave 2):
├── Task 11: Integrate difficulty selection into App.tsx setup phase
├── Task 12: Online multiplayer difficulty sync
├── Task 13: Caching and performance optimization
└── Task 14: Polish: loading states, error handling, tooltips

Wave FINAL (After ALL tasks - 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high + playwright)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: T1 → T2 → T5 → T7 → T11 → T12 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 6 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| T1 (Types) | - | T2, T4, T5, T8, T9 |
| T2 (DB) | T1 | T5, T6, T7, T10 |
| T3 (Fetcher) | - | T5, T6, T7 |
| T4 (Presets) | T1 | T7, T8 |
| T5 (Scoring) | T1, T2, T3 | T6, T7, T10 |
| T6 (Batch) | T2, T3, T5 | T10 |
| T7 (API Routes) | T1, T2, T3, T4, T5 | T11, T12 |
| T8 (Preset UI) | T1, T4 | T11 |
| T9 (Custom UI) | T1, T4 | T11 |
| T10 (Seed DB) | T2, T5, T6 | T11 |
| T11 (Integration) | T7, T8, T9, T10 | T12, T13, T14 |
| T12 (Online Sync) | T7, T11 | T14 |
| T13 (Cache/Perf) | T7, T11 | - |
| T14 (Polish) | T11, T12 | - |

---

## TODOs

- [ ] 1. **Type definitions and scoring model design**

  **What to do**:
  - Create `src/types/difficulty.ts` with all difficulty-related TypeScript interfaces
  - Define `ArticleMeta` type: `{ title, pageId, backlinks, pageviews, pageSize, linkCount, categoryDepth, lastUpdated }`
  - Define `DifficultyScore` type: `{ rawScore, normalizedScore, percentile, factors: {...} }`
  - Define `DifficultyPreset` type: `{ id, name, description, scoreRange: [min, max], icon? }`
  - Define `CustomDifficultyParams` type: all adjustable weights and thresholds
  - Define `ScoringWeights` type: `{ backlinks, pageviews, pageSize, linkDensity, categoryDepth }` with min/max ranges
  - Document scoring formula: `score = Σ(weight_i × normalize(metric_i, min_i, max_i))`
  - Add JSDoc comments explaining each field

  **Must NOT do**:
  - Do NOT implement actual calculation logic (that goes in T5)
  - Do NOT import React or server-specific modules here

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure TypeScript type definitions, no complex logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 2, 4, 5, 8, 9
  - **Blocked By**: None

  **References**:
  - `src/App.tsx:9-36` - Existing `SavedGame` interface pattern to follow for naming/style
  - `server.ts:306-315` - Current `/api/random` response shape (`{ title }`)

  **Acceptance Criteria**:
  - [ ] File `src/types/difficulty.ts` exists and exports all types
  - [ ] `npx tsc --noEmit` passes with no errors

  **QA Scenarios**:
  ```
  Scenario: Type compilation succeeds
    Tool: Bash
    Preconditions: File created
    Steps:
      1. Run `npx tsc --noEmit`
    Expected Result: Exit code 0, no type errors
    Evidence: .sisyphus/evidence/task-1-type-check.txt
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add difficulty type definitions`
  - Files: `src/types/difficulty.ts`

---

- [ ] 2. **SQLite database setup and schema**

  **What to do**:
  - Install `better-sqlite3` package (fast, synchronous SQLite for Node.js)
  - Create `src/server/db.ts` module
  - Initialize database file at `data/difficulty.db` (create `data/` directory if needed)
  - Create `articles` table: `id TEXT PRIMARY KEY, title TEXT UNIQUE, pageId INTEGER, backlinks INTEGER, pageviews REAL, pageSize INTEGER, linkCount INTEGER, categoryDepth INTEGER, rawScore REAL, normalizedScore REAL, percentile REAL, lastUpdated INTEGER`
  - Create `scoring_log` table: `id INTEGER PRIMARY KEY AUTOINCREMENT, articleId TEXT, calculatedAt INTEGER, factors TEXT, FOREIGN KEY (articleId) REFERENCES articles(id)`
  - Create `presets` table (optional, or use in-memory config): `id TEXT PRIMARY KEY, name TEXT, minScore REAL, maxScore REAL, config TEXT`
  - Export `initDatabase()`, `getArticleByScoreRange(min, max, limit)`, `upsertArticle(article)`, `getArticleCount()`
  - Add WAL mode for better concurrency: `db.pragma('journal_mode = WAL')`

  **Must NOT do**:
  - Do NOT use an ORM (keep it simple with raw SQL)
  - Do NOT commit the `.db` file to git (add `data/` to `.gitignore`)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Database setup is straightforward schema creation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 5, 6, 7, 10
  - **Blocked By**: Task 1

  **References**:
  - `server.ts:1-15` - Existing server imports and setup pattern
  - better-sqlite3 docs: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md

  **Acceptance Criteria**:
  - [ ] `npm install better-sqlite3` succeeds
  - [ ] `data/difficulty.db` is created on server start
  - [ ] `getArticleCount()` returns 0 on fresh start
  - [ ] `.gitignore` updated to ignore `data/`

  **QA Scenarios**:
  ```
  Scenario: Database initializes correctly
    Tool: Bash
    Preconditions: Dependencies installed
    Steps:
      1. Run `npm install`
      2. Run `node -e "const db = require('./src/server/db.ts'); console.log(db.getArticleCount())"` (or equivalent tsx command)
    Expected Result: Returns 0, no errors, data/difficulty.db exists
    Evidence: .sisyphus/evidence/task-2-db-init.txt

  Scenario: WAL mode enabled
    Tool: Bash
    Steps:
      1. Run `sqlite3 data/difficulty.db "PRAGMA journal_mode;"`
    Expected Result: Outputs "wal"
    Evidence: .sisyphus/evidence/task-2-wal-mode.txt
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add SQLite database schema`
  - Files: `src/server/db.ts`, `package.json`, `.gitignore`

---

- [ ] 3. **Wikipedia API fetcher utility**

  **What to do**:
  - Create `src/server/wiki-api.ts`
  - Implement `fetchRandomArticles(count: number): Promise<string[]>` - calls `list=random&rnnamespace=0&rnlimit={count}`
  - Implement `fetchArticleMeta(titles: string[]): Promise<ArticleMeta[]>` - batch fetch via `titles=A|B|C` with `prop=info|categories|links` and `list=backlinks` per title
  - Implement `fetchPageViews(title: string, days: number): Promise<number>` - calls Wikimedia REST API `metrics/pageviews/per-article/ja.wikipedia/all-access/all-agents/{title}/daily/{start}/{end}`, sums views
  - Implement `fetchXToolsStats(title: string): Promise<{linksIn, linksOut, prose}>` - calls `xtools.wmflabs.org/api/page/{stat}/ja.wikipedia.org/{title}`
  - Add proper User-Agent header: `WikipediaSoccerGame/1.0 (DifficultyScorer)`
  - Add retry logic with exponential backoff for 429/5xx errors (max 3 retries)
  - Add request logging for debugging
  - Handle rate limiting gracefully

  **Must NOT do**:
  - Do NOT store API responses (that's T6's job)
  - Do NOT call these from client-side code

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: API wrappers are straightforward fetch implementations
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 5, 6, 7
  - **Blocked By**: Task 1

  **References**:
  - `server.ts:306-315` - Current `/api/random` fetch pattern
  - Librarian research results: MediaWiki API endpoints and parameters
  - XTools API docs: https://www.mediawiki.org/wiki/XTools/API

  **Acceptance Criteria**:
  - [ ] `fetchRandomArticles(5)` returns 5 unique Japanese article titles
  - [ ] `fetchArticleMeta(['織田信長', '徳川家康'])` returns metadata for both
  - [ ] `fetchPageViews('織田信長', 30)` returns a positive number
  - [ ] Retry logic works (can simulate with a mock failing URL)

  **QA Scenarios**:
  ```
  Scenario: Random article fetch works
    Tool: Bash (curl via tsx script)
    Preconditions: Server not needed, just the module
    Steps:
      1. Create test script that imports fetchRandomArticles(5)
      2. Run with tsx
    Expected Result: Array of 5 Japanese strings, no errors
    Evidence: .sisyphus/evidence/task-3-random-fetch.json

  Scenario: Batch metadata fetch works
    Tool: Bash (curl via tsx script)
    Steps:
      1. Call fetchArticleMeta with ['日本', '東京']
    Expected Result: Array with 2 items, each has backlinks >= 0, pageSize > 0
    Evidence: .sisyphus/evidence/task-3-meta-fetch.json

  Scenario: Retry on failure
    Tool: Bash
    Steps:
      1. Temporarily change API URL to invalid endpoint
      2. Call fetchRandomArticles(1)
    Expected Result: Throws after 3 retries, not immediately
    Evidence: .sisyphus/evidence/task-3-retry.txt
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add Wikipedia API fetcher utilities`
  - Files: `src/server/wiki-api.ts`

---

- [ ] 4. **Difficulty preset configuration**

  **What to do**:
  - Create `src/server/presets.ts`
  - Define 5 built-in presets with score ranges (0-1 normalized scale):
    - `very_easy`: 0.70-1.00 (extremely reachable: very high backlinks/views, low category depth)
    - `easy`: 0.50-0.85 (highly reachable)
    - `medium`: 0.30-0.60 (moderately reachable)
    - `hard`: 0.15-0.40 (less reachable)
    - `very_hard`: 0.00-0.25 (niche/obscure: low backlinks/views, high category depth)
  - Each preset has: `id`, `name` (日本語), `description`, `scoreRange`, `defaultWeights` override (optional)
  - Export `getPresetById(id)`, `getAllPresets()`, `getPresetScoreRange(id)`
  - Preset ranges intentionally overlap to avoid empty results when DB is sparse
  - Add comments explaining why each preset range was chosen

  **Must NOT do**:
  - Do NOT hardcode specific article titles in presets
  - Do NOT make presets configurable by users (admin-only constants)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Configuration constants with simple lookup functions
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Tasks 7, 8
  - **Blocked By**: Task 1

  **References**:
  - `src/types/difficulty.ts` (from T1) - Preset type definition
  - `src/App.tsx:641-789` - Settings UI pattern for reference on user-facing labels

  **Acceptance Criteria**:
  - [ ] `getAllPresets()` returns 5 presets with Japanese names
  - [ ] `getPresetById('medium')` returns the medium preset
  - [ ] Score ranges are validated (max > min, within 0-1)

  **QA Scenarios**:
  ```
  Scenario: Presets load correctly
    Tool: Bash (tsx script)
    Steps:
      1. Import getAllPresets
      2. Log JSON output
    Expected Result: 5 presets, each has id, name, description, scoreRange
    Evidence: .sisyphus/evidence/task-4-presets.json
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add difficulty preset configurations`
  - Files: `src/server/presets.ts`

---

- [ ] 5. **Difficulty scoring engine implementation**

  **What to do**:
  - Create `src/server/scoring.ts`
  - Implement `calculateRawScore(meta: ArticleMeta): DifficultyScore`
  - Each factor is normalized to 0-1 range using configurable min/max:
    - `backlinks`: normalize(log(meta.backlinks + 1), log(10), log(50000)) — more backlinks = higher score (easier to reach)
    - `pageviews`: normalize(log(meta.pageviews + 1), log(100), log(10000000)) — more views = higher score
    - `pageSize`: normalize(meta.pageSize, 500, 500000) — moderate penalty for extremely large pages (can be confusing)
    - `linkDensity`: normalize(meta.linkCount / meta.pageSize, 0.0001, 0.01) — higher link density = easier navigation = higher score
    - `categoryDepth`: normalize(meta.categoryDepth, 0, 10) — deeper in category tree = more niche = lower score (invert: 1 - normalized)
  - Composite score = weighted sum. Default weights: backlinks 0.30, pageviews 0.30, pageSize 0.05, linkDensity 0.20, categoryDepth 0.15
  - `normalize(value, min, max)` clamps to 0-1: `(clamp(value, min, max) - min) / (max - min)`
  - Calculate percentile by comparing against existing DB articles (or use static percentile bands if DB is empty)
  - Export `calculateCustomScore(meta, customWeights)` for custom settings
  - Add extensive JSDoc explaining the formula and each factor's rationale

  **Must NOT do**:
  - Do NOT query Wikipedia API here (pure calculation only)
  - Do NOT mutate the input `meta` object
  - Do NOT use Wikipedia2Vec (out of scope for initial release)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex mathematical logic with multiple interacting factors that must be carefully tuned
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Wave 1)
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8, 9, 10)
  - **Blocks**: Tasks 6, 7, 10
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - `src/types/difficulty.ts` (T1) - Score types and factor definitions
  - `src/server/db.ts` (T2) - For percentile calculation against existing articles
  - Librarian findings: "Page complexity" and "centrality" metrics from research

  **Acceptance Criteria**:
  - [ ] `calculateRawScore` returns score in 0-1 range for sample articles
  - [ ] メインページ（backlinks多）のスコア > 0.8
  - [ ] 超マイナー記事（backlinks少）のスコア < 0.2
  - [ ] Custom weights change the score proportionally

  **QA Scenarios**:
  ```
  Scenario: Main article scores high
    Tool: Bash (tsx script)
    Steps:
      1. Create mock ArticleMeta with backlinks=50000, pageviews=1000000, pageSize=50000, linkCount=500, categoryDepth=2
      2. Call calculateRawScore
    Expected Result: normalizedScore >= 0.7
    Evidence: .sisyphus/evidence/task-5-high-score.json

  Scenario: Niche article scores low
    Tool: Bash (tsx script)
    Steps:
      1. Create mock ArticleMeta with backlinks=5, pageviews=50, pageSize=2000, linkCount=5, categoryDepth=8
      2. Call calculateRawScore
    Expected Result: normalizedScore <= 0.3
    Evidence: .sisyphus/evidence/task-5-low-score.json

  Scenario: Custom weights affect score
    Tool: Bash (tsx script)
    Steps:
      1. Calculate score with default weights
      2. Calculate with weights {backlinks:1, others:0}
      3. Compare
    Expected Result: Scores differ, second score correlates with backlinks only
    Evidence: .sisyphus/evidence/task-5-custom-weights.json
  ```

  **Commit**: YES
  - Message: `feat(difficulty): implement difficulty scoring engine`
  - Files: `src/server/scoring.ts`

---

- [ ] 6. **Article metadata batch collection script**

  **What to do**:
  - Create `src/server/batch-collect.ts`
  - Implement `collectRandomArticles(count: number)`:
    1. Fetch `count` random articles via `fetchRandomArticles(count)`
    2. Fetch metadata for batch via `fetchArticleMeta(titles)`
    3. Fetch pageviews for each via `fetchPageViews(title, 30)`
    4. Calculate difficulty score via `calculateRawScore(meta)`
    5. Upsert into SQLite DB via `upsertArticle()`
  - Implement `collectPopularArticles()`:
    - Fetch top 100 most viewed Japanese Wikipedia articles from `metrics/pageviews/top/ja.wikipedia/all-access/2025/04/all-days`
    - Collect metadata and scores for each
  - Add CLI entry point: `npm run collect-difficulty -- --count 500 --mode random` or `--mode popular`
  - Add progress logging (e.g., "Collected 50/500 articles...")
  - Handle partial failures: if one article fails, continue with others. Log failures.
  - Add `--dry-run` flag to preview without DB writes

  **Must NOT do**:
  - Do NOT run automatically on server start (must be explicit command)
  - Do NOT collect more than 1000 articles in a single run without user confirmation

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex multi-step batch processing with error handling and external API dependency
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Wave 1)
  - **Parallel Group**: Wave 2 (with Tasks 5, 7, 8, 9, 10)
  - **Blocks**: Task 10
  - **Blocked By**: Tasks 2, 3, 5

  **References**:
  - `src/server/wiki-api.ts` (T3) - Fetcher utilities
  - `src/server/scoring.ts` (T5) - Score calculation
  - `src/server/db.ts` (T2) - Database upsert

  **Acceptance Criteria**:
  - [ ] `npm run collect-difficulty -- --count 10 --mode random` completes and inserts 10 rows
  - [ ] Failed articles are logged but don't crash the process
  - [ ] `--dry-run` shows what would be inserted without writing
  - [ ] Progress is logged to console

  **QA Scenarios**:
  ```
  Scenario: Batch collection succeeds
    Tool: Bash
    Preconditions: DB initialized
    Steps:
      1. Run `npm run collect-difficulty -- --count 20 --mode random`
      2. Wait for completion
      3. Query DB: `sqlite3 data/difficulty.db "SELECT COUNT(*) FROM articles;"`
    Expected Result: Count >= 20 (may include previous data)
    Evidence: .sisyphus/evidence/task-6-batch-count.txt

  Scenario: Dry run doesn't write
    Tool: Bash
    Steps:
      1. Note current article count
      2. Run `npm run collect-difficulty -- --count 10 --dry-run`
      3. Check count again
    Expected Result: Count unchanged
    Evidence: .sisyphus/evidence/task-6-dry-run.txt
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add article metadata batch collection`
  - Files: `src/server/batch-collect.ts`, `package.json` (scripts)

---

- [ ] 7. **New API routes for difficulty-based random selection**

  **What to do**:
  - Create `src/server/routes/difficulty.ts` (or add to `server.ts` if keeping simple)
  - Implement `GET /api/difficulty/presets`:
    - Returns all preset definitions from `getAllPresets()`
    - Response: `{ presets: DifficultyPreset[] }`
  - Implement `GET /api/random` (enhanced):
    - Query params: `?difficulty=medium` (optional, falls back to completely random if omitted)
    - If difficulty param present:
      1. Look up preset score range
      2. Query DB: `SELECT title FROM articles WHERE normalizedScore BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 1`
      3. If no result in range, fallback to random Wikipedia API and warn client
      4. If DB is empty, fallback to random and log warning
    - Response: `{ title, difficulty?, fallback?, message? }`
  - Implement `POST /api/difficulty/custom`:
    - Body: `CustomDifficultyParams` (weights, thresholds)
    - Query DB with dynamic WHERE clause based on params
    - Returns: `{ title, params, score }`
  - Implement `GET /api/difficulty/stats`:
    - Returns DB statistics: total articles, score distribution histogram, last updated
  - Add proper error handling and HTTP status codes
  - Add CORS headers for API routes
  - Log all API requests for debugging

  **Must NOT do**:
  - Do NOT break the existing `/api/random` contract (without `difficulty` param must behave identically)
  - Do NOT expose raw SQL to client

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: API design with multiple endpoints, error handling, backward compatibility
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Wave 1)
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 8, 9, 10)
  - **Blocks**: Tasks 11, 12
  - **Blocked By**: Tasks 1, 2, 3, 4, 5

  **References**:
  - `server.ts:306-315` - Existing `/api/random` route to preserve
  - `src/server/presets.ts` (T4) - Preset definitions
  - `src/server/db.ts` (T2) - DB query functions

  **Acceptance Criteria**:
  - [ ] `GET /api/difficulty/presets` returns 5 presets
  - [ ] `GET /api/random` (no params) still works exactly as before
  - [ ] `GET /api/random?difficulty=easy` returns an article title
  - [ ] `POST /api/difficulty/custom` with valid body returns an article
  - [ ] All endpoints return proper JSON and HTTP status codes

  **QA Scenarios**:
  ```
  Scenario: Presets endpoint works
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl http://localhost:3011/api/difficulty/presets
    Expected Result: HTTP 200, JSON with presets array of length 5
    Evidence: .sisyphus/evidence/task-7-presets-api.json

  Scenario: Random with difficulty works
    Tool: Bash (curl)
    Preconditions: Server running, DB has articles
    Steps:
      1. curl "http://localhost:3011/api/random?difficulty=medium"
    Expected Result: HTTP 200, JSON with { title: "..." }
    Evidence: .sisyphus/evidence/task-7-random-difficulty.json

  Scenario: Backward compatibility
    Tool: Bash (curl)
    Steps:
      1. curl http://localhost:3011/api/random
    Expected Result: HTTP 200, JSON with { title: "..." } (same format as before)
    Evidence: .sisyphus/evidence/task-7-backward-compat.json

  Scenario: Custom difficulty API
    Tool: Bash (curl)
    Steps:
      1. curl -X POST http://localhost:3011/api/difficulty/custom \
         -H "Content-Type: application/json" \
         -d '{"backlinksMin":100,"backlinksMax":1000}'
    Expected Result: HTTP 200, JSON with { title, score }
    Evidence: .sisyphus/evidence/task-7-custom-api.json
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add difficulty-based API routes`
  - Files: `src/server/routes/difficulty.ts` or `server.ts` additions

---

- [ ] 8. **DifficultySelector preset UI component**

  **What to do**:
  - Create `src/components/DifficultySelector.tsx`
  - Display preset options as selectable cards/buttons with icons
  - Show preset name (日本語), description, and estimated difficulty indicator (e.g., 1-5 stars or color gradient)
  - Highlight currently selected preset
  - Emit `onSelect(presetId)` callback
  - Add tooltip on hover showing preset's score range and typical article examples
  - Responsive design: horizontal scroll on mobile, grid on desktop
  - Include an option for "完全ランダム" (no difficulty filter) to preserve existing behavior
  - Style with TailwindCSS matching existing UI (gray-900 accents, rounded-xl, shadow)

  **Must NOT do**:
  - Do NOT fetch presets from API on every render (fetch once and cache)
  - Do NOT implement custom settings UI (that's T9)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI component requiring good UX, responsive design, and visual polish
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Wave 1)
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 9, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Tasks 1, 4

  **References**:
  - `src/App.tsx:641-789` - Settings screen UI patterns (buttons, inputs, layout)
  - `src/App.tsx:821-953` - Setup phase UI patterns
  - Lucide-react icons: `Dices`, `Target`, `Star`, `Settings`

  **Acceptance Criteria**:
  - [ ] Component renders 5 preset cards + "完全ランダム" option
  - [ ] Clicking a preset calls onSelect with correct ID
  - [ ] Selected preset has visual highlight
  - [ ] Tooltips show on hover
  - [ ] Responsive layout works

  **QA Scenarios**:
  ```
  Scenario: Preset selector renders
    Tool: Playwright
    Preconditions: App running, navigate to setup phase
    Steps:
      1. Open browser at http://localhost:3011
      2. Click "目標設定に進む"
      3. Look for difficulty selector
    Expected Result: 6 options visible (5 presets + random), styled correctly
    Evidence: .sisyphus/evidence/task-8-render.png

  Scenario: Preset selection works
    Tool: Playwright
    Steps:
      1. Click "初級" preset
      2. Observe highlight state
      3. Click "ランダム取得" button
    Expected Result: "初級" is highlighted, random fetch uses easy difficulty
    Evidence: .sisyphus/evidence/task-8-select.png
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add difficulty preset selector UI`
  - Files: `src/components/DifficultySelector.tsx`

---

- [ ] 9. **CustomDifficultyPanel advanced settings UI**

  **What to do**:
  - Create `src/components/CustomDifficultyPanel.tsx`
  - Expandable/collapsible panel (accordion style) labeled "高度な設定"
  - Sliders or number inputs for each metric:
    - 被リンク数 (backlinks): min/max range (0 to 50000)
    - ページビュー (pageviews): min/max range (0 to 10000000)
    - ページサイズ (pageSize): min/max range (0 to 500000 bytes)
    - リンク密度 (linkDensity): min/max range (0 to 0.02)
    - カテゴリ深度 (categoryDepth): min/max range (0 to 15)
  - Weight sliders for scoring formula (0-1, sum need not be 1, but show current sum)
  - "リセット" button to restore default weights
  - "テスト実行" button to call `/api/difficulty/custom` with current params and show preview result
  - Show loading state during test
  - Display validation errors (e.g., min > max)
  - Persist custom settings in localStorage key `wiki_soccer_custom_difficulty`

  **Must NOT do**:
  - Do NOT block the main game flow (this is optional advanced settings)
  - Do NOT implement real-time preview (call API on button click only, not on every change)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Complex form UI with many inputs, validation, and state management
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Wave 1)
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 8, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Tasks 1, 4

  **References**:
  - `src/App.tsx:641-789` - Settings screen with number inputs and select dropdowns
  - `src/App.tsx:692-725` - Time limit selector pattern
  - `src/types/difficulty.ts` (T1) - CustomDifficultyParams type

  **Acceptance Criteria**:
  - [ ] Panel expands/collapses on click
  - [ ] All 5 metric ranges have min/max inputs
  - [ ] Weight sliders sum is displayed
  - [ ] "テスト実行" calls API and shows result
  - [ ] Validation prevents min > max
  - [ ] Settings persist in localStorage

  **QA Scenarios**:
  ```
  Scenario: Custom panel expands
    Tool: Playwright
    Preconditions: App running, in setup phase
    Steps:
      1. Click "高度な設定" accordion
      2. Verify sliders/inputs appear
    Expected Result: Panel expands, 5 metric sections visible
    Evidence: .sisyphus/evidence/task-9-expand.png

  Scenario: Test run works
    Tool: Playwright
    Steps:
      1. Set backlinks min=100, max=1000
      2. Click "テスト実行"
      3. Wait for loading
    Expected Result: API result displayed with article title and score
    Evidence: .sisyphus/evidence/task-9-test-run.png

  Scenario: Validation works
    Tool: Playwright
    Steps:
      1. Set min=1000, max=100
      2. Blur input
    Expected Result: Error message shown, "テスト実行" disabled
    Evidence: .sisyphus/evidence/task-9-validation.png
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add custom difficulty settings panel`
  - Files: `src/components/CustomDifficultyPanel.tsx`

---

- [ ] 10. **Seed initial difficulty database**

  **What to do**:
  - Create `src/server/seed.ts`
  - Implement `seedDatabase()` that runs on first server startup if DB is empty
  - Collect a diverse mix of articles:
    - 100 random articles (broad coverage)
    - 100 popular articles (high centrality baseline)
    - 50 articles from various major categories (科学, 歴史, 地理, 人物, 文化, スポーツ) using `deepcat:` search
  - Calculate scores for all and insert into DB
  - Add log message: "Seeded difficulty database with N articles"
  - Make seeding idempotent (check if DB already has articles before running)
  - Allow disabling via environment variable: `SKIP_DIFFICULTY_SEED=1`
  - Add `--seed` CLI flag to `npm run dev` alternative: `npm run seed-difficulty`

  **Must NOT do**:
  - Do NOT block server startup for more than 30 seconds (seed async in background if needed)
  - Do NOT seed on every restart

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: One-time data setup requiring multiple API calls and batch processing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Wave 1)
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 8, 9)
  - **Blocks**: Task 11
  - **Blocked By**: Tasks 2, 5, 6

  **References**:
  - `src/server/batch-collect.ts` (T6) - Collection logic to reuse
  - `src/server/db.ts` (T2) - DB insertion
  - `src/server/scoring.ts` (T5) - Score calculation

  **Acceptance Criteria**:
  - [ ] First server start seeds DB with >= 250 articles
  - [ ] Second start does NOT reseed (idempotent)
  - [ ] `SKIP_DIFFICULTY_SEED=1 npm run dev` skips seeding
  - [ ] Seeding completes within 60 seconds

  **QA Scenarios**:
  ```
  Scenario: Fresh DB seeds on startup
    Tool: Bash
    Preconditions: Delete data/difficulty.db
    Steps:
      1. Start server: `npm run dev`
      2. Wait 60 seconds
      3. Query: `sqlite3 data/difficulty.db "SELECT COUNT(*) FROM articles;"`
    Expected Result: Count >= 250
    Evidence: .sisyphus/evidence/task-10-seed-count.txt

  Scenario: Idempotent seeding
    Tool: Bash
    Steps:
      1. Stop server
      2. Start server again
      3. Check article count before and after
    Expected Result: Count unchanged
    Evidence: .sisyphus/evidence/task-10-idempotent.txt
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add database seeding on first startup`
  - Files: `src/server/seed.ts`, `server.ts` (startup hook)

---

- [ ] 11. **Integrate difficulty selection into App.tsx setup phase**

  **What to do**:
  - Modify `src/App.tsx` setup phase (`phase === 'setup'`)
  - Add state: `targetDifficultyMode: 'preset' | 'custom' | 'none'` for each player
  - Add state: `p1DifficultyPreset`, `p2DifficultyPreset` (preset IDs)
  - Add state: `p1CustomParams`, `p2CustomParams` (CustomDifficultyParams)
  - Replace the simple "ランダム" button in Player 1/2 setup sections with:
    1. `<DifficultySelector>` component for preset selection
    2. "ランダム取得" button that calls `/api/random?difficulty={presetId}` or `/api/difficulty/custom`
  - Add `<CustomDifficultyPanel>` below the preset selector (collapsed by default)
  - When difficulty mode is 'none', use existing `/api/random` (backward compatible)
  - Show loading spinner while fetching random target
  - Show error toast if API fails with fallback message
  - Preserve existing WikiAutocomplete for manual entry (difficulty is only for random)
  - Update `SavedGame` type to include difficulty settings (for save/load compatibility)

  **Must NOT do**:
  - Do NOT remove the manual WikiAutocomplete input
  - Do NOT change the start page random logic (that stays as-is)
  - Do NOT break online multiplayer state sync

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex integration into existing monolithic component with many state interactions
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (must wait for Wave 2 UI components)
  - **Parallel Group**: Wave 3 (sequential after Wave 2)
  - **Blocks**: Tasks 12, 13, 14
  - **Blocked By**: Tasks 7, 8, 9, 10

  **References**:
  - `src/App.tsx:838-954` - Setup phase JSX and state (player 1/2 target sections)
    - Line 845-851: Current random button for P1
    - Line 892-898: Current random button for P2
  - `src/App.tsx:20-36` - SavedGame interface (add difficulty fields)
  - `src/App.tsx:299-307` - Current `fetchRandomTarget` function
  - `src/components/DifficultySelector.tsx` (T8) - Component to integrate
  - `src/components/CustomDifficultyPanel.tsx` (T9) - Component to integrate

  **Acceptance Criteria**:
  - [ ] Setup phase shows difficulty selector for both players
  - [ ] "ランダム取得" respects selected preset
  - [ ] Custom settings panel expands/collapses
  - [ ] Manual input still works
  - [ ] Save/load preserves difficulty settings

  **QA Scenarios**:
  ```
  Scenario: Setup with difficulty preset
    Tool: Playwright
    Preconditions: App running, server seeded
    Steps:
      1. Navigate to setup
      2. Select "初級" for Player 1
      3. Click "ランダム取得"
      4. Wait for result
    Expected Result: P1 target populated, no errors
    Evidence: .sisyphus/evidence/task-11-setup-preset.png

  Scenario: Setup with custom difficulty
    Tool: Playwright
    Steps:
      1. Navigate to setup
      2. Select preset "カスタム"
      3. Expand custom panel
      4. Adjust backlinks range
      5. Click "ランダム取得"
    Expected Result: Custom params sent to API, target populated
    Evidence: .sisyphus/evidence/task-11-setup-custom.png
  ```

  **Commit**: YES
  - Message: `feat(difficulty): integrate difficulty selection into game setup`
  - Files: `src/App.tsx`

---

- [ ] 12. **Online multiplayer difficulty sync**

  **What to do**:
  - Extend Socket.io state sync to include difficulty settings
  - Add to synced state: `p1DifficultyPreset`, `p2DifficultyPreset`, `p1CustomParams`, `p2CustomParams`
  - When Player 1 changes difficulty preset, emit `sync_state` with new preset
  - When Player 2 changes difficulty preset, emit `sync_state` with new preset
  - Ensure spectators see the difficulty settings (or at least know they exist)
  - Handle reconnection: restore difficulty settings from `roomStates` Map
  - Add server-side validation: reject invalid preset IDs or out-of-range custom params
  - Update `roomStates` type (currently `any`) to include difficulty fields

  **Must NOT do**:
  - Do NOT change the core game mechanics (turns, moves, win conditions)
  - Do NOT break backward compatibility with older clients (gracefully ignore unknown fields)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Real-time sync with edge cases (reconnection, spectators, validation)
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T11)
  - **Parallel Group**: Wave 3 (with Tasks 13, 14)
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 7, 11

  **References**:
  - `server.ts:15-55` - Socket.io room state sync logic
  - `server.ts:51-54` - `sync_state` handler
  - `src/App.tsx:99-189` - Client-side socket event handlers
  - `src/App.tsx:191-198` - `emitStateUpdate` function

  **Acceptance Criteria**:
  - [ ] P1 changing preset updates P2's UI via socket
  - [ ] P2 changing preset updates P1's UI via socket
  - [ ] Spectator sees current difficulty settings
  - [ ] Reconnecting player restores difficulty settings

  **QA Scenarios**:
  ```
  Scenario: Difficulty syncs between players
    Tool: Playwright (2 browser instances or tabs)
    Preconditions: Server running, 2 players in same room
    Steps:
      1. P1 selects "上級" preset
      2. Check P2's screen
    Expected Result: P2 sees "上級" selected for P1
    Evidence: .sisyphus/evidence/task-12-sync.png
  ```

  **Commit**: YES
  - Message: `feat(difficulty): sync difficulty settings in online multiplayer`
  - Files: `server.ts`, `src/App.tsx`

---

- [ ] 13. **Caching and performance optimization**

  **What to do**:
  - Implement in-memory LRU cache for API responses in `src/server/wiki-api.ts`
  - Cache key: `random:{count}`, `meta:{titlesHash}`, `views:{title}:{month}`
  - Max cache size: 1000 entries, TTL: 1 hour for random/meta, 24 hours for views
  - Add `Cache-Control` headers to API responses: `max-age=300` for presets/stats
  - Optimize DB queries:
    - Add index on `articles.normalizedScore`
    - Add index on `articles.lastUpdated`
  - Implement query result caching for frequent difficulty ranges
  - Add request deduplication: if 2 clients request `random?difficulty=easy` simultaneously, reuse the same DB query
  - Add performance logging: log slow queries (>100ms) and API calls

  **Must NOT do**:
  - Do NOT cache error responses
  - Do NOT use external caching services (Redis, etc.) — keep it in-process

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Performance optimizations are isolated and well-scoped
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T11)
  - **Parallel Group**: Wave 3 (with Tasks 12, 14)
  - **Blocks**: None
  - **Blocked By**: Tasks 7, 11

  **References**:
  - `src/server/wiki-api.ts` (T3) - Add caching layer
  - `src/server/db.ts` (T2) - Add indexes
  - `src/server/routes/difficulty.ts` (T7) - Add response headers

  **Acceptance Criteria**:
  - [ ] Repeated API calls return faster (cache hit)
  - [ ] DB has indexes on normalizedScore and lastUpdated
  - [ ] Slow queries are logged

  **QA Scenarios**:
  ```
  Scenario: Cache improves response time
    Tool: Bash (curl with time measurement)
    Steps:
      1. curl -w "%{time_total}" http://localhost:3011/api/difficulty/presets
      2. Same request again
    Expected Result: Second request is faster
    Evidence: .sisyphus/evidence/task-13-cache-timing.txt
  ```

  **Commit**: YES
  - Message: `perf(difficulty): add caching and db indexes`
  - Files: `src/server/wiki-api.ts`, `src/server/db.ts`, `src/server/routes/difficulty.ts`

---

- [ ] 14. **Polish: loading states, error handling, tooltips**

  **What to do**:
  - Add loading spinner to "ランダム取得" button while API call is in flight
  - Add retry button when random fetch fails
  - Show informative error messages:
    - "難易度データベースが空です。サーバーを再起動してください。"
    - "該当する難易度の記事が見つかりません。別の難易度を試してください。"
    - "Wikipedia APIに接続できません。インターネット接続を確認してください。"
  - Add tooltips explaining each difficulty preset:
    - "初級: 人気のある記事。到達しやすいです。"
    - "上級: マイナーな記事。専門的な知識が必要かもしれません。"
  - Add tooltips explaining each custom metric:
    - "被リンク数: 他の記事からこの記事へのリンク数。多いほど中心性が高く、到達しやすい。"
  - Add keyboard accessibility (Tab navigation, Enter to select)
  - Ensure mobile-friendly touch targets (min 44px)
  - Add visual feedback for successful random fetch (brief green flash on target field)

  **Must NOT do**:
  - Do NOT add animated transitions that delay gameplay
  - Do NOT add sound effects

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI polish requiring attention to UX details, accessibility, and responsive design
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T11)
  - **Parallel Group**: Wave 3 (with Tasks 12, 13)
  - **Blocks**: None
  - **Blocked By**: Tasks 11, 12

  **References**:
  - `src/App.tsx:256-259` - Existing `showToast` pattern
  - `src/App.tsx:845-851` - Current random button implementation
  - Lucide-react icons: `Loader2`, `RefreshCw`, `Info`

  **Acceptance Criteria**:
  - [ ] Loading spinner appears during fetch
  - [ ] Error messages are user-friendly and in Japanese
  - [ ] Tooltips explain presets and metrics
  - [ ] Keyboard navigation works
  - [ ] Mobile touch targets are large enough

  **QA Scenarios**:
  ```
  Scenario: Loading state shows
    Tool: Playwright
    Steps:
      1. Click "ランダム取得"
      2. Observe button state before response
    Expected Result: Button shows spinner, disabled state
    Evidence: .sisyphus/evidence/task-14-loading.png

  Scenario: Error handling
    Tool: Playwright
    Steps:
      1. Stop server
      2. Click "ランダム取得"
    Expected Result: Toast error message appears
    Evidence: .sisyphus/evidence/task-14-error.png
  ```

  **Commit**: YES
  - Message: `feat(difficulty): add loading states, errors, and polish`
  - Files: `src/App.tsx`, `src/components/DifficultySelector.tsx`, `src/components/CustomDifficultyPanel.tsx`

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + review changed files for `as any`, empty catches, console.log, unused imports, AI slop patterns.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Execute EVERY QA scenario from EVERY task. Test cross-task integration. Test edge cases: empty DB, invalid weights, API failures.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 compliance. Check "Must NOT do" compliance.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- Wave 1 commits: `feat(difficulty): add types, db schema, and api fetcher`
- Wave 2 commits: `feat(difficulty): implement scoring engine, batch collection, and api routes`
- Wave 3 commits: `feat(difficulty): integrate ui and online sync`
- Final commit: `feat(difficulty): add target page difficulty-based random selection`

---

## Success Criteria

### Verification Commands
```bash
# Check API is running
curl http://localhost:3011/api/difficulty/presets

# Check random with difficulty
curl "http://localhost:3011/api/random?difficulty=medium"

# Check custom difficulty
curl -X POST http://localhost:3011/api/difficulty/custom \
  -H "Content-Type: application/json" \
  -d '{"backlinksMin":100,"backlinksMax":1000,"pageviewsMin":1000}'

# Check TypeScript compilation
npx tsc --noEmit
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All API endpoints return correct data
- [ ] UI allows preset selection and custom settings
- [ ] Online multiplayer syncs difficulty settings
- [ ] SQLite database persists across server restarts
