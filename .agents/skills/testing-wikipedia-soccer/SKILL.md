---
name: testing-wikipedia-soccer
description: How to run and end-to-end test the Wikipedia Soccer app (Express+Socket.io+SQLite backend, Vite frontend, Japanese UI) including the assoc-pair band system and ゴールプール内訳 page.
---

# Testing Wikipedia Soccer

## Run the app
- `npm install` (blueprint already does this).
- DB: `data/difficulty.db` must exist — if absent run `gzip -dkf data/difficulty.db.gz`. It holds `pool_articles` (~3.2k) and `assoc_pairs` (~488k).
- Server: `npm run dev` (tsx server.ts + Vite middleware) or `npm run start` (production, serves dist/). Port **3011**.
- No login/auth needed; all screens reachable by clicking.

## Key UI paths
- Settings screen (initial): "目標設定に進む" → setup screen; "ゴールプール内訳を見る" → inspector page (`ArticleInspector`).
- Setup screen: purple "ペアで出題" box — select {やさしい=easy, ちょうど良い=medium, 難しい（遠いが届く）=hard} + "抽選" button. Result hint shows "{ちょうど良い|難しい}帯で抽選 / 対称スタート候補: X". Drawn pair fills P1/P2 targets (expand "Player 1 を設定"/"Player 2 を設定" to reveal them).
- Setup has NO back button — reload the page to return to settings (safe: save data is only written by explicit "save & quit" during play).

## Pair band system (data/difficulty.db)
- Bands: `ideal`(ちょうど良い), `hard`(難しい), `near`(近すぎ), `weak`(関連薄め).
- `/api/match?difficulty=<preset|band>[&a=<title>]` returns `{a,b,band,start,stats}`. Presets: very_easy/easy/medium→ideal; hard/very_hard→hard.
- IMPORTANT quirk: literal band names (`?difficulty=ideal|hard|weak`) short-circuit to that band ONLY — no fallback. Fallback `['hard','ideal']` only fires for preset `very_hard`; the UI's hard option sends literal `hard`, so hard draws NEVER fall back to ideal (pre-existing behavior, not the PR's bug).
- Deterministic probe articles (from this DB): `OECD生徒の学習到達度調査` has hard pairs but ZERO ideal → `?difficulty=medium&a=…` must 404 (a leak would return a hard pair). `アントルメ` has ideal pairs but zero hard → `?difficulty=very_hard&a=…` must return band=ideal (proves fallback path).
- Spot-check pair sanity via `/api/pair?a=..&b=..` → returns band + bend/duel/paths3/domRel; ideal pairs show domRel same/adjacent.
- Adversarial sampling: ~1.9% of eligible articles have hard-only pairs, so a handful of medium draws can't prove the leak is gone — run ~200 `difficulty=medium` draws and count bands (expect 100% ideal).

## ゴールプール内訳 (inspector) expectations
- Stats from `/api/pool/stats`: 収録記事 3,179 / 出題資格あり 1,423 / プール内リンク 560,287 / 連想ペア総数 488,476 / byBand {ideal 46,682, hard 95,172, near 56,438, weak 290,184}.
- Band filter buttons re-filter table; ペア数 column shows that band's count. Search filters by title substring (`q=`). Click a row → expands pair list (band badge + bend x/y・duel・3手・domRel・直結).

## Online multiplayer E2E (2+ tabs, Socket.io rooms)
- Join flow: settings → オンライン対戦 → type a Room ID (ASCII only, e.g. "e2e-room-01") → ルームに参加/作成. First joiner gets P1 seat +「対戦相手を待っています…」waiting screen; second joiner gets P2 → both clients jump to 目標ページの設定 (`game_ready`). Third joiner becomes spectator — lands directly in play with「観戦中 - Player Xのターン」banner.
- In online setup the pair-draw box appears ONLY on P1's screen; P1's 抽選 auto-fills P2's 目標 box via `pairTargets` sync. P2's confirm screen shows「Player 1の開始を待機中...」(disabled) — only P1 can press Game Start.
- Turn guard: while it is P1's turn, wiki-link clicks on P2's tab do nothing except toast「相手のターン中です」.
- Disconnect/rejoin: closing a player's tab broadcasts `peer_left` → survivors show「相手との通信が切れました」overlay and timers/clicks freeze. Rejoining the same Room ID drops the player straight back into the running game (merged `sync_state` replay incl. pairTargets → their goal is restored — eye-hold reveals it). Rejoin broadcasts `peer_rejoined` → overlay clears, timer resumes.
- Explicit leave mid-game: only path is「待たずにタイトルへ戻る」on the peer_left overlay — emits `leave_room` → remaining members get `player_disconnected` → toast「相手が退出しました」→ back to settings.
- Coordinate notes (maximized 1024x768 Chrome): Room ID field ~(510,399), join btn ~(511,441), 抽選 ~(601,412), 設定完了 ~(511,541), Game Start ~(511,510), ターン終了 ~(965,80), eye/目標確認 ~(25,88), 待たずにタイトルへ戻る ~(511,457), tabs at y≈13.

## Gotchas
- xdotool `type` cannot enter Japanese into inputs — search with a Latin term (e.g. "Devin") to exercise UI search; verify Japanese queries via `/api/pool/articles?q=` directly.
- Room ID input RETAINS its text — typing appends (created "e2e-room-01e2e-room-02" once). Always triple_click or ctrl+a before typing a new ID.
- WikiAutocomplete dropdown auto-opens when pairTargets fills the 目標 field programmatically; blur never fires because the input never had focus — dismiss by clicking one of the suggestion items.
- 目標確認 eye button is press-and-hold, not a toggle: `mouse_move` to it, `left_mouse_down` (no coordinate — uses cursor pos), screenshot, `left_mouse_up`.
- Browser tab-strip trap: clicking the ALREADY-ACTIVE tab re-shows that same tab — a "second waiting screen" was once a misdiagnosed same-tab view. Verify you're on the intended tab before reading state.
- Turn timers count locally per client; after a rejoin they diverge cosmetically (e.g. P1 shows 0秒 while P2 shows ~45s) — the authoritative turn still advances via the active player's timer. Not a bug, but confusing in screenshots.
- pairTargets persist into a NEW room's setup fields until the next 抽選 overwrites them — cosmetic staleness, not a desync.
- Pair links open ja.wikipedia.org in a new tab (target=_blank).
