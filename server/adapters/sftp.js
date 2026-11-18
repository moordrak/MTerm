// SFTP adapter (ssh2)
import path from 'node:path/posix';
import { pipeline } from 'node:stream/promises';
import { Client } from 'ssh2';
import { sshConfig, attachKeyboardInteractive, fingerprint } from '../ssh.js';

const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFLNK = 0o120000;

export function modeString(mode) {
  if (mode == null) return '';
  const t = (mode & S_IFMT) === S_IFDIR ? 'd' : (mode & S_IFMT) === S_IFLNK ? 'l' : '-';
  const r = 'rwxrwxrwx';
  let s = '';
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? r[i] : '-';
  return t + s;
}

export function connectSsh(opts) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const cfg = sshConfig(opts);
    let fp = null;
    cfg.hostVerifier = (key) => { fp = fingerprint(key); return true; };
    attachKeyboardInteractive(conn, opts.password);
    conn.once('ready', () => resolve({ conn, fingerprint: fp }));
    conn.once('error', reject);
    conn.connect(cfg);
  });
}

export class SftpAdapter {
  constructor(opts) { this.opts = opts; }

  async connect() {
    const { conn, fingerprint } = await connectSsh(this.opts);
    this.conn = conn;
    this.fingerprint = fingerprint;
    this.sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
    conn.on('close', () => { this.closed = true; });
  }

  call(fn, ...args) {
    return new Promise((res, rej) => this.sftp[fn](...args, (e, v) => (e ? rej(e) : res(v))));
  }

  async home() {
    try { return await this.call('realpath', '.'); } catch { return '/'; }
  }

  async list(dir) {
    const entries = await this.call('readdir', dir);
    const out = [];
    for (const e of entries) {
      if (e.filename === '.' || e.filename === '..') continue;
      const m = e.attrs.mode;
      let type = (m & S_IFMT) === S_IFDIR ? 'dir' : (m & S_IFMT) === S_IFLNK ? 'link' : 'file';
      let target = null;
      if (type === 'link') {
        try {
          const st = await this.call('stat', path.join(dir, e.filename));
          target = (st.mode & S_IFMT) === S_IFDIR ? 'dir' : 'file';
        } catch {}
      }
      out.push({
        name: e.filename,
        type,
        target,
        size: e.attrs.size,
        mtime: (e.attrs.mtime || 0) * 1000,
        perms: modeString(m),
      });
    }
    return out;
  }

  async stat(p) {
    const st = await this.call('stat', p);
    return { size: st.size, isDir: (st.mode & S_IFMT) === S_IFDIR };
  }

  async download(p, writable, onInfo) {
    const st = await this.stat(p);
    if (st.isDir) throw new Error('Mapu nije moguće preuzeti kao datoteku.');
    onInfo?.({ size: st.size });
    await pipeline(this.sftp.createReadStream(p), writable);
  }

  async upload(p, readable) {
    await pipeline(readable, this.sftp.createWriteStream(p));
  }

  async mkdir(p) { await this.call('mkdir', p); }

  async remove(p) {
    const st = await this.call('lstat', p);
    if ((st.mode & S_IFMT) === S_IFDIR) {
      const entries = await this.call('readdir', p);
      for (const e of entries) {
        if (e.filename === '.' || e.filename === '..') continue;
        await this.remove(path.join(p, e.filename));
      }
      await this.call('rmdir', p);
    } else {
      await this.call('unlink', p);
    }
  }

  async rename(from, to) { await this.call('rename', from, to); }

  async close() {
    try { this.sftp?.end(); } catch {}
    try { this.conn?.end(); } catch {}
  }
}
