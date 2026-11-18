// FTP / FTPS adapter (basic-ftp)
//   protocol 'ftp'  - nešifrirano
//   protocol 'ftps' - opts.ftpsMode: 'explicit' (AUTH TLS, port 21) ili 'implicit' (port 990)
import path from 'node:path/posix';
import { Client, FileType } from 'basic-ftp';

export class FtpAdapter {
  constructor(opts, secure) {
    this.opts = opts;
    this.secure = secure;
    this.queue = Promise.resolve();
  }

  // basic-ftp podržava samo jednu naredbu istovremeno - serijaliziramo pozive
  run(fn) {
    const p = this.queue.then(() => fn(this.client));
    this.queue = p.catch(() => {});
    return p;
  }

  async connect() {
    this.client = new Client(30000);
    this.client.ftp.verbose = false;
    let secure = false;
    if (this.secure) secure = this.opts.ftpsMode === 'implicit' ? 'implicit' : true;
    await this.client.access({
      host: String(this.opts.host || '').trim(),
      port: Number(this.opts.port) || (secure === 'implicit' ? 990 : 21),
      user: this.opts.username || 'anonymous',
      password: this.opts.password || '',
      secure,
      secureOptions: { rejectUnauthorized: !this.opts.insecure },
    });
    try { await this.client.send('OPTS UTF8 ON'); } catch {}
  }

  home() { return this.run((c) => c.pwd()); }

  list(dir) {
    return this.run(async (c) => {
      const items = await c.list(dir);
      return items
        .filter((i) => i.name !== '.' && i.name !== '..')
        .map((i) => ({
          name: i.name,
          type: i.type === FileType.Directory ? 'dir' : i.type === FileType.SymbolicLink ? 'link' : 'file',
          target: null,
          size: i.size,
          mtime: i.modifiedAt ? i.modifiedAt.getTime() : (i.rawModifiedAt ? Date.parse(i.rawModifiedAt) || 0 : 0),
          perms: i.permissions
            ? (i.isDirectory ? 'd' : '-') + [i.permissions.user, i.permissions.group, i.permissions.world]
              .map((v) => (v & 4 ? 'r' : '-') + (v & 2 ? 'w' : '-') + (v & 1 ? 'x' : '-')).join('')
            : (i.rawModifiedAt ? '' : ''),
        }));
    });
  }

  download(p, writable, onInfo) {
    return this.run(async (c) => {
      try { onInfo?.({ size: await c.size(p) }); } catch { onInfo?.({}); }
      await c.downloadTo(writable, p);
    });
  }

  upload(p, readable) {
    return this.run((c) => c.uploadFrom(readable, p));
  }

  mkdir(p) {
    return this.run(async (c) => {
      const cwd = await c.pwd();
      try { await c.send('MKD ' + p); } finally { await c.cd(cwd).catch(() => {}); }
    });
  }

  remove(p, isDir) {
    return this.run(async (c) => {
      if (isDir) {
        const cwd = await c.pwd();
        await c.removeDir(p);
        await c.cd(cwd).catch(() => c.cd(path.dirname(p)).catch(() => {}));
      } else {
        await c.remove(p);
      }
    });
  }

  rename(from, to) { return this.run((c) => c.rename(from, to)); }

  async close() { try { this.client?.close(); } catch {} }
}
