import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initDatabase } from './src/server/db';
import { initPoolSchema } from './src/server/pool';
import { fetchRandomArticles } from './src/server/wiki-api';
import matchRoutes from './src/server/routes/match';
import poolRoutes from './src/server/routes/pool';

async function startServer() {
  initDatabase();
  initPoolSchema();

  const app = express();
  app.use(express.json());

  const PORT = Number(process.env.PORT) || 3011;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  // ルームの座席管理: socket.idを席に紐付け、切断では席だけ空ける。
  // 観戦者の出入りは対戦に影響させない。
  interface RoomSeats { p1: string | null; p2: string | null }
  const roomSeats = new Map<string, RoomSeats>();
  const roomStates = new Map<string, Record<string, unknown>>();
  const roomRecords = new Map<string, unknown[]>();
  const roomSuspended = new Set<string>();
  const socketRoles = new Map<string, { roomId: string; role: 1 | 2 | 'spectator' }>();
  const explicitQuit = new Set<string>();
  // プレイヤー席が回線断で空いている部屋（フェーズに関係なく復帰を検知するため）
  const roomPeerGone = new Set<string>();

  io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    const inRoom = (roomId: unknown): roomId is string =>
      typeof roomId === 'string' && socket.rooms.has(roomId);
    // 状態を変更するイベントはプレイヤー席のみ許可（観戦者は操作不可）
    const playerInRoom = (roomId: unknown): roomId is string => {
      const info = socketRoles.get(socket.id);
      return inRoom(roomId) && info?.roomId === roomId && info.role !== 'spectator';
    };

    socket.on('join_room', (roomId: string) => {
      if (socketRoles.has(socket.id)) return; // 二重参加は無視
      if (typeof roomId !== 'string') return;
      roomId = roomId.trim().slice(0, 64);
      if (!roomId) return;

      let seats = roomSeats.get(roomId);
      if (!seats) {
        seats = { p1: null, p2: null };
        roomSeats.set(roomId, seats);
      }

      let playerNum: 1 | 2 | 'spectator';
      if (!seats.p1) {
        seats.p1 = socket.id;
        playerNum = 1;
      } else if (!seats.p2) {
        seats.p2 = socket.id;
        playerNum = 2;
      } else {
        playerNum = 'spectator';
      }

      socket.join(roomId);
      socketRoles.set(socket.id, { roomId, role: playerNum });
      socket.emit('joined', { playerNum, roomId });

      const state = roomStates.get(roomId);
      // 開始済みフェーズへの復帰は game_ready を発火せず状態同期だけにする
      const inPlay = state?.phase === 'playing' || state?.phase === 'won' || state?.phase === 'confirm';
      if (playerNum !== 'spectator' && seats.p1 && seats.p2 && !inPlay) {
        // 両席が埋まった時だけ開始（観戦者参加では発火しない）
        io.to(roomId).emit('game_ready');
      }
      // 回線断で空いたプレイヤー席が再び埋まった → フェーズ問わず相手に復帰を通知
      if (playerNum !== 'spectator' && roomPeerGone.has(roomId)) {
        roomPeerGone.delete(roomId);
        socket.to(roomId).emit('peer_rejoined');
      }
      if (state) socket.emit('sync_state', state);
      const records = roomRecords.get(roomId);
      if (records) socket.emit('sync_records', records);
      if (roomSuspended.has(roomId)) socket.emit('suspend');
    });

    // 明示的な退出（保存して中断等）: 相手をタイトルへ戻す。観戦者の退出は通知しない
    socket.on('leave_room', (data) => {
      explicitQuit.add(socket.id);
      const info = socketRoles.get(socket.id);
      if (info?.role === 'spectator') return;
      const roomId = info?.roomId ?? data?.roomId;
      if (roomId) socket.to(roomId).emit('player_disconnected', socket.id);
    });

    socket.on('sync_state', (data) => {
      if (!data || !playerInRoom(data.roomId)) return;
      // 部分更新をマージして保持: 途中参加者・復帰者に完全な状態を届けるため
      const prev = roomStates.get(data.roomId) || {};
      roomStates.set(data.roomId, { ...prev, ...(data.state || {}) });
      socket.to(data.roomId).emit('sync_state', data.state);
    });

    socket.on('sync_scroll', (data) => {
      if (!playerInRoom(data?.roomId)) return;
      socket.to(data.roomId).emit('sync_scroll', data);
    });

    socket.on('sync_cursor', (data) => {
      if (!playerInRoom(data?.roomId)) return;
      socket.to(data.roomId).emit('sync_cursor', data);
    });

    socket.on('suspend', (data) => {
      if (!playerInRoom(data?.roomId)) return;
      roomSuspended.add(data.roomId);
      socket.to(data.roomId).emit('suspend');
    });

    socket.on('resume', (data) => {
      if (!playerInRoom(data?.roomId)) return;
      roomSuspended.delete(data.roomId);
      socket.to(data.roomId).emit('resume');
    });

    socket.on('undo_request', (data) => {
      if (!playerInRoom(data?.roomId)) return;
      socket.to(data.roomId).emit('undo_request', { fromPlayer: data.fromPlayer });
    });

    socket.on('undo_accept', (data) => {
      if (!playerInRoom(data?.roomId)) return;
      socket.to(data.roomId).emit('undo_accept');
    });

    socket.on('undo_deny', (data) => {
      if (!playerInRoom(data?.roomId)) return;
      socket.to(data.roomId).emit('undo_deny');
    });

    socket.on('sync_record', (data) => {
      if (!data || !playerInRoom(data.roomId)) return;
      const records = roomRecords.get(data.roomId) || [];
      records.unshift(data.record);
      roomRecords.set(data.roomId, records.slice(0, 50));
      io.to(data.roomId).emit('sync_records', records);
    });

    socket.on('disconnecting', () => {
      const info = socketRoles.get(socket.id);
      socketRoles.delete(socket.id);
      if (!info) return;
      const { roomId, role } = info;

      const seats = roomSeats.get(roomId);
      if (seats) {
        if (role === 1) seats.p1 = null;
        if (role === 2) seats.p2 = null;
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
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  // Wikipedia Proxy Route
  app.get('/proxy/wiki/*', async (req, res) => {
    try {
      const wikiPath = req.params[0];
      const url = `https://ja.wikipedia.org/wiki/${encodeURIComponent(wikiPath)}`;
      
      console.log('Proxying:', url);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': 'WikipediaSoccerGame/1.0 (Integration/Proxy)',
        }
      });
      
      if (!response.ok) {
        try {
          const randomRes = await fetch(`https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&_cb=${Date.now()}`, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'WikipediaSoccerGame/1.0 (Integration/Proxy)' },
          });
          const randomData = await randomRes.json();
          const fallbackTitle = randomData.query.random[0].title;
          return res.redirect(`/proxy/wiki/${encodeURIComponent(fallbackTitle)}`);
        } catch (e) {
          return res.status(response.status).send(`Failed to fetch from Wikipedia: ${response.statusText}`);
        }
      }

      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('text/html')) {
        // Just pipe non-HTML resources if any somehow got here
        const arrayBuffer = await response.arrayBuffer();
        res.set('Content-Type', contentType);
        return res.send(Buffer.from(arrayBuffer));
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

          // Intercept all link clicks
          document.addEventListener('click', function(e) {
            const a = e.target.closest('a');
            if (!a) return;
            
            const hrefAtt = a.getAttribute('href');
            if (!hrefAtt) return;
            
            // Allow anchor links (toc, notes) to work normally within the frame
            if (hrefAtt.startsWith('#')) {
              e.preventDefault();
              try {
                // Handle percentage-encoded IDs which are common in Wikipedia
                const targetId = decodeURIComponent(hrefAtt.substring(1));
                const targetEl = document.getElementById(targetId) || document.getElementById(hrefAtt.substring(1));
                if (targetEl) targetEl.scrollIntoView();
              } catch (err) {
                console.error('Anchor navigation error:', err);
              }
              return;
            }
            
            e.preventDefault(); // Stop normal navigation
            
            try {
              const url = new URL(a.href);
              if (url.pathname.startsWith('/wiki/')) {
                const title = url.pathname.replace('/wiki/', '');
                // Exclude namespace pages (containing colon)
                if (title.includes(':')) {
                  console.log('Blocked namespace:', title);
                  return;
                }
                window.parent.postMessage({ type: 'WIKI_LINK_CLICK', title: title }, '*');
              }
            } catch(err) {
              console.error(err);
            }
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
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      
      res.send(html);

    } catch (e) {
      console.error('Proxy Error:', e);
      res.status(500).send('Proxy error');
    }
  });

  // スタートページ用の完全ランダム記事（難易度指定は廃止：出題は /api/match に一本化）
  app.get('/api/random', async (_req, res) => {
    try {
      const titles = await fetchRandomArticles(1, { noCache: true });
      res.json({ title: titles[0] });
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch random page' });
    }
  });

  // Associative pair-draw API
  app.use('/api', matchRoutes);
  app.use('/api', poolRoutes);

  // Render etc. のヘルスチェック用
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
