import express from 'express';
import compression from 'compression';
import path from 'path';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { initDatabase, closeDatabase } from './src/server/db';
import { initPoolSchema } from './src/server/pool';
import { fetchRandomArticles } from './src/server/wiki-api';
import matchRoutes from './src/server/routes/match';
import poolRoutes from './src/server/routes/pool';

/** プロキシのページキャッシュ（記事は頻繁に書き換わらない前提の短命キャッシュ） */
const WIKI_CACHE_TTL = 5 * 60 * 1000;
const WIKI_CACHE_MAX = 300;
const wikiCache = new Map<string, { body: Buffer | string; contentType: string; expiry: number }>();
const wikiInflight = new Map<string, Promise<void>>();

function wikiCacheGet(key: string) {
  const e = wikiCache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiry) {
    wikiCache.delete(key);
    return undefined;
  }
  return e;
}
function wikiCacheSet(key: string, body: Buffer | string, contentType: string) {
  if (wikiCache.size >= WIKI_CACHE_MAX) {
    // 簡易LRU: 先頭（最も古い挿入順）を捨てる
    const oldest = wikiCache.keys().next().value;
    if (oldest !== undefined) wikiCache.delete(oldest);
  }
  wikiCache.set(key, { body, contentType, expiry: Date.now() + WIKI_CACHE_TTL });
}

/** 単純なIPレート制限（Render等のリバプロ配下で trust proxy=1 前提） */
function makeRateLimiter(maxPerMin: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    const e = hits.get(ip);
    if (!e || now > e.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    e.count += 1;
    return e.count <= maxPerMin;
  };
}
const proxyLimiter = makeRateLimiter(180);

/** ソケットイベントの簡易スロットル: 1秒あたりの発火上限 */
function makeSocketThrottle(perSec: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (socketId: string): boolean => {
    const now = Date.now();
    const b = buckets.get(socketId);
    if (!b || now > b.resetAt) {
      buckets.set(socketId, { count: 1, resetAt: now + 1000 });
      return true;
    }
    b.count += 1;
    return b.count <= perSec;
  };
}

const WIKI_PAGE_UA =
  'WikipediaSoccerGame/1.0 (https://github.com/sas-news/Wikipedia-Soccer; in-game proxy)';

async function startServer() {
  initDatabase();
  initPoolSchema();

  const app = express();
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(express.json());

  const PORT = Number(process.env.PORT) || 3011;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    // 切断検知を早める（既定 interval 25s/timeout 20s → 最大45秒遅れを抑える）
    pingInterval: 10000,
    pingTimeout: 10000,
  });

  // ルームの座席管理: 席はクライアント提示の token に紐付け、socket.id は占有中のみ保持。
  // 回線断で席は「claims」に残り、同 token の復帰のみその席を取り戻せる（一定時間後は他人も可）。
  // 観戦者の出入りは対戦に影響させない。
  interface Seat { sid: string | null; token: string | null }
  interface RoomSeats { p1: Seat; p2: Seat }
  const roomSeats = new Map<string, RoomSeats>();
  const roomStates = new Map<string, Record<string, unknown>>();
  const roomRecords = new Map<string, unknown[]>();
  const roomSuspended = new Set<string>();
  const socketRoles = new Map<string, { roomId: string; role: 1 | 2 | 'spectator' }>();
  const explicitQuit = new Set<string>();
  // プレイヤー席が回線断で空いている部屋（フェーズに関係なく復帰を検知するため）
  const roomPeerGone = new Set<string>();
  // 席の請求: 切断しても token を一定時間保持し、復帰を優先する。
  // キーは `${roomId}:${seat}` で席ごと独立（両者同時断で上書きされないよう）
  const SEAT_CLAIM_MS = 10 * 60 * 1000;
  const seatClaims = new Map<string, { token: string; until: number }>();
  const claimKey = (roomId: string, seat: 'p1' | 'p2') => `${roomId}:${seat}`;
  const newRoomSeats = (): RoomSeats => ({
    p1: { sid: null, token: null },
    p2: { sid: null, token: null },
  });

  /** sync_state を受信者ロール別にフィルタする。
   *  ゴールは観戦者には送らない。プレイヤー同士は両方のゴールを受け取る
   * （開始手続き・対称スタート選択・レコード作成が相手ゴールに依存するため）。
   *  UI上の秘匿はHiddenTargetItemのマスクで担保する。'won' では全公開。 */
  const TARGET_KEYS = ['p1Target', 'p2Target', 'pairTargets'];
  function filterStateForRole(
    roomId: string,
    state: Record<string, unknown>,
    role: 1 | 2 | 'spectator' | undefined
  ): Record<string, unknown> {
    const merged = roomStates.get(roomId) ?? {};
    const phase = (state.phase as string | undefined) ?? (merged.phase as string | undefined);
    if (phase === 'won') return { ...state }; // 終局後は観戦者にも公開（結果画面用）
    if (!role || role === 'spectator') {
      const out = { ...state };
      for (const k of TARGET_KEYS) delete out[k];
      return out;
    }
    return { ...state };
  }

  /** roomId 内の全ソケット（送信者除く）にロール別フィルタ済み sync_state を配信 */
  function relaySyncState(senderId: string, roomId: string, state: Record<string, unknown>) {
    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room) return;
    // 終局時はマージ済みの全状態（両ゴール含む）を配って結果画面に使う
    if (state.phase === 'won') {
      const merged = roomStates.get(roomId) ?? state;
      for (const sid of room) {
        if (sid === senderId) continue;
        io.sockets.sockets.get(sid)?.emit('sync_state', merged);
      }
      return;
    }
    for (const sid of room) {
      if (sid === senderId) continue;
      const target = io.sockets.sockets.get(sid);
      if (!target) continue;
      target.emit('sync_state', filterStateForRole(roomId, state, socketRoles.get(sid)?.role));
    }
  }

  const throttleHigh = makeSocketThrottle(30); // scroll/cursor
  const throttleMid = makeSocketThrottle(10); // sync_state 等
  const throttleLow = makeSocketThrottle(5); // undo/suspend 等

  io.on('connection', (socket: Socket) => {
    console.log('A user connected:', socket.id);

    const inRoom = (roomId: unknown): roomId is string =>
      typeof roomId === 'string' && socket.rooms.has(roomId);
    // 状態を変更するイベントはプレイヤー席のみ許可（観戦者は操作不可）
    const playerInRoom = (roomId: unknown): roomId is string => {
      const info = socketRoles.get(socket.id);
      return inRoom(roomId) && info?.roomId === roomId && info.role !== 'spectator';
    };

    socket.on('join_room', (payload: unknown) => {
      if (socketRoles.has(socket.id)) return; // 二重参加は無視
      const raw = typeof payload === 'string' ? payload : (payload as { roomId?: unknown })?.roomId;
      const token =
        typeof payload === 'object' && payload !== null
          ? String((payload as { token?: unknown }).token ?? '').slice(0, 64) || null
          : null;
      if (typeof raw !== 'string') return;
      const roomId = raw.trim().toLowerCase().slice(0, 64);
      if (!roomId) return;

      let seats = roomSeats.get(roomId);
      if (!seats) {
        seats = newRoomSeats();
        roomSeats.set(roomId, seats);
      }

      // 席の請求権: 同 token の復帰は常に優先、他人は claim 期限切れ後のみ着席可
      const tryTake = (seatKey: 'p1' | 'p2'): boolean => {
        const seat = seats![seatKey];
        const claim = seatClaims.get(claimKey(roomId, seatKey));
        const claimActive = !!claim && Date.now() < claim.until;
        // 席の token と一致すれば本人とみなす（claim 有無に関わらず奪還可。
        // 接続断の検知前に復帰した場合も元の席に戻れる）
        const tokenMatches = !!token && seat.token === token;
        const canReclaim = tokenMatches || (claimActive && !!token && claim!.token === token);
        if (claimActive && !canReclaim) return false; // 他人の請求が残る席は取れない
        if (seat.sid) return canReclaim; // 占有席は本人のみ奪還可
        seat.sid = socket.id;
        seat.token = token;
        return true;
      };

      let playerNum: 1 | 2 | 'spectator';
      if (tryTake('p1')) {
        playerNum = 1;
      } else if (tryTake('p2')) {
        playerNum = 2;
      } else {
        playerNum = 'spectator';
      }

      // 奪還で幽霊ソケットを追い出す（サーバー切断のため相手は自動再接続しない）
      if (playerNum !== 'spectator') {
        const seat = seats[playerNum === 1 ? 'p1' : 'p2'];
        if (seat.sid !== socket.id && seat.sid !== null) {
          const ghost = io.sockets.sockets.get(seat.sid);
          seat.sid = socket.id;
          if (ghost) {
            socketRoles.delete(ghost.id); // ghost の disconnecting で席を空け直さないよう先に消す
            ghost.emit('evicted');
            ghost.disconnect(true);
          }
        }
        seatClaims.delete(claimKey(roomId, playerNum === 1 ? 'p1' : 'p2'));
      }

      socket.join(roomId);
      socketRoles.set(socket.id, { roomId, role: playerNum });
      socket.emit('joined', { playerNum, roomId });

      const state = roomStates.get(roomId);
      // 開始済みフェーズへの復帰は game_ready を発火せず状態同期だけにする
      const inPlay = state?.phase === 'playing' || state?.phase === 'won' || state?.phase === 'confirm';
      if (playerNum !== 'spectator' && seats.p1.sid && seats.p2.sid && !inPlay) {
        // 両席が埋まった時だけ開始（観戦者参加では発火しない）
        io.to(roomId).emit('game_ready');
      }
      // 回線断で空いたプレイヤー席が同 token で復帰した → フェーズ問わず相手に復帰を通知
      if (playerNum !== 'spectator' && roomPeerGone.has(roomId)) {
        roomPeerGone.delete(roomId);
        socket.to(roomId).emit('peer_rejoined');
      }
      if (state) socket.emit('sync_state', filterStateForRole(roomId, state, playerNum));
      const records = roomRecords.get(roomId);
      if (records) socket.emit('sync_records', records);
      if (roomSuspended.has(roomId)) socket.emit('suspend');
    });

    // 明示的な退出（保存して中断等）: 相手をタイトルへ戻す。観戦者の退出は通知しない
    socket.on('leave_room', (data: { roomId?: unknown } | undefined, ack?: unknown) => {
      explicitQuit.add(socket.id);
      const info = socketRoles.get(socket.id);
      if (info?.role !== 'spectator') {
        const roomId = info?.roomId ?? (typeof data?.roomId === 'string' ? data.roomId : undefined);
        if (roomId) socket.to(roomId).emit('player_disconnected', socket.id);
      }
      // ack でクライアントの即時 disconnect に先んじて通知を確実に届ける
      if (typeof ack === 'function') (ack as () => void)();
    });

    socket.on('sync_state', (data: { roomId?: unknown; state?: Record<string, unknown> } | undefined) => {
      if (!data || !playerInRoom(data.roomId)) return;
      if (!throttleMid(socket.id)) return;
      // 部分更新をマージして保持: 途中参加者・復帰者に完全な状態を届けるため
      const prev = roomStates.get(data.roomId) || {};
      const incoming = data.state || {};
      const next = { ...prev, ...incoming };
      // ゴールの新旧を整合: 新しいペア抽選は個別編集を打ち消し、個別編集は該当席のペア値を無効化
      const pt = next.pairTargets as { a?: string; b?: string } | undefined;
      if (incoming.pairTargets !== undefined) {
        delete next.p1Target;
        delete next.p2Target;
      } else if (pt) {
        if (incoming.p1Target !== undefined) delete pt.a;
        if (incoming.p2Target !== undefined) delete pt.b;
        if (pt.a === undefined && pt.b === undefined) delete next.pairTargets;
      }
      roomStates.set(data.roomId, next);
      relaySyncState(socket.id, data.roomId, incoming);
    });

    socket.on('sync_scroll', (data: { roomId?: unknown } | undefined) => {
      if (!playerInRoom(data?.roomId)) return;
      if (!throttleHigh(socket.id)) return;
      socket.to(data.roomId as string).emit('sync_scroll', data);
    });

    socket.on('sync_cursor', (data: { roomId?: unknown } | undefined) => {
      if (!playerInRoom(data?.roomId)) return;
      if (!throttleHigh(socket.id)) return;
      socket.to(data.roomId as string).emit('sync_cursor', data);
    });

    socket.on('suspend', (data: { roomId?: unknown } | undefined) => {
      if (!playerInRoom(data?.roomId)) return;
      if (!throttleLow(socket.id)) return;
      roomSuspended.add(data.roomId as string);
      socket.to(data.roomId as string).emit('suspend');
    });

    socket.on('resume', (data: { roomId?: unknown } | undefined) => {
      if (!playerInRoom(data?.roomId)) return;
      if (!throttleLow(socket.id)) return;
      roomSuspended.delete(data.roomId as string);
      socket.to(data.roomId as string).emit('resume');
    });

    socket.on('undo_request', (data: { roomId?: unknown; fromPlayer?: unknown } | undefined) => {
      if (!playerInRoom(data?.roomId)) return;
      if (!throttleLow(socket.id)) return;
      socket.to(data.roomId as string).emit('undo_request', { fromPlayer: data.fromPlayer });
    });

    socket.on('undo_accept', (data: { roomId?: unknown } | undefined) => {
      if (!playerInRoom(data?.roomId)) return;
      socket.to(data.roomId as string).emit('undo_accept');
    });

    socket.on('undo_deny', (data: { roomId?: unknown } | undefined) => {
      if (!playerInRoom(data?.roomId)) return;
      socket.to(data.roomId as string).emit('undo_deny');
    });

    socket.on('sync_record', (data: { roomId?: unknown; record?: unknown } | undefined) => {
      if (!data || !playerInRoom(data.roomId)) return;
      const merged = roomStates.get(data.roomId);
      // 終局前の記録送信は不正（ゴール漏洩・履歴汚染を防ぐため無視）
      if (merged?.phase !== 'won') return;
      // 欠損したゴール欄をルームの状態で補完する
      const rec = { ...(data.record as Record<string, unknown>) };
      const pt = (merged.pairTargets ?? {}) as { a?: string; b?: string };
      if (!rec.p1Target) rec.p1Target = pt.a ?? merged.p1Target ?? '';
      if (!rec.p2Target) rec.p2Target = pt.b ?? merged.p2Target ?? '';
      const records = roomRecords.get(data.roomId) || [];
      records.unshift(rec);
      roomRecords.set(data.roomId, records.slice(0, 50));
      io.to(data.roomId).emit('sync_records', records);
    });

    socket.on('disconnecting', () => {
      const info = socketRoles.get(socket.id);
      socketRoles.delete(socket.id);
      if (!info) return;
      const { roomId, role } = info;

      const seats = roomSeats.get(roomId);
      const seatKey = role === 1 ? 'p1' : role === 2 ? 'p2' : null;
      if (seats && seatKey) {
        const seat = seats[seatKey];
        if (seat.sid === socket.id) {
          // 席は空けるが token の請求は残し、同 token の復帰を優先する
          seatClaims.set(claimKey(roomId, seatKey), {
            token: seat.token ?? '',
            until: Date.now() + SEAT_CLAIM_MS,
          });
          seat.sid = null;
        }
      }
      // プレイヤーの切断は「復帰待ち」を通知（観戦者の出入りは何も送らない）
      if (role !== 'spectator' && !explicitQuit.has(socket.id)) {
        roomPeerGone.add(roomId);
        socket.to(roomId).emit('peer_left');
      }
      explicitQuit.delete(socket.id);

      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size <= 1) {
        roomSeats.delete(roomId);
        roomStates.delete(roomId);
        roomRecords.delete(roomId);
        roomSuspended.delete(roomId);
        roomPeerGone.delete(roomId);
        seatClaims.delete(claimKey(roomId, 'p1'));
        seatClaims.delete(claimKey(roomId, 'p2'));
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  // Wikipedia Proxy Route
  app.get('/proxy/wiki/*', async (req, res) => {
    try {
      const ip = req.ip || 'unknown';
      if (!proxyLimiter(ip)) {
        return res.status(429).send('Too many requests');
      }
      const wikiPath = (req.params as Record<number, string>)[0] ?? '';
      const cacheKey = wikiPath;
      const cached = wikiCacheGet(cacheKey);
      if (cached) {
        res.set('Content-Type', cached.contentType);
        return res.send(cached.body);
      }
      // 同タイトルの同時取得を束ねる
      const pending = wikiInflight.get(cacheKey);
      if (pending) {
        await pending;
        const hit = wikiCacheGet(cacheKey);
        if (hit) {
          res.set('Content-Type', hit.contentType);
          return res.send(hit.body);
        }
      }

      let resolveInflight: () => void = () => {};
      wikiInflight.set(cacheKey, new Promise<void>((r) => { resolveInflight = r; }));
      try {
        const url = `https://ja.wikipedia.org/wiki/${encodeURIComponent(wikiPath)}`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: {
            'User-Agent': WIKI_PAGE_UA,
          },
          redirect: 'manual',
        });

        // リダイレクト（改名・正規化）は追わず、最終タイトルをクライアントに返して
        // 進路側の再ナビゲーションに任せる（勝利判定・履歴のタイトル整合のため）
        if (response.status >= 300 && response.status < 400) {
          const loc = response.headers.get('location') || '';
          const m = loc.match(/\/wiki\/([^?#]+)/);
          if (m) {
            const finalTitle = decodeURIComponent(m[1]);
            return res.redirect(302, `/proxy/wiki/${encodeURIComponent(finalTitle)}`);
          }
          // /wiki/ 以外へのリダイレクト（外部ホスト等）は信用せず追わない
          return res.status(502).send('Unexpected redirect from Wikipedia');
        }

        if (!response.ok) {
          try {
            const randomRes = await fetch(
              `https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&_cb=${Date.now()}`,
              {
                signal: AbortSignal.timeout(15000),
                headers: { 'User-Agent': WIKI_PAGE_UA },
              }
            );
            const randomData = (await randomRes.json()) as { query?: { random?: Array<{ title: string }> } };
            const fallbackTitle = randomData.query?.random?.[0]?.title;
            if (!fallbackTitle) throw new Error('no random title');
            return res.redirect(`/proxy/wiki/${encodeURIComponent(fallbackTitle)}`);
          } catch (e) {
            return res
              .status(response.status)
              .send(`Failed to fetch from Wikipedia: ${response.statusText}`);
          }
        }

        const contentType = response.headers.get('content-type');
        if (contentType && !contentType.includes('text/html')) {
          // Just pipe non-HTML resources if any somehow got here
          const arrayBuffer = await response.arrayBuffer();
          const body = Buffer.from(arrayBuffer);
          wikiCacheSet(cacheKey, body, contentType);
          res.set('Content-Type', contentType);
          return res.send(body);
        }

        let html = await response.text();

        // Inject base tag so assets resolve correctly against wikipedia domain
        html = html.replace('<head>', '<head><base href="https://ja.wikipedia.org/" target="_self">');

        // Inject scripts and styles to adapt Wikipedia for our iframe game
        const script = `
        <style>
          /* Hide standard Wikipedia navigation and tools */
          #mw-head, #mw-panel, #p-personal, #footer, .mw-editsection, .vector-header-container, #vector-main-menu-dropdown { display: none !important; }
          /* Hide search and forms to prevent cheating */
          form, input, #p-search, .cdx-search-input, .vector-search-box { display: none !important; }
          #content { margin-left: 0 !important; margin-top: 0 !important; padding-top: 1rem !important; }
          body { background-color: #ffffff; }
        </style>
        <script>
          // Report the canonical title so the parent can score redirect hits
          try {
            var canon = (window.mw && mw.config && mw.config.get('wgTitle')) || '';
            if (!canon) {
              canon = (document.title || '').replace(/ - Wikipedia.*$/, '');
            }
            window.parent.postMessage({ type: 'WIKI_PAGE_INFO', title: canon }, '*');
          } catch (e) {}

          // Listen for scroll syncing from parent
          let isSyncingScroll = false;
          let syncScrollTimeout;
          window.addEventListener('message', function(e) {
            if (e.data.type === 'SYNC_SCROLL') {
              isSyncingScroll = true;
              window.scrollTo({ top: e.data.scrollY, behavior: 'smooth' });
              clearTimeout(syncScrollTimeout);
              syncScrollTimeout = setTimeout(() => {
                isSyncingScroll = false;
              }, 250);
            }
          });

          // Report scrolling to parent
          let ticking = false;
          window.addEventListener('scroll', function() {
            if (isSyncingScroll) return;
            if (!ticking) {
              window.requestAnimationFrame(function() {
                window.parent.postMessage({ type: 'WIKI_SCROLL', scrollY: window.scrollY }, '*');
                ticking = false;
              });
              ticking = true;
            }
          });

          function handleLinkActivation(e) {
            const a = e.target.closest('a');
            if (!a) return;
            const hrefAtt = a.getAttribute('href');
            if (!hrefAtt) { e.preventDefault(); return; }

            // Allow anchor links (toc, notes) to work normally within the frame
            if (hrefAtt.startsWith('#')) {
              e.preventDefault();
              try {
                const targetId = decodeURIComponent(hrefAtt.substring(1));
                const targetEl = document.getElementById(targetId) || document.getElementById(hrefAtt.substring(1));
                if (targetEl) targetEl.scrollIntoView();
              } catch (err) {
                console.error('Anchor navigation error:', err);
              }
              return;
            }

            e.preventDefault(); // Stop normal navigation (including middle-click)

            try {
              const url = new URL(a.href);
              if (url.pathname.startsWith('/wiki/')) {
                const title = url.pathname.replace('/wiki/', '');
                if (title.includes(':')) {
                  console.log('Blocked namespace:', title);
                  return;
                }
                window.parent.postMessage({ type: 'WIKI_LINK_CLICK', title: title }, '*');
              }
            } catch(err) {
              console.error(err);
            }
          }

          document.addEventListener('click', handleLinkActivation);
          // ホイールクリック/修飾キークリックでの新タブ迂回を塞ぐ
          document.addEventListener('auxclick', function(e) {
            if (e.button === 1) handleLinkActivation(e);
          });
          // リンク上のコンテキストメニュー経由の外部遷移も塞ぐ
          document.addEventListener('contextmenu', function(e) {
            if (e.target.closest('a')) e.preventDefault();
          });

          // Report cursor position
          let cursorTicking = false;
          function sendCursor(x, y) {
            if (!cursorTicking) {
              window.requestAnimationFrame(function() {
                window.parent.postMessage({
                  type: 'WIKI_CURSOR',
                  x: x / window.innerWidth,
                  y: y / window.innerHeight
                }, '*');
                cursorTicking = false;
              });
              cursorTicking = true;
            }
          }
          window.addEventListener('mousemove', function(e) {
            sendCursor(e.clientX, e.clientY);
          });
          window.addEventListener('touchmove', function(e) {
            if (e.touches.length > 0) {
              sendCursor(e.touches[0].clientX, e.touches[0].clientY);
            }
          });

          window.addEventListener('message', function(e) {
            if (e.data.type === 'GET_RANDOM_LINK') {
              var currentTitle = e.data.currentTitle || '';
              try { currentTitle = decodeURIComponent(currentTitle).replace(/_/g, ' '); } catch(err) {}
              var currentPathTitle = window.location.pathname.replace('/wiki/', '');
              try { currentPathTitle = decodeURIComponent(currentPathTitle).replace(/_/g, ' '); } catch(err) {}
              var mainPageTitles = ['メインページ', 'Main Page'];
              var pageTitle = document.title || '';
              var bodyText = document.body ? document.body.innerText : '';
              var isErrorPage = /エラー|Error|404|Not Found|項目はありません|does not exist/i.test(pageTitle) || /項目はありません|does not exist|このページは存在しません/i.test(bodyText);
              if (isErrorPage) {
                window.parent.postMessage({ type: 'RANDOM_LINK_RESULT', title: null }, '*');
                return;
              }
              var allLinks = Array.from(document.links);
              var validLinks = allLinks.filter(function(a) {
                try {
                  var url = new URL(a.href);
                  if (!url.pathname.startsWith('/wiki/')) return false;
                  var linkTitle = decodeURIComponent(url.pathname.replace('/wiki/', '')).replace(/_/g, ' ');
                  if (!linkTitle) return false;
                  if (linkTitle.includes(':')) return false;
                  if (linkTitle === currentTitle) return false;
                  if (linkTitle === currentPathTitle) return false;
                  for (var i = 0; i < mainPageTitles.length; i++) {
                    if (linkTitle === mainPageTitles[i]) return false;
                  }
                  return true;
                } catch(err) {
                  return false;
                }
              });
              if (validLinks.length > 0) {
                var randomLink = validLinks[Math.floor(Math.random() * validLinks.length)];
                var title = decodeURIComponent(new URL(randomLink.href).pathname.replace('/wiki/', '')).replace(/_/g, ' ');
                window.parent.postMessage({ type: 'RANDOM_LINK_RESULT', title: title }, '*');
              } else {
                window.parent.postMessage({ type: 'RANDOM_LINK_RESULT', title: null }, '*');
              }
            }
          });
        </script>
      `;
        html = html.replace('</body>', `${script}</body>`);

        // Important: Ensure no X-Frame-Options or CSP headers block our iframe
        const ct = 'text/html; charset=utf-8';
        wikiCacheSet(cacheKey, html, ct);
        res.set('Content-Type', ct);
        res.removeHeader('X-Frame-Options');
        res.removeHeader('Content-Security-Policy');

        res.send(html);
      } finally {
        resolveInflight();
        wikiInflight.delete(cacheKey);
      }
    } catch (e) {
      console.error('Proxy Error:', e);
      res.status(500).send('Proxy error');
    }
  });

  // スタートページ用の完全ランダム記事（難易度指定は廃止：出題は /api/match に一本化）
  app.get('/api/random', async (_req, res) => {
    try {
      const titles = await fetchRandomArticles(1);
      res.json({ title: titles[0] });
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch random page' });
    }
  });

  // Associative pair-draw API
  app.use('/api', matchRoutes);
  app.use('/api', poolRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // Render etc. のヘルスチェック用（稼働中ルーム数も併記）
  app.get('/healthz', (_req, res) =>
    res.json({ ok: true, rooms: roomSeats.size, sockets: io.engine.clientsCount })
  );

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    httpServer.close();
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
