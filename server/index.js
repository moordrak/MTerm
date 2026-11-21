// MTerm - web terminal i upravitelj datoteka
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as auth from './auth.js';
import { handleSshSocket, closeAllSsh } from './ssh.js';
import { handleFilesApi, readJson, closeAll } from './files.js';
import { initStorage, storageEnabled, loadStore, saveStore } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const NM = path.join(ROOT, 'node_modules');
const PORT = Number(process.env.PORT || process.env.MTERM_PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
initStorage(ROOT);

const VENDOR = {
  '/vendor/xterm.js': path.join(NM, '@xterm/xterm/lib/xterm.js'),
  '/vendor/xterm.css': path.join(NM, '@xterm/xterm/css/xterm.css'),
  '/vendor/addon-fit.js': path.join(NM, '@xterm/addon-fit/lib/addon-fit.js'),
  '/vendor/addon-web-links.js': path.join(NM, '@xterm/addon-web-links/lib/addon-web-links.js'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
};

function sendJson(res, code, obj, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, pathname) {
  let file = VENDOR[pathname];
  if (!file) {
    const rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
    file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/health') return sendJson(res, 200, { ok: true, version: pkg.version });

  if (p === '/api/me') {
    return sendJson(res, 200, {
      version: pkg.version,
      authRequired: auth.authEnabled,
      authenticated: auth.isAuthenticated(req),
      serverStorage: storageEnabled,
      sshKeepMax: Number(process.env.MTERM_SSH_KEEP_MAX ?? 240),
    });
  }
  if (p === '/api/login' && req.method === 'POST') {
    try {
      const body = await readJson(req, 16 * 1024);
      const token = auth.login(body.username, body.password);
      if (token === null) return sendJson(res, 200, { ok: true });
      if (!token) {
        await new Promise((r) => setTimeout(r, 800));
        return sendJson(res, 401, { error: 'Pogrešno korisničko ime ili lozinka.' });
      }
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(token, req) });
    } catch {
      return sendJson(res, 400, { error: 'Neispravan zahtjev.' });
    }
  }
  if (p === '/api/logout' && req.method === 'POST') {
    auth.logout(req);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  if (p.startsWith('/api/')) {
    if (!auth.isAuthenticated(req)) return sendJson(res, 401, { error: 'Potrebna je prijava.' });
    if (p.startsWith('/api/fs/')) return handleFilesApi(req, res, url);
    if (p === '/api/store') {
      if (!storageEnabled) return sendJson(res, 404, { error: 'Pohrana na serveru je isključena.' });
      try {
        if (req.method === 'GET') return sendJson(res, 200, loadStore());
        if (req.method === 'PUT') {
          const body = await readJson(req, 10 * 1024 * 1024);
          return sendJson(res, 200, { ok: true, updatedAt: saveStore(body) });
        }
        return sendJson(res, 405, { error: 'Metoda nije dopuštena.' });
      } catch (e) {
        return sendJson(res, 500, { error: e.message });
      }
    }
    return sendJson(res, 404, { error: 'Nepoznat API.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, p);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/ws/ssh' || !auth.originAllowed(req) || !auth.isAuthenticated(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    handleSshSocket(ws);
  });
});

// WebSocket ping svakih 25 s: proxyji (nginx: proxy_read_timeout 60 s) ne zatvaraju vezu bez prometa,
// a preglednik na ping odgovara i kad je tab u pozadini. Mrtve veze se prekidaju (SSH sesija ostaje).
const WS_PING_MS = Number(process.env.MTERM_WS_PING_SECONDS || 25) * 1000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, WS_PING_MS).unref();

server.listen(PORT, HOST, () => {
  console.log(`MTerm ${pkg.version} sluša na http://${HOST}:${PORT}`);
  if (!auth.authEnabled) {
    console.warn('UPOZORENJE: MTERM_PASSWORD nije postavljen - pristup MTermu nije zaštićen lozinkom!');
  }
});

const shutdown = () => {
  closeAll();
  closeAllSsh();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
