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

export function handleSshSocket(ws) {
  let conn = null;
  let stream = null;
  let pending = null; // veličina prije otvaranja shella

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  const cleanup = () => {
    try { stream && stream.close(); } catch {}
    try { conn && conn.end(); } catch {}
    stream = null;
    conn = null;
  };

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (stream) stream.write(raw);
      return;
    }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'data') {
      if (stream) stream.write(msg.data);
    } else if (msg.type === 'resize') {
      const cols = Math.max(1, msg.cols | 0), rows = Math.max(1, msg.rows | 0);
      if (stream) stream.setWindow(rows, cols, 0, 0);
      else pending = { cols, rows };
    } else if (msg.type === 'connect' && !conn) {
      const cfg = sshConfig(msg);
      if (!cfg.host || !cfg.username) {
        send({ type: 'error', message: 'Nedostaje host ili korisničko ime.' });
        return;
      }
      if (msg.cols && msg.rows) pending = { cols: msg.cols | 0, rows: msg.rows | 0 };
      conn = new Client();
      cfg.hostVerifier = (key) => {
        send({ type: 'hostkey', fingerprint: fingerprint(key) });
        return true;
      };
      attachKeyboardInteractive(conn, msg.password);
      send({ type: 'status', message: `Spajanje na ${cfg.username}@${cfg.host}:${cfg.port} ...` });

      conn.on('ready', () => {
        send({ type: 'status', message: 'Spojeno.' });
        const term = {
          term: msg.term || 'xterm-256color',
          cols: pending?.cols || 80,
          rows: pending?.rows || 24,
        };
        conn.shell(term, (err, s) => {
          if (err) {
            send({ type: 'error', message: 'Shell greška: ' + err.message });
            cleanup();
            return;
          }
          stream = s;
          send({ type: 'ready' });
          s.on('data', (d) => ws.readyState === ws.OPEN && ws.send(d, { binary: true }));
          s.stderr.on('data', (d) => ws.readyState === ws.OPEN && ws.send(d, { binary: true }));
          s.on('close', () => {
            send({ type: 'closed', message: 'Veza zatvorena.' });
            cleanup();
            try { ws.close(); } catch {}
          });
        });
      });
      conn.on('error', (err) => {
        send({ type: 'error', message: err.level === 'client-authentication'
          ? 'Autentikacija nije uspjela.' : 'SSH greška: ' + err.message });
        cleanup();
      });
      conn.on('close', () => {
        if (stream) send({ type: 'closed', message: 'Veza zatvorena.' });
      });
      try {
        conn.connect(cfg);
      } catch (err) {
        send({ type: 'error', message: 'SSH greška: ' + err.message });
        cleanup();
      }
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
