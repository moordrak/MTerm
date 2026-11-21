// SCP adapter: prijenos datoteka putem SCP protokola (scp -f / scp -t),
// pregled mapa i operacije (mkdir/rm/mv) putem SSH exec naredbi.
import path from 'node:path/posix';
import { connectSsh } from './sftp.js';

export function shq(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

export class ScpAdapter {
  constructor(opts) { this.opts = opts; }

  async connect() {
    const { conn, fingerprint } = await connectSsh(this.opts);
    this.conn = conn;
    this.fingerprint = fingerprint;
    this.closed = false;
    conn.on('close', () => { this.closed = true; });
    conn.on('end', () => { this.closed = true; });
  }

  isClosed() { return !!this.closed; }
  async reconnect() {
    await this.close();
    await this.connect();
  }

  exec(cmd) {
    return new Promise((resolve, reject) => {
      this.conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        const out = [], errOut = [];
        stream.on('data', (d) => out.push(d));
        stream.stderr.on('data', (d) => errOut.push(d));
        stream.on('close', (code) => {
          const stdout = Buffer.concat(out).toString('utf8');
          const stderr = Buffer.concat(errOut).toString('utf8');
          if (code === 0) resolve(stdout);
          else reject(new Error(stderr.trim() || `Naredba nije uspjela (kod ${code})`));
        });
      });
    });
  }

  async home() {
    try { return (await this.exec('pwd')).trim() || '/'; } catch { return '/'; }
  }

  async list(dir) {
    // GNU find (Linux) - pouzdano parsiranje imena
    try {
      const out = await this.exec(
        `LC_ALL=C find ${shq(dir)} -mindepth 1 -maxdepth 1 -printf '%y\\t%Y\\t%s\\t%T@\\t%M\\t%f\\0'`);
      return out.split('\0').filter(Boolean).map((line) => {
        const [y, Y, size, mt, perms, ...name] = line.split('\t');
        const type = y === 'd' ? 'dir' : y === 'l' ? 'link' : 'file';
        return {
          name: name.join('\t'),
          type,
          target: type === 'link' ? (Y === 'd' ? 'dir' : 'file') : null,
          size: Number(size),
          mtime: Math.round(parseFloat(mt) * 1000),
          perms,
        };
      });
    } catch {
      // Rezerva: ls -la (BusyBox, BSD)
      const out = await this.exec(`LC_ALL=C ls -la ${shq(dir)}`);
      const rows = [];
      for (const line of out.split('\n')) {
        const m = line.match(/^([\-dlbcps][\w\-+.@]{9,10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d+\s+[\d:]+)\s+(.+)$/);
        if (!m) continue;
        let name = m[4];
        const type = m[1][0] === 'd' ? 'dir' : m[1][0] === 'l' ? 'link' : 'file';
        if (type === 'link') name = name.split(' -> ')[0];
        if (name === '.' || name === '..') continue;
        const t = Date.parse(m[3] + (m[3].includes(':') ? ' ' + new Date().getFullYear() : ''));
        rows.push({ name, type, target: null, size: Number(m[2]), mtime: isNaN(t) ? 0 : t, perms: m[1] });
      }
      return rows;
    }
  }

  // Preuzimanje: scp -f
  download(p, writable, onInfo) {
    return new Promise((resolve, reject) => {
      this.conn.exec(`scp -f ${shq(p)}`, (err, stream) => {
        if (err) return reject(err);
        let state = 'header';
        let header = Buffer.alloc(0);
        let remaining = 0;
        let done = false;
        const fail = (e) => { if (!done) { done = true; try { stream.close(); } catch {} reject(e); } };
        stream.stderr.on('data', () => {});

        const onData = (chunk) => {
          while (chunk.length) {
            if (state === 'header') {
              header = Buffer.concat([header, chunk]);
              chunk = Buffer.alloc(0);
              if (header[0] === 1 || header[0] === 2) {
                const nl = header.indexOf(10);
                if (nl < 0) return;
                return fail(new Error(header.slice(1, nl).toString().trim() || 'SCP greška'));
              }
              const nl = header.indexOf(10);
              if (nl < 0) return;
              const line = header.slice(0, nl).toString();
              const rest = header.slice(nl + 1);
              header = Buffer.alloc(0);
              if (line[0] === 'T') { stream.write('\0'); chunk = rest; continue; }
              if (line[0] === 'D') return fail(new Error('Mapu nije moguće preuzeti putem SCP-a kao datoteku.'));
              const m = line.match(/^C(\d{4}) (\d+) (.*)$/);
              if (!m) return fail(new Error('Neočekivan SCP odgovor: ' + line));
              remaining = Number(m[2]);
              onInfo?.({ size: remaining });
              state = 'data';
              stream.write('\0');
              chunk = rest;
              if (remaining === 0) { state = 'trailer'; }
            } else if (state === 'data') {
              const take = chunk.slice(0, remaining);
              chunk = chunk.slice(take.length);
              remaining -= take.length;
              if (!writable.write(take)) {
                stream.pause();
                writable.once('drain', () => stream.resume());
              }
              if (remaining === 0) state = 'trailer';
            } else if (state === 'trailer') {
              // 1 bajt potvrde (\0)
              chunk = chunk.slice(1);
              stream.write('\0');
              state = 'end';
              done = true;
              writable.end();
              try { stream.end(); } catch {}
              resolve();
            } else {
              chunk = Buffer.alloc(0);
            }
          }
        };
        stream.on('data', onData);
        stream.on('close', () => { if (!done) fail(new Error('SCP veza prekinuta.')); });
        writable.on?.('error', fail);
        stream.write('\0');
      });
    });
  }

  // Slanje: scp -t
  upload(p, readable, size) {
    if (size == null || isNaN(size)) return Promise.reject(new Error('SCP zahtijeva poznatu veličinu datoteke.'));
    const dir = path.dirname(p), name = path.basename(p);
    return new Promise((resolve, reject) => {
      this.conn.exec(`scp -t ${shq(dir)}`, (err, stream) => {
        if (err) return reject(err);
        let step = 0;
        let done = false;
        let errBuf = '';
        const fail = (e) => { if (!done) { done = true; try { stream.close(); } catch {} reject(e); } };
        stream.stderr.on('data', (d) => { errBuf += d.toString(); });

        const sendData = () => {
          readable.on('data', (c) => { if (!stream.write(c)) { readable.pause(); stream.once('drain', () => readable.resume()); } });
          readable.on('end', () => { stream.write('\0'); });
          readable.on('error', fail);
          readable.resume?.();
        };

        stream.on('data', (d) => {
          if (d[0] !== 0) return fail(new Error(d.slice(1).toString().trim() || errBuf.trim() || 'SCP greška'));
          step++;
          if (step === 1) {
            stream.write(`C0644 ${size} ${name.replace(/\n/g, '')}\n`);
          } else if (step === 2) {
            sendData();
          } else if (step === 3) {
            done = true;
            try { stream.end(); } catch {}
            resolve();
          }
        });
        stream.on('close', () => { if (!done) fail(new Error(errBuf.trim() || 'SCP veza prekinuta.')); });
      });
    });
  }

  async mkdir(p) { await this.exec(`mkdir -- ${shq(p)}`); }
  async remove(p) { await this.exec(`rm -rf -- ${shq(p)}`); }
  async rename(from, to) { await this.exec(`mv -- ${shq(from)} ${shq(to)}`); }
  async close() { try { this.conn?.end(); } catch {} }
}
