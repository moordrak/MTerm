// Integracijski test MTerma protiv stvarnih servera (pokreće se u GitHub Actions).
// Upotreba: node test/integration.mjs  (MTerm mora slušati na MTERM_URL)
import crypto from 'node:crypto';
import WebSocket from 'ws';

const BASE = process.env.MTERM_URL || 'http://127.0.0.1:8080';
const H = process.env.TEST_HOST || '127.0.0.1';
const U = 'test', P = 'test';

const targets = [
  { protocol: 'sftp', host: H, port: 2222, username: U, password: P },
  { protocol: 'scp', host: H, port: 2222, username: U, password: P },
  { protocol: 'ftp', host: H, port: 21, username: U, password: P },
  { protocol: 'ftps', host: H, port: 21, username: U, password: P, ftpsMode: 'explicit', insecure: true },
  { protocol: 'webdav', host: H, port: 8081, username: U, password: P, basePath: '/' },
];

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch { d = text; }
  if (!r.ok) throw new Error(`${path}: ${r.status} ${typeof d === 'object' ? d.error : d}`);
  return d;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// Minimalni čitač ZIP-a (metoda store) - za provjeru preuzimanja mape
function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP: nema EOCD');
  let count = buf.readUInt16LE(e + 10), cd = buf.readUInt32LE(e + 16);
  if (cd === 0xffffffff || count === 0xffff) {
    const z = Number(buf.readBigUInt64LE(e - 20 + 8));
    count = Number(buf.readBigUInt64LE(z + 32)); cd = Number(buf.readBigUInt64LE(z + 48));
  }
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('ZIP: neispravan središnji direktorij');
    let size = buf.readUInt32LE(cd + 24), off = buf.readUInt32LE(cd + 42);
    const nl = buf.readUInt16LE(cd + 28), xl = buf.readUInt16LE(cd + 30), cl = buf.readUInt16LE(cd + 32);
    const name = buf.subarray(cd + 46, cd + 46 + nl).toString('utf8');
    let x = cd + 46 + nl;
    while (x < cd + 46 + nl + xl) {
      const id = buf.readUInt16LE(x), len = buf.readUInt16LE(x + 2);
      if (id === 1) { let k = x + 4; if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(k)); k += 16; } if (off === 0xffffffff) off = Number(buf.readBigUInt64LE(k)); }
      x += 4 + len;
    }
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    const start = off + 30 + lnl + lxl;
    out.set(name, buf.subarray(start, start + size));
    cd += 46 + nl + xl + cl;
  }
  return out;
}

async function testFiles(t) {
  const s = await post('/api/fs/connect', t);
  const q = (p) => '?path=' + encodeURIComponent(p);
  const dir = (s.home === '/' ? '' : s.home) + '/mterm-test-' + t.protocol;
  try { await post(`/api/fs/${s.id}/delete${q(dir)}`, { isDir: true }); } catch {}
  await post(`/api/fs/${s.id}/mkdir${q(dir)}`);
  const data = crypto.randomBytes(300 * 1024 + 17);
  await api(`/api/fs/${s.id}/upload${q(dir + '/datoteka s razmakom.bin')}`, {
    method: 'PUT', body: data, headers: { 'X-File-Size': String(data.length) } });
  const list = await api(`/api/fs/${s.id}/list${q(dir)}`);
  const item = list.items.find((i) => i.name === 'datoteka s razmakom.bin');
  if (!item) throw new Error('datoteka nije na popisu: ' + JSON.stringify(list.items));
  if (item.size !== data.length) throw new Error(`kriva veličina ${item.size} != ${data.length}`);
  const r = await fetch(BASE + `/api/fs/${s.id}/download${q(dir + '/datoteka s razmakom.bin')}`);
  const got = Buffer.from(await r.arrayBuffer());
  if (!got.equals(data)) throw new Error(`preuzeti sadržaj se razlikuje (${got.length} B)`);
  // slanje mape: ugniježđene mape (ensure je idempotentan) + datoteka u najdubljoj
  const deep = dir + '/mapa/pod mapa/treća';
  await post(`/api/fs/${s.id}/mkdir${q(deep)}&ensure=1`);
  await post(`/api/fs/${s.id}/mkdir${q(deep)}&ensure=1`);
  await post(`/api/fs/${s.id}/mkdir${q(dir + '/mapa')}&ensure=1`);
  const small = Buffer.from('MTerm mapa ' + t.protocol);
  await api(`/api/fs/${s.id}/upload${q(deep + '/a.txt')}`, { method: 'PUT', body: small, headers: { 'X-File-Size': String(small.length) } });
  const dl = await api(`/api/fs/${s.id}/list${q(deep)}`);
  if (!dl.items.find((i) => i.name === 'a.txt' && i.size === small.length)) throw new Error('datoteka u podmapi: ' + JSON.stringify(dl.items));
  // rekurzivni popis mape
  const tree = await api(`/api/fs/${s.id}/tree${q(dir)}`);
  if (!tree.dirs.includes('mapa/pod mapa/treća') || !tree.files.find((f) => f.rel === 'mapa/pod mapa/treća/a.txt'))
    throw new Error('tree: ' + JSON.stringify(tree));
  // preuzimanje mape kao ZIP i provjera sadržaja
  const zr = await fetch(BASE + `/api/fs/${s.id}/zip${q(dir)}`);
  if (!zr.ok) throw new Error('zip HTTP ' + zr.status);
  const zip = readZip(Buffer.from(await zr.arrayBuffer()));
  const top = 'mterm-test-' + t.protocol;
  const za = zip.get(top + '/mapa/pod mapa/treća/a.txt');
  if (!za || !za.equals(small)) throw new Error('zip a.txt: ' + [...zip.keys()].join(', '));
  const zb = zip.get(top + '/datoteka s razmakom.bin');
  if (!zb || !zb.equals(data)) throw new Error('zip velika datoteka');
  if (!zip.has(top + '/mapa/pod mapa/')) throw new Error('zip mapa');
  if ([...zip.keys()].some((k) => k.includes('_MTERM_GRESKE'))) throw new Error('zip sadrži greške: ' + zip.get([...zip.keys()].find((k) => k.includes('_MTERM_GRESKE'))));
  await post(`/api/fs/${s.id}/rename${q(dir + '/datoteka s razmakom.bin')}`, { to: dir + '/novo.bin' });
  const list2 = await api(`/api/fs/${s.id}/list${q(dir)}`);
  if (!list2.items.find((i) => i.name === 'novo.bin')) throw new Error('preimenovanje nije uspjelo');
  await post(`/api/fs/${s.id}/delete${q(dir + '/novo.bin')}`, { isDir: false });
  await post(`/api/fs/${s.id}/delete${q(dir)}`, { isDir: true });
  const list3 = await api(`/api/fs/${s.id}/list${q(s.home)}`);
  if (list3.items.find((i) => i.name === 'mterm-test-' + t.protocol)) throw new Error('brisanje mape nije uspjelo');
  await post(`/api/fs/${s.id}/close`);
}

function testSsh() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/ssh');
    let out = '';
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout, izlaz: ' + out.slice(-300))); }, 20000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connect', host: H, port: 2222, username: U, password: P, cols: 100, rows: 30 })));
    ws.on('message', (d, bin) => {
      if (!bin) {
        const m = JSON.parse(d.toString());
        if (m.type === 'ready') ws.send(JSON.stringify({ type: 'data', data: 'echo MTERM_$((40+2))\n' }));
        if (m.type === 'error') { clearTimeout(timer); reject(new Error(m.message)); }
        return;
      }
      out += d.toString();
      if (out.includes('MTERM_42')) { clearTimeout(timer); ws.close(); resolve(); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

let failed = 0;
const run = async (name, fn) => {
  try { await fn(); console.log(`OK    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message}`); }
};

await run('health', async () => { const h = await api('/api/health'); if (!h.ok) throw new Error('health'); });
await run('pohrana na serveru', async () => {
  await api('/api/store', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    connections: [{ id: 'x', protocol: 'ssh', host: 'h', password: 'tajno', savePassword: true },
      { id: 'y', protocol: 'ftp', host: 'h2', password: 'ne', savePassword: false }], settings: { theme: 'nord' } }) });
  const d = await api('/api/store');
  if (d.connections.length !== 2 || d.connections[0].password !== 'tajno' || d.connections[1].password) throw new Error(JSON.stringify(d));
  if (d.settings.theme !== 'nord') throw new Error('postavke');
});
await run('ssh terminal', testSsh);
for (const t of targets) await run(t.protocol, () => testFiles(t));
console.log(failed ? `\n${failed} test(ova) nije prošlo.` : '\nSvi testovi su prošli.');
process.exit(failed ? 1 : 0);
