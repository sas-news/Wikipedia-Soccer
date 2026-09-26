#!/usr/bin/env bash
# ゴールプールDB(data/difficulty.db)を GitHub Release "data-latest" から取得して展開する。
# DBはリポジトリに同梱しない（容量対策）。pool-refresh workflowが月次でこのアセットを更新する。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
curl -fsSL -o data/difficulty.db.gz \
  "https://github.com/sas-news/Wikipedia-Soccer/releases/download/data-latest/difficulty.db.gz"
gzip -dkf data/difficulty.db.gz
echo "data/difficulty.db を用意しました"
