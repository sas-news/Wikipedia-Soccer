import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  // Socket.IO Logic
  io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_room', (roomId: string) => {
      const room = io.sockets.adapter.rooms.get(roomId);
      const numClients = room ? room.size : 0;

      if (numClients >= 2) {
        socket.emit('room_full');
        return;
      }

      socket.join(roomId);
      const playerNum = numClients === 0 ? 1 : 2;
      socket.emit('joined', { playerNum });

      if (playerNum === 2) {
        io.to(roomId).emit('game_ready');
      }
    });

    socket.on('sync_state', (data) => {
      socket.to(data.roomId).emit('sync_state', data.state);
    });

    socket.on('sync_scroll', (data) => {
      socket.to(data.roomId).emit('sync_scroll', data);
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
          window.addEventListener('message', function(e) {
            if (e.data.type === 'SYNC_SCROLL') {
              window.scrollTo(0, e.data.scrollY);
            }
          });

          // Report scrolling to parent
          let scrollTimeout;
          window.addEventListener('scroll', function() {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
              window.parent.postMessage({ type: 'WIKI_SCROLL', scrollY: window.scrollY }, '*');
            }, 50);
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
