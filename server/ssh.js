// SSH terminal preko WebSocketa.
// Klijent -> server: JSON tekst poruke {type:'connect'|'data'|'resize'}
// Server -> klijent: binarni okviri = izlaz terminala, tekst JSON = status/greške
import crypto from 'node:crypto';
import { Client } from 'ssh2';

export function sshConfig(opts) {
  const cfg = {
    host: String(opts.host || '').trim(),
    port: Number(opts.port) || 22,
    username: String(opts.username || ''),
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 4,
    tryKeyboard: true,
  };
  if (opts.privateKey) {
    cfg.privateKey = opts.privateKey;
    if (opts.passphrase) cfg.passphrase = opts.passphrase;
  }
  if (opts.password) cfg.password = opts.password;
  return cfg;
}

export function fingerprint(key) {
  return 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

export function attachKeyboardInteractive(conn, password) {
  conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
    finish(prompts.map(() => password || ''));
  });
}

// ---------- SSH sesije koje preživljavaju prekid WebSocketa ----------
// Sesija (SSH veza + shell) živi na serveru neovisno o pregledniku. Kad se WebSocket prekine
// (pozadinski tab, proxy timeout, spavanje računala, osvježavanje stranice), sesija se čuva
// zadani broj minuta i klijent se može ponovno prikačiti (resume) bez gubitka shella.
const KEEP_MAX = Number(process.env.MTERM_SSH_KEEP_MAX ?? 240);       // najviše minuta
const KEEP_DEFAULT = Number(process.env.MTERM_SSH_KEEP_MINUTES ?? 15); // zadano minuta
const BUFFER_BYTES = 512 * 1024;                                       // zadnji izlaz za nadoknadu
const MAX_SESSIONS = Number(process.env.MTERM_SSH_MAX_SESSIONS ?? 100);

const sessions = new Map(); // id -> Session

class Session {
  constructor(id, keepMinutes) {
    this.id = id;
    this.keepMinutes = keepMinutes;
    this.conn = null;
    this.stream = null;
    this.ws = null;
    this.chunks = [];
    this.bytes = 0;     // bajtova u međuspremniku
    this.seq = 0;       // ukupno poslanih bajtova od početka sesije
    this.timer = null;
    this.closed = false;
    this.cols = 80;
    this.rows = 24;
  }
  get baseSeq() { return this.seq - this.bytes; }
  push(d) {
    this.chunks.push(d);
    this.bytes += d.length;
    this.seq += d.length;
    while (this.bytes > BUFFER_BYTES && this.chunks.length > 1) this.bytes -= this.chunks.shift().length;
    if (this.ws && this.ws.readyState === 1) this.ws.send(d, { binary: true });
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  attach(ws) {
    if (this.ws && this.ws !== ws) { try { this.ws.close(4000, 'preuzeto'); } catch {} }
    this.ws = ws;
    clearTimeout(this.timer);
    this.timer = null;
  }
  // izlaz od 'since' nadalje; ako je dio izgubljen iz međuspremnika, šalje sve što ima uz reset
  replay(since) {
    const all = Buffer.concat(this.chunks);
    if (since >= this.baseSeq && since <= this.seq) return { reset: false, data: all.subarray(since - this.baseSeq) };
    return { reset: true, data: all };
  }
  detach(ws) {
    if (this.ws !== ws) return;
    this.ws = null;
    if (this.closed) return;
    if (!this.keepMinutes) return this.destroy();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.destroy(), this.keepMinutes * 60 * 1000);
    this.timer.unref?.();
  }
  destroy() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    try { this.stream?.close(); } catch {}
    try { this.conn?.end(); } catch {}
    sessions.delete(this.id);
  }
}

export function sshSessionCount() {
  let attached = 0;
  for (const s of sessions.values()) if (s.ws) attached++;
  return { total: sessions.size, attached };
}

export function closeAllSsh() { for (const s of [...sessions.values()]) s.destroy(); }

export function handleSshSocket(ws) {
  let sess = null;
  const sendWs = (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

  ws.on('message', (raw, isBinary) => {
    if (isBinary) { if (sess?.stream) sess.stream.write(raw); return; }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'data') {
      if (sess?.stream) sess.stream.write(msg.data);
    } else if (msg.type === 'resize') {
      const cols = Math.max(1, msg.cols | 0), rows = Math.max(1, msg.rows | 0);
      if (sess) { sess.cols = cols; sess.rows = rows; sess.stream?.setWindow(rows, cols, 0, 0); }
    } else if (msg.type === 'ping') {
      sendWs({ type: 'pong' });
    } else if (msg.type === 'close') {
      // korisnik je zatvorio tab - sesija se odmah gasi
      sess?.destroy();
      sess = null;
      try { ws.close(); } catch {}
    } else if (msg.type === 'resume' && !sess) {
      const s = sessions.get(String(msg.id || ''));
      if (!s || s.closed) { sendWs({ type: 'expired' }); return; }
      sess = s;
      s.attach(ws);
      const { reset, data } = s.replay(Number(msg.since) || 0);
      sendWs({ type: 'resumed', id: s.id, reset, seq: s.seq - data.length, keepMinutes: s.keepMinutes });
      if (data.length) ws.send(data, { binary: true });
      if (msg.cols && msg.rows) {
        s.cols = msg.cols | 0; s.rows = msg.rows | 0;
        // prisili cjelozaslonske programe (vim, htop, mc) na ponovno iscrtavanje
        s.stream?.setWindow(s.rows, Math.max(1, s.cols - 1), 0, 0);
        setTimeout(() => s.stream?.setWindow(s.rows, s.cols, 0, 0), 60);
      }
    } else if (msg.type === 'connect' && !sess) {
      const cfg = sshConfig(msg);
      if (!cfg.host || !cfg.username) { sendWs({ type: 'error', message: 'Nedostaje host ili korisničko ime.' }); return; }
      if (sessions.size >= MAX_SESSIONS) { sendWs({ type: 'error', message: 'Previše otvorenih SSH sesija na serveru.' }); return; }
      const keep = Math.max(0, Math.min(KEEP_MAX, Number.isFinite(Number(msg.keepMinutes)) ? Number(msg.keepMinutes) : KEEP_DEFAULT));
      const s = new Session(crypto.randomBytes(16).toString('hex'), keep);
      if (msg.cols && msg.rows) { s.cols = msg.cols | 0; s.rows = msg.rows | 0; }
      sessions.set(s.id, s);
      sess = s;
      s.attach(ws);
      const conn = new Client();
      s.conn = conn;
      cfg.hostVerifier = (key) => { s.send({ type: 'hostkey', fingerprint: fingerprint(key) }); return true; };
      attachKeyboardInteractive(conn, msg.password);
      s.send({ type: 'status', message: `Spajanje na ${cfg.username}@${cfg.host}:${cfg.port} ...` });

      conn.on('ready', () => {
        s.send({ type: 'status', message: 'Spojeno.' });
        conn.shell({ term: msg.term || 'xterm-256color', cols: s.cols, rows: s.rows }, (err, st) => {
          if (err) { s.send({ type: 'error', message: 'Shell greška: ' + err.message }); s.destroy(); return; }
          s.stream = st;
          s.send({ type: 'session', id: s.id, keepMinutes: s.keepMinutes });
          s.send({ type: 'ready' });
          st.on('data', (d) => s.push(d));
          st.stderr.on('data', (d) => s.push(d));
          st.on('close', () => {
            s.send({ type: 'closed', reason: 'exit', message: 'Shell je završio.' });
            s.destroy();
            try { s.ws?.close(); } catch {}
          });
        });
      });
      conn.on('error', (err) => {
        s.send({ type: 'error', message: err.level === 'client-authentication'
          ? 'Autentikacija nije uspjela.' : 'SSH greška: ' + err.message });
        s.destroy();
      });
      conn.on('close', () => {
        if (!s.closed) { s.send({ type: 'closed', reason: 'lost', message: 'SSH veza prema serveru je prekinuta.' }); s.destroy(); }
      });
      try { conn.connect(cfg); }
      catch (err) { s.send({ type: 'error', message: 'SSH greška: ' + err.message }); s.destroy(); }
    }
  });

  const onGone = () => { if (sess) sess.detach(ws); sess = null; };
  ws.on('close', onGone);
  ws.on('error', onGone);
}
