// Jednostavna prijava u MTerm (opcionalna).
// Ako je postavljen MTERM_PASSWORD, svi API pozivi i WebSocket veze traže sesijski kolačić.
import crypto from 'node:crypto';

const USER = process.env.MTERM_USER || 'admin';
const PASSWORD = process.env.MTERM_PASSWORD || '';
const SESSION_HOURS = Number(process.env.MTERM_SESSION_HOURS || 12);
const COOKIE = 'mterm_session';

const sessions = new Map(); // token -> expires (ms)

export const authEnabled = PASSWORD.length > 0;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAuthenticated(req) {
  if (!authEnabled) return true;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function login(username, password) {
  if (!authEnabled) return null;
  const okUser = safeEqual(username || '', USER);
  const okPass = safeEqual(password || '', PASSWORD);
  if (!(okUser && okPass)) return false;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_HOURS * 3600 * 1000);
  return token;
}

export function logout(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) sessions.delete(token);
}

export function sessionCookie(token, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// Zaštita WebSocket veze od cross-site zahtjeva
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return o.host === host;
  } catch {
    return false;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
}, 10 * 60 * 1000).unref();
