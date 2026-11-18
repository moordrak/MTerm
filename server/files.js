// Upravljanje sesijama za prijenos datoteka (SFTP, SCP, FTP, FTPS, WebDAV, WebDAVS)
import crypto from 'node:crypto';
import path from 'node:path/posix';
import { SftpAdapter } from './adapters/sftp.js';
import { ScpAdapter } from './adapters/scp.js';
import { FtpAdapter } from './adapters/ftp.js';
import { WebDavAdapter } from './adapters/webdav.js';

const IDLE_MINUTES = Number(process.env.MTERM_IDLE_MINUTES || 30);
const sessions = new Map(); // id -> { adapter, protocol, last }

export const PROTOCOLS = ['sftp', 'scp', 'ftp', 'ftps', 'webdav', 'webdavs'];

function makeAdapter(opts) {
  switch (opts.protocol) {
    case 'sftp': return new SftpAdapter(opts);
    case 'scp': return new ScpAdapter(opts);
    case 'ftp': return new FtpAdapter(opts, false);
    case 'ftps': return new FtpAdapter(opts, true);
    case 'webdav': return new WebDavAdapter(opts, false);
    case 'webdavs': return new WebDavAdapter(opts, true);
    default: throw new Error('Nepodržan protokol: ' + opts.protocol);
  }
}

function normPath(p) {
  const n = path.normalize('/' + String(p || '/')).replace(/\/+$/, '');
  return n || '/';
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export async function readJson(req, limit = 1024 * 1024) {
  const chunks = [];
  let len = 0;
  for await (const c of req) {
    len += c.length;
    if (len > limit) throw new Error('Zahtjev je prevelik.');
    chunks.push(c);
  }
  if (!len) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function errMsg(e) {
  if (!e) return 'Nepoznata greška';
  if (e.level === 'client-authentication') return 'Autentikacija nije uspjela.';
  if (e.code === 530) return 'Prijava nije uspjela (530).';
  if (e.status === 401 || e.response?.status === 401) return 'WebDAV: neispravni podaci za prijavu (401).';
  return e.message || String(e);
}

// Kreira mapu (i nadređene) ako ne postoji - postojeća mapa nije greška
async function ensureDir(a, p) {
  if (p === '/') return;
  try {
    await a.mkdir(p);
  } catch (err) {
    const parent = path.dirname(p), name = path.basename(p);
    let items;
    try { items = await a.list(parent); } catch {
      // nadređena mapa ne postoji - kreiraj je pa pokušaj ponovno
      await ensureDir(a, parent);
      await a.mkdir(p);
      return;
    }
    const it = items.find((i) => i.name === name);
    if (it && (it.type === 'dir' || it.target === 'dir')) return;
    if (it) throw new Error(`"${name}" već postoji i nije mapa.`);
    throw err;
  }
}

function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  s.last = Date.now();
  return s;
}

export async function handleFilesApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api, fs, ...
  try {
    // POST /api/fs/connect
    if (parts[2] === 'connect' && req.method === 'POST') {
      const opts = await readJson(req);
      if (!PROTOCOLS.includes(opts.protocol)) return json(res, 400, { error: 'Nepodržan protokol.' });
      if (!opts.host) return json(res, 400, { error: 'Nedostaje host.' });
      const adapter = makeAdapter(opts);
      await adapter.connect();
      const id = crypto.randomBytes(16).toString('hex');
      sessions.set(id, { adapter, protocol: opts.protocol, last: Date.now() });
      let home = '/';
      try { home = normPath(await adapter.home()); } catch {}
      return json(res, 200, { id, home, fingerprint: adapter.fingerprint || null });
    }

    const id = parts[2];
    const action = parts[3];
    const s = id && getSession(id);
    if (!s) return json(res, 404, { error: 'Sesija ne postoji ili je istekla. Spojite se ponovno.' });
    const a = s.adapter;
    const p = normPath(url.searchParams.get('path'));

    if (action === 'close' && req.method === 'POST') {
      sessions.delete(id);
      await a.close();
      return json(res, 200, { ok: true });
    }
    if (action === 'list' && req.method === 'GET') {
      const items = await a.list(p);
      items.sort((x, y) => {
        const dx = x.type === 'dir' || x.target === 'dir', dy = y.type === 'dir' || y.target === 'dir';
        if (dx !== dy) return dx ? -1 : 1;
        return x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      return json(res, 200, { path: p, items });
    }
    if (action === 'download' && req.method === 'GET') {
      const name = path.basename(p) || 'download';
      let started = false;
      const start = (info) => {
        if (started) return;
        started = true;
        const h = {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${name.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Cache-Control': 'no-store',
        };
        if (info && info.size != null && !isNaN(info.size)) h['Content-Length'] = String(info.size);
        res.writeHead(200, h);
      };
      try {
        await a.download(p, res, start);
        if (!res.writableEnded) res.end();
      } catch (e) {
        if (!started && !res.headersSent) return json(res, 500, { error: errMsg(e) });
        res.destroy(e);
      }
      return;
    }
    if (action === 'upload' && (req.method === 'PUT' || req.method === 'POST')) {
      const size = req.headers['x-file-size'] != null ? Number(req.headers['x-file-size'])
        : req.headers['content-length'] != null ? Number(req.headers['content-length']) : undefined;
      await a.upload(p, req, size);
      return json(res, 200, { ok: true });
    }
    if (action === 'mkdir' && req.method === 'POST') {
      if (url.searchParams.get('ensure') === '1') await ensureDir(a, p);
      else await a.mkdir(p);
      return json(res, 200, { ok: true });
    }
    if (action === 'delete' && req.method === 'POST') {
      const body = await readJson(req);
      await a.remove(p, !!body.isDir);
      return json(res, 200, { ok: true });
    }
    if (action === 'rename' && req.method === 'POST') {
      const body = await readJson(req);
      await a.rename(p, normPath(body.to));
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Nepoznata akcija.' });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: errMsg(e) });
    else res.destroy();
  }
}

setInterval(() => {
  const limit = Date.now() - IDLE_MINUTES * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.last < limit || s.adapter.closed) {
      sessions.delete(id);
      s.adapter.close().catch(() => {});
    }
  }
}, 60 * 1000).unref();

export function closeAll() {
  for (const [, s] of sessions) s.adapter.close().catch(() => {});
  sessions.clear();
}
