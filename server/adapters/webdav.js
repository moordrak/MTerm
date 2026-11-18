// WebDAV / WebDAVS adapter (paket "webdav")
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { createClient } from 'webdav';

export class WebDavAdapter {
  constructor(opts, secure) {
    this.opts = opts;
    this.secure = secure;
  }

  baseUrl() {
    const scheme = this.secure ? 'https' : 'http';
    const host = String(this.opts.host || '').trim();
    const port = Number(this.opts.port) || (this.secure ? 443 : 80);
    let base = String(this.opts.basePath || '/').trim();
    if (!base.startsWith('/')) base = '/' + base;
    const defPort = (this.secure && port === 443) || (!this.secure && port === 80);
    const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `${scheme}://${h}${defPort ? '' : ':' + port}${base.replace(/\/+$/, '')}`;
  }

  async connect() {
    const options = {};
    if (this.opts.username) {
      options.username = this.opts.username;
      options.password = this.opts.password || '';
    }
    if (this.secure && this.opts.insecure) {
      options.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
    this.client = createClient(this.baseUrl(), options);
    // provjera veze
    await this.client.getDirectoryContents('/');
  }

  async home() { return '/'; }

  async list(dir) {
    const items = await this.client.getDirectoryContents(dir || '/');
    const arr = Array.isArray(items) ? items : items.data;
    return arr.map((i) => ({
      name: i.basename,
      type: i.type === 'directory' ? 'dir' : 'file',
      target: null,
      size: i.size || 0,
      mtime: i.lastmod ? Date.parse(i.lastmod) || 0 : 0,
      perms: '',
    })).filter((i) => i.name);
  }

  async download(p, writable, onInfo) {
    try {
      const st = await this.client.stat(p);
      const s = st.data || st;
      if (s.type === 'directory') throw new Error('Mapu nije moguće preuzeti kao datoteku.');
      onInfo?.({ size: s.size });
    } catch (e) {
      if (e.message.startsWith('Mapu')) throw e;
      onInfo?.({});
    }
    await pipeline(this.client.createReadStream(p), writable);
  }

  async upload(p, readable, size) {
    const ok = await this.client.putFileContents(p, readable, {
      overwrite: true,
      contentLength: size != null && !isNaN(size) ? Number(size) : false,
    });
    if (ok === false) throw new Error('Datoteka već postoji.');
  }

  async mkdir(p) { await this.client.createDirectory(p); }
  async remove(p) { await this.client.deleteFile(p); }
  async rename(from, to) { await this.client.moveFile(from, to); }
  async close() {}
}
