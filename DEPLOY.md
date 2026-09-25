# デプロイ（Render 無料枠）

初回だけ手作業（約5分）。以降は `main` への push で自動デプロイされます。

## 初回セットアップ

1. https://render.com で GitHub アカウント連携してログイン
2. ダッシュボード → **New** → **Blueprint**
3. このリポジトリを選択 → `render.yaml` が検出されるので **Apply**
4. `wikipedia-soccer` サービスが作成され、`https://wikipedia-soccer-XXXX.onrender.com` で公開

## 構成

- **ランタイム**: Node 20 / `npm run build`（Vite）→ `npm run start`（tsx で Express+Socket.io）
- **WebSocket**: Render は標準で WebSocket 対応。追加設定は不要
- **DB**: `data/difficulty.db.gz`（ゴールプール+連想ペアの前計算済み SQLite）をリポジトリに同梱し、ビルド時に展開。無料枠のファイルシステムはエフェメラルなので、実行時に DB へ書き込んでも次回デプロイで消えますが、本アプリの DB は事前計算データなので問題ありません
- **ヘルスチェック**: `/healthz`

## データ更新（GitHub Actions）

`.github/workflows/pool-refresh.yml` が毎月1日（または Actions タブから手動実行）に
プール収集 `pool-collect` → ペア前計算 `assoc` → `data/difficulty.db.gz` を main にコミットします。
main への push = Render の自動デプロイが走るので、データ更新→公開まで自動です。

初回公開前に Actions タブで `Pool DB refresh` を **Run workflow** してください
（リポジトリに DB がまだ無い場合、ペア出題はフォールバック動作になります）。
収集規模を変えたい場合は Repository Variables に `POOL_LIMIT` を設定してください（未設定=全件）。

## 無料枠の注意点

- **15分無操作でスリープ**します。再アクセス時に数十秒のコールドスタートが入ります。
  **重要**: ルームの対戦状態はすべてサーバーのメモリ上にあり、スリープ・再起動・デプロイで **進行中の対戦は全滅します**。対戦中に両者が15分間操作しないとルームは消えます（切断後の復帰猶予は10分）。スリープを許容しない場合は UptimeRobot 等で `/healthz` に定期 ping して常時稼働させてください。
- 月750時間まで無料。UptimeRobot で常時稼働させるとこの枠をほぼ使い切る点に注意（残りはデプロイやスリープ復帰の分）。
