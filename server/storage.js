// Spremanje veza i postavki na server (JSON datoteka u MTERM_DATA_DIR).
// Tajni podaci (lozinke, privatni ključevi) šifriraju se AES-256-GCM ključem
// iz MTERM_SECRET ili iz automatski generirane datoteke secret.key.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SECRET_FIELDS = ['password', 'privateKey', 'passphrase'];
const PREFIX = 'enc:v1:';

export const storageEnabled = !/^(0|false|no|off)$/i.test(process.env.MTERM_SERVER_STORAGE || '');

let dataDir = null;
let key = null;

export function initStorage(rootDir) {
  dataDir = path.resolve(process.env.MTERM_DATA_DIR || path.join(rootDir, 'data'));
  if (!storageEnabled) return;
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (process.env.MTERM_SECRET) {
    key = crypto.createHash('sha256').update(process.env.MTERM_SECRET).digest();
  } else {
    const keyFile = path.join(dataDir, 'secret.key');
    if (!fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    }
    key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error('Neispravan ključ u ' + keyFile);
  }
  console.log('Pohrana veza na serveru: ' + dataDir);
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decrypt(val) {
  if (typeof val !== 'string' || !val.startsWith(PREFIX)) return val;
  try {
    const buf = Buffer.from(val.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return ''; // promijenjen ključ - tajna se više ne može pročitati
  }
}

const file = () => path.join(dataDir, 'store.json');

function readRaw() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return { connections: [], settings: null, updatedAt: 0 };
    throw new Error('Datoteka s vezama je oštećena: ' + e.message);
  }
}

export function loadStore() {
  const raw = readRaw();
  return {
    connections: (raw.connections || []).map((c) => {
      const out = { ...c };
      for (const f of SECRET_FIELDS) if (out[f]) out[f] = decrypt(out[f]);
      return out;
    }),
    settings: raw.settings || null,
    updatedAt: raw.updatedAt || 0,
  };
}

function cleanConnection(c) {
  if (!c || typeof c !== 'object' || !c.host) return null;
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  if (!out.savePassword) for (const f of SECRET_FIELDS) delete out[f];
  for (const f of SECRET_FIELDS) if (out[f]) out[f] = encrypt(out[f]);
  return out;
}

export function saveStore({ connections, settings }) {
  const current = readRaw();
  const data = {
    version: 1,
    updatedAt: Date.now(),
    connections: Array.isArray(connections) ? connections.map(cleanConnection).filter(Boolean) : current.connections || [],
    settings: settings && typeof settings === 'object' ? settings : current.settings || null,
  };
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  // sigurnosna kopija prethodne verzije
  if (fs.existsSync(file())) fs.copyFileSync(file(), path.join(dataDir, 'store.json.bak'));
  fs.renameSync(tmp, file());
  return data.updatedAt;
}
