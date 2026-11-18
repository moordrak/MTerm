// Upravljanje sesijama za prijenos datoteka (SFTP, SCP, FTP, FTPS, WebDAV, WebDAVS)
import crypto from 'node:crypto';
import path from 'node:path/posix';
import { SftpAdapter } from './adapters/sftp.js';
import { ScpAdapter } from './adapters/scp.js';
import { FtpAdapter } from './adapters/ftp.js';
import { WebDavAdapter } from './adapters/webdav.js';
import { ZipStream } from './zip.js';

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

// Rekurzivni obilazak udaljene mape: out.dirs = ['a', 'a/b'], out.files = [{rel, size, mtime}]
async function walk(a, absDir, relDir, out, depth = 0) {
  if (depth > 64) { out.errors.push(`${relDir}: preduboka struktura mapa`); return; }
  let items;
  try { items = await a.list(absDir); }
  catch (e) { out.errors.push(`${relDir || absDir}: ${errMsg(e)}`); return; }
  for (const i of items) {
    const rel = relDir ? relDir + '/' + i.name : i.name;
    const abs = path.join(absDir, i.name);
    if (i.type === 'dir') {
      out.dirs.push(rel);
      await walk(a, abs, rel, out, depth + 1);
    } else if (i.type === 'link' && i.target === 'dir') {
      out.errors.push(`${rel}: simbolička veza na mapu je preskočena`);
    } else {
      out.files.push({ rel, size: i.size || 0, mtime: i.mtime || 0 });
    }
  }
}

async function sendZip(a, base, url, res) {
  let names = null;
  try { names = url.searchParams.get('items') ? JSON.parse(url.searchParams.get('items')) : null; } catch {}
  // popis stavki: cijela mapa ili označene stavke
  const plan = { dirs: [], files: [], errors: [] };
  if (Array.isArray(names) && names.length) {
    const listing = await a.list(base);
    for (const n of names) {
      const it = listing.find((x) => x.name === n);
      if (!it) { plan.errors.push(`${n}: ne postoji`); continue; }
      if (it.type === 'dir') { plan.dirs.push(n); await walk(a, path.join(base, n), n, plan); }
      else if (it.type === 'link' && it.target === 'dir') plan.errors.push(`${n}: simbolička veza na mapu je preskočena`);
      else plan.files.push({ rel: n, size: it.size || 0, mtime: it.mtime || 0 });
    }
  } else {
    const top = path.basename(base) || 'root';
    plan.dirs.push(top);
    const sub = { dirs: [], files: [], errors: plan.errors };
    await walk(a, base, '', sub);
    plan.dirs.push(...sub.dirs.map((d) => top + '/' + d));
    plan.files.push(...sub.files.map((f) => ({ ...f, rel: top + '/' + f.rel, src: f.rel })));
  }
  const zipName = (url.searchParams.get('name') || (path.basename(base) || 'mterm') + '.zip').replace(/[\\/\r\n"]/g, '_');
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${zipName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const zip = new ZipStream(res);
  try {
    for (const d of plan.dirs) await zip.addDir(d, Date.now());
    for (const f of plan.files) {
      const src = path.join(base, f.src ?? f.rel);
      const r = await zip.addFile(f.rel, f.mtime, f.size, (sink) => a.download(src, sink));
      if (r.error) plan.errors.push(`${f.rel}: ${errMsg(r.error)}`);
    }
    if (plan.errors.length) {
      await zip.addBuffer('_MTERM_GRESKE.txt', Buffer.from(
        'Sljedeće stavke nisu preuzete ili su nepotpune:\r\n\r\n' + plan.errors.join('\r\n') + '\r\n', 'utf8'));
    }
    await zip.finish();
  } catch (e) {
    res.destroy(e); // klijent je prekinuo ili veza s serverom pukla
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
    if (action === 'zip' && req.method === 'GET') {
      return await sendZip(a, p, url, res);
    }
    if (action === 'tree' && req.method === 'GET') {
      // rekurzivni popis (za preuzimanje mape u lokalnu mapu preglednika)
      const out = { dirs: [], files: [], errors: [] };
      await walk(a, p, '', out);
      return json(res, 200, out);
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
