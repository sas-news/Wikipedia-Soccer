# Wikipedia Soccer - 連想ペア出題

2人対戦型Wikipediaレースゲーム。2人のゴール記事を「連想距離がちょうど良いペア」としてセットで抽選します。

## 機能

- **ペア出題**: P1・P2のゴールを連想ペアとしてまとめて抽選（やさしい/ちょうど良い/難しい）
- **対称スタート**: 両ゴールからの距離が均衡なスタートページ候補を提示
- **オンライン対戦**: Socket.ioによるリアルタイム対戦
- **ゴールプール内訳**: 収録記事・帯別ペア分布・記事ごとのペア詳細を閲覧

## インストール

```bash
npm install
gzip -dkf data/difficulty.db.gz  # プールDB展開（同梱アーカイブから）
```

## 開発サーバーの起動

```bash
npm run dev
```

サーバーが `http://localhost:3011` で起動します。

## 出題システム

ゴール記事は **記事プール**（カテゴリ層別サンプリングで収集した約3,000記事）から選ばれ、
全ペアの連結構造を前計算した `assoc_pairs` テーブルから抽選します。ゲーム中のWikipedia API呼び出しはありません。

### 難易度 = 関係の遠近 × 語の易しさ

| プリセット | 帯 | 語のゲート |
|---|---|---|
| やさしい | ideal（曲がり道が両方向あり、決闘点が少ない） | 有名語のみ（pv/被リンク上位＋難語系統除外＋短いタイトル） |
| ちょうど良い | ideal | 中堅語まで |
| 難しい | hard（近接だが曲がり道が少ない、3手経路はある） | なし |

### 帯の定義

- **near**: direct link または duel≥4 → 近すぎ（先番勝ち）
- **ideal**: duel≤3 かつ同/隣接ドメイン かつ bendが両方向≥1または合計≥3
- **hard**: duel≤1, bend≤1, paths3≥10, 同/隣接ドメイン → 遠いが届く
- **weak/far**: 出題しない

## API エンドポイント

| メソッド | エンドポイント | 説明 |
|---------|--------------|------|
| GET | `/api/match?difficulty=easy\|medium\|hard` | ペア抽選（`&a=タイトル` でA固定のB探し） |
| GET | `/api/random` | 完全ランダム記事（スタートページ用） |
| GET | `/api/pool/stats` | プール統計 |
| GET | `/api/pool/articles?band=&q=` | プール記事一覧 |
| GET | `/api/pool/pairs?a=` | 記事のペア詳細 |

## プールDBの再生成

```bash
npx tsx src/server/pool-collect.ts --fresh   # プール収集（~10分、POOL_LIMITで規模変更可）
npx tsx src/server/assoc.ts                   # ペア前計算
gzip -kf data/difficulty.db                   # 同梱用アーカイブ更新
```

GitHub Actions の `pool-refresh` ワークフローが月次で自動実行し、成果物をmainにコミットします（Render自動デプロイで公開に反映）。

## 技術スタック

- **Frontend**: React 19 + TypeScript + TailwindCSS + Vite
- **Backend**: Express + Socket.io + better-sqlite3
- **API**: MediaWiki API + Wikimedia REST API（オフライン収集時のみ）

## デプロイ

`DEPLOY.md` 参照。Render無料枠 + `render.yaml` Blueprint。

## プロジェクト構成

```
src/
  server/
    db.ts                  # SQLite接続
    pool.ts                # プール/ペアのスキーマ＋クエリ
    pool-collect.ts        # プール収集スクリプト
    assoc.ts               # 連想ペア前計算
    domains.ts             # ドメイン分類
    wiki-api.ts            # Wikipedia APIラッパー（ランダム記事のみ）
    routes/
      match.ts             # ペア抽選API
      pool.ts              # プ���ル内訳API
  components/
    ArticleInspector.tsx   # ゴールプール内訳ページ
  App.tsx                  # メインアプリ
server.ts                  # サーバー起動
```
