"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var vite_1 = require("vite");
var path_1 = require("path");
var http_1 = require("http");
var socket_io_1 = require("socket.io");
function startServer() {
    return __awaiter(this, void 0, void 0, function () {
        var app, PORT, httpServer, io, vite, distPath_1;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    app = (0, express_1.default)();
                    PORT = 3000;
                    httpServer = (0, http_1.createServer)(app);
                    io = new socket_io_1.Server(httpServer, {
                        cors: { origin: '*' }
                    });
                    // Socket.IO Logic
                    io.on('connection', function (socket) {
                        console.log('A user connected:', socket.id);
                        socket.on('join_room', function (roomId) {
                            var room = io.sockets.adapter.rooms.get(roomId);
                            var numClients = room ? room.size : 0;
                            if (numClients >= 2) {
                                socket.emit('room_full');
                                return;
                            }
                            socket.join(roomId);
                            var playerNum = numClients === 0 ? 1 : 2;
                            socket.emit('joined', { playerNum: playerNum });
                            if (playerNum === 2) {
                                io.to(roomId).emit('game_ready');
                            }
                        });
                        socket.on('sync_state', function (data) {
                            socket.to(data.roomId).emit('sync_state', data.state);
                        });
                        socket.on('sync_scroll', function (data) {
                            socket.to(data.roomId).emit('sync_scroll', data);
                        });
                        socket.on('disconnect', function () {
                            console.log('User disconnected:', socket.id);
                        });
                    });
                    // Wikipedia Proxy Route
                    app.get('/proxy/wiki/*', function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                        var wikiPath, url, response, contentType, arrayBuffer, html, script, e_1;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 5, , 6]);
                                    wikiPath = req.params[0];
                                    url = "https://ja.wikipedia.org/wiki/".concat(encodeURIComponent(wikiPath));
                                    console.log('Proxying:', url);
                                    return [4 /*yield*/, fetch(url, {
                                            headers: {
                                                'User-Agent': 'WikipediaSoccerGame/1.0 (Integration/Proxy)',
                                            }
                                        })];
                                case 1:
                                    response = _a.sent();
                                    if (!response.ok) {
                                        return [2 /*return*/, res.status(response.status).send("Failed to fetch from Wikipedia: ".concat(response.statusText))];
                                    }
                                    contentType = response.headers.get('content-type');
                                    if (!(contentType && !contentType.includes('text/html'))) return [3 /*break*/, 3];
                                    return [4 /*yield*/, response.arrayBuffer()];
                                case 2:
                                    arrayBuffer = _a.sent();
                                    res.set('Content-Type', contentType);
                                    return [2 /*return*/, res.send(Buffer.from(arrayBuffer))];
                                case 3: return [4 /*yield*/, response.text()];
                                case 4:
                                    html = _a.sent();
                                    // Inject base tag so assets resolve correctly against wikipedia domain
                                    html = html.replace('<head>', '<head><base href="https://ja.wikipedia.org/" target="_self">');
                                    script = "\n        <style>\n          /* Hide standard Wikipedia navigation and tools */\n          #mw-head, #mw-panel, #p-personal, #footer, .mw-editsection, .vector-header-container, #vector-main-menu-dropdown { display: none !important; }\n          /* Hide search and forms to prevent cheating */\n          form, input, #p-search, .cdx-search-input, .vector-search-box { display: none !important; }\n          #content { margin-left: 0 !important; margin-top: 0 !important; padding-top: 1rem !important; }\n          body { background-color: #ffffff; }\n        </style>\n        <script>\n          // Listen for scroll syncing from parent\n          window.addEventListener('message', function(e) {\n            if (e.data.type === 'SYNC_SCROLL') {\n              window.scrollTo(0, e.data.scrollY);\n            }\n          });\n\n          // Report scrolling to parent\n          let scrollTimeout;\n          window.addEventListener('scroll', function() {\n            clearTimeout(scrollTimeout);\n            scrollTimeout = setTimeout(() => {\n              window.parent.postMessage({ type: 'WIKI_SCROLL', scrollY: window.scrollY }, '*');\n            }, 50);\n          });\n\n          // Intercept all link clicks\n          document.addEventListener('click', function(e) {\n            const a = e.target.closest('a');\n            if (!a) return;\n            \n            const hrefAtt = a.getAttribute('href');\n            if (!hrefAtt) return;\n            \n            // Allow anchor links (toc, notes) to work normally within the frame\n            if (hrefAtt.startsWith('#')) {\n              e.preventDefault();\n              try {\n                // Handle percentage-encoded IDs which are common in Wikipedia\n                const targetId = decodeURIComponent(hrefAtt.substring(1));\n                const targetEl = document.getElementById(targetId) || document.getElementById(hrefAtt.substring(1));\n                if (targetEl) targetEl.scrollIntoView();\n              } catch (err) {\n                console.error('Anchor navigation error:', err);\n              }\n              return;\n            }\n            \n            e.preventDefault(); // Stop normal navigation\n            \n            try {\n              const url = new URL(a.href);\n              if (url.pathname.startsWith('/wiki/')) {\n                const title = url.pathname.replace('/wiki/', '');\n                // Exclude namespace pages (containing colon)\n                if (title.includes(':')) {\n                  console.log('Blocked namespace:', title);\n                  return;\n                }\n                window.parent.postMessage({ type: 'WIKI_LINK_CLICK', title: title }, '*');\n              }\n            } catch(err) {\n              console.error(err);\n            }\n          });\n        </script>\n      ";
                                    html = html.replace('</body>', "".concat(script, "</body>"));
                                    // Important: Ensure no X-Frame-Options or CSP headers block our iframe
                                    res.set('Content-Type', 'text/html; charset=utf-8');
                                    res.removeHeader('X-Frame-Options');
                                    res.removeHeader('Content-Security-Policy');
                                    res.send(html);
                                    return [3 /*break*/, 6];
                                case 5:
                                    e_1 = _a.sent();
                                    console.error('Proxy Error:', e_1);
                                    res.status(500).send('Proxy error');
                                    return [3 /*break*/, 6];
                                case 6: return [2 /*return*/];
                            }
                        });
                    }); });
                    // API to get a random article (excluding special pages/categories)
                    app.get('/api/random', function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                        var url, response, data, e_2;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    _a.trys.push([0, 3, , 4]);
                                    url = 'https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json';
                                    return [4 /*yield*/, fetch(url)];
                                case 1:
                                    response = _a.sent();
                                    return [4 /*yield*/, response.json()];
                                case 2:
                                    data = _a.sent();
                                    res.json({ title: data.query.random[0].title });
                                    return [3 /*break*/, 4];
                                case 3:
                                    e_2 = _a.sent();
                                    res.status(500).json({ error: 'Failed to fetch random page' });
                                    return [3 /*break*/, 4];
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); });
                    if (!(process.env.NODE_ENV !== 'production')) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, vite_1.createServer)({
                            server: { middlewareMode: true },
                            appType: 'spa',
                        })];
                case 1:
                    vite = _a.sent();
                    app.use(vite.middlewares);
                    return [3 /*break*/, 3];
                case 2:
                    distPath_1 = path_1.default.join(process.cwd(), 'dist');
                    app.use(express_1.default.static(distPath_1));
                    app.get('*', function (req, res) {
                        res.sendFile(path_1.default.join(distPath_1, 'index.html'));
                    });
                    _a.label = 3;
                case 3:
                    httpServer.listen(PORT, '0.0.0.0', function () {
                        console.log("Server running on http://localhost:".concat(PORT));
                    });
                    return [2 /*return*/];
            }
        });
    });
}
startServer();
