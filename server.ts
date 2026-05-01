import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';

async function startServer() {
  const app = express();
  const PORT = 3011;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  const roomStates = new Map<string, any>();
  const roomRecords = new Map<string, any[]>();

  // Socket.IO Logic
  io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_room', (roomId: string) => {
      const room = io.sockets.adapter.rooms.get(roomId);
      const numClients = room ? room.size : 0;

      socket.join(roomId);
      let playerNum: number | 'spectator';
      
      if (numClients === 0) {
        playerNum = 1;
      } else if (numClients === 1) {
        playerNum = 2;
      } else {
        playerNum = 'spectator';
      }
      
      socket.emit('joined', { playerNum });

      if (numClients === 1) { // 2nd player joined
        io.to(roomId).emit('game_ready');
      }
      
      if (roomStates.has(roomId)) {
        socket.emit('sync_state', roomStates.get(roomId));
      }
      if (roomRecords.has(roomId)) {
        socket.emit('sync_records', roomRecords.get(roomId));
      }
    });

    socket.on('sync_state', (data) => {
      roomStates.set(data.roomId, data.state);
      socket.to(data.roomId).emit('sync_state', data.state);
    });

    socket.on('sync_scroll', (data) => {
      socket.to(data.roomId).emit('sync_scroll', data);
    });

    socket.on('sync_cursor', (data) => {
      socket.to(data.roomId).emit('sync_cursor', data);
    });

    socket.on('suspend', (data) => {
      socket.to(data.roomId).emit('suspend');
    });

    socket.on('resume', (data) => {
      socket.to(data.roomId).emit('resume');
    });

    socket.on('undo_request', (data) => {
      socket.to(data.roomId).emit('undo_request', { fromPlayer: data.fromPlayer });
    });

    socket.on('undo_accept', (data) => {
      socket.to(data.roomId).emit('undo_accept');
    });

    socket.on('undo_deny', (data) => {
      socket.to(data.roomId).emit('undo_deny');
    });

    socket.on('sync_record', (data) => {
      const records = roomRecords.get(data.roomId) || [];
      records.unshift(data.record);
      roomRecords.set(data.roomId, records.slice(0, 50));
      io.to(data.roomId).emit('sync_records', records);
    });

    socket.on('disconnecting', () => {
      socket.rooms.forEach((roomId) => {
        if (roomId !== socket.id) {
          io.to(roomId).emit('player_disconnected', socket.id);
          const room = io.sockets.adapter.rooms.get(roomId);
          if (room && room.size <= 1) {
            roomStates.delete(roomId);
          }
        }
      });
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
        headers: {
          'User-Agent': 'WikipediaSoccerGame/1.0 (Integration/Proxy)',
        }
      });
      
      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch from Wikipedia: ${response.statusText}`);
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

  // API to get a random article (excluding special pages/categories)
  app.get('/api/random', async (req, res) => {
    try {
      const url = 'https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json';
      const response = await fetch(url);
      const data = await response.json();
      res.json({ title: data.query.random[0].title });
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch random page' });
    }
  });

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
