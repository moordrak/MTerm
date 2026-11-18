/* MTerm - klijentski dio */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const PROTO = {
  ssh: { label: 'SSH', port: 22, kind: 'term' },
  sftp: { label: 'SFTP', port: 22, kind: 'files' },
  scp: { label: 'SCP', port: 22, kind: 'files' },
  ftp: { label: 'FTP', port: 21, kind: 'files' },
  ftps: { label: 'FTPS', port: 21, kind: 'files' },
  webdav: { label: 'WebDAV', port: 80, kind: 'files' },
  webdavs: { label: 'WebDAVS', port: 443, kind: 'files' },
};

const THEMES = {
  dark: { background: '#000000', foreground: '#e5e7eb', cursor: '#22d3ee', selectionBackground: '#164e63' },
  solarized: {
    background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  light: { background: '#fafafa', foreground: '#1f2937', cursor: '#0891b2', selectionBackground: '#bae6fd',
    black: '#1f2937', white: '#9ca3af', brightWhite: '#6b7280', yellow: '#a16207', brightYellow: '#854d0e' },
};

// ---------- spremanje ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('mterm.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mterm.' + k, JSON.stringify(v)); } catch {} },
};
let connections = store.get('connections', []);
let settings = Object.assign({ fontSize: 14, fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", Menlo, Consolas, monospace', theme: 'dark', copyOnSelect: false }, store.get('settings', {}));
const saveConnections = () => store.set('connections', connections);

// ---------- poruke ----------
function toast(msg, isErr = false, ms = 4500) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- API ----------
async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...opts,
    headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  if (res.status === 401) { showLogin(); throw new Error('Potrebna je prijava.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- prijava ----------
function showLogin() { $('#login').classList.remove('hidden'); $('#loginForm [name=password]').focus(); }
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('#loginError').textContent = '';
  try {
    const res = await fetch('api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.username.value, password: f.password.value }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Prijava nije uspjela.');
    f.password.value = '';
    $('#login').classList.add('hidden');
  } catch (err) { $('#loginError').textContent = err.message; }
});
$('#btnLogout').addEventListener('click', async () => {
  await fetch('api/logout', { method: 'POST' });
  location.reload();
});

// ---------- popis veza ----------
function renderConnections() {
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#connList');
  list.innerHTML = '';
  const filtered = connections.filter((c) => !q || [c.name, c.host, c.username, c.group, c.protocol].join(' ').toLowerCase().includes(q));
  if (!filtered.length) {
    list.innerHTML = `<div class="muted" style="padding:8px">${connections.length ? 'Nema rezultata.' : 'Još nema spremljenih veza.'}</div>`;
    return;
  }
  const groups = {};
  for (const c of filtered) (groups[c.group || ''] ||= []).push(c);
  for (const g of Object.keys(groups).sort()) {
    if (g) list.insertAdjacentHTML('beforeend', `<div class="conn-group">${esc(g)}</div>`);
    for (const c of groups[g].sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host))) {
      const el = document.createElement('div');
      el.className = 'conn';
      el.innerHTML = `<span class="proto ${esc(c.protocol)}">${esc(PROTO[c.protocol]?.label || c.protocol)}</span>
        <div class="info"><div class="name">${esc(c.name || c.host)}</div>
        <div class="host">${esc(c.username ? c.username + '@' : '')}${esc(c.host)}:${esc(c.port || PROTO[c.protocol]?.port)}</div></div>
        <button class="edit" title="Uredi">✎</button>`;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.edit')) return openDialog(c);
        quickOpen(c);
      });
      list.appendChild(el);
    }
  }
}
$('#search').addEventListener('input', renderConnections);

function needsSecret(c) {
  if (c.password || c.privateKey) return false;
  if (['ftp', 'ftps', 'webdav', 'webdavs'].includes(c.protocol) && !c.username) return false;
  return true;
}
function quickOpen(c) {
  if (needsSecret(c)) openDialog(c, true);
  else openConnection(c);
}

// ---------- dijalog veze ----------
const dlg = $('#connDialog');
const form = $('#connForm');
let editing = null;

function updateFormVisibility() {
  const p = form.protocol.value;
  dlg.querySelectorAll('.only-ssh').forEach((el) => el.classList.toggle('hidden', !['ssh', 'sftp', 'scp'].includes(p)));
  dlg.querySelectorAll('.only-ftps').forEach((el) => el.classList.toggle('hidden', p !== 'ftps'));
  dlg.querySelectorAll('.only-webdav').forEach((el) => el.classList.toggle('hidden', !p.startsWith('webdav')));
  dlg.querySelectorAll('.only-tls').forEach((el) => el.classList.toggle('hidden', !['ftps', 'webdavs'].includes(p)));
  form.port.placeholder = defaultPort(p, form.ftpsMode.value);
}
function defaultPort(p, ftpsMode) { return p === 'ftps' && ftpsMode === 'implicit' ? 990 : PROTO[p]?.port; }
form.protocol.addEventListener('change', updateFormVisibility);
form.ftpsMode.addEventListener('change', updateFormVisibility);

function openDialog(conn = null, focusPassword = false) {
  editing = conn;
  form.reset();
  $('#connTitle').textContent = conn ? (conn.name || conn.host) : 'Nova veza';
  $('#btnDelete').classList.toggle('hidden', !conn || !connections.includes(conn));
  const c = conn || { protocol: 'ssh' };
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = !!c[el.name];
    else if (c[el.name] != null) el.value = c[el.name];
  }
  if (!c.ftpsMode) form.ftpsMode.value = 'explicit';
  updateFormVisibility();
  dlg.classList.remove('hidden');
  (focusPassword && !conn?.privateKey ? form.password : form.name).focus();
}

function readForm() {
  const c = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    c[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  c.password = form.password.value; // bez trim
  c.port = Number(c.port) || defaultPort(c.protocol, c.ftpsMode);
  return c;
}

function persistConnection(c) {
  const toSave = { ...c };
  if (!c.savePassword) { delete toSave.password; delete toSave.privateKey; delete toSave.passphrase; }
  if (editing && connections.includes(editing)) {
    toSave.id = editing.id;
    connections[connections.indexOf(editing)] = toSave;
  } else {
    toSave.id = uid();
    connections.push(toSave);
  }
  saveConnections();
  renderConnections();
  return toSave;
}

$('#btnNew').addEventListener('click', () => openDialog());
$('#btnCancel').addEventListener('click', () => dlg.classList.add('hidden'));
$('#btnSave').addEventListener('click', () => {
  if (!form.reportValidity()) return;
  persistConnection(readForm());
  dlg.classList.add('hidden');
  toast('Veza spremljena.');
});
$('#btnDelete').addEventListener('click', () => {
  if (!editing || !confirm(`Obrisati vezu "${editing.name || editing.host}"?`)) return;
  connections = connections.filter((c) => c !== editing);
  saveConnections();
  renderConnections();
  dlg.classList.add('hidden');
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const c = readForm();
  // nova ili izmijenjena veza se sprema; lozinka iz forme koristi se za ovo spajanje
  const isSaved = editing && connections.includes(editing);
  if (!isSaved || JSON.stringify(stripSecrets(editing)) !== JSON.stringify(stripSecrets(c))) persistConnection(c);
  dlg.classList.add('hidden');
  openConnection(c);
});
function stripSecrets(c) {
  const { password, privateKey, passphrase, id, ...rest } = c || {};
  return rest;
}

// ---------- izvoz / uvoz ----------
$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(connections.map(({ password, privateKey, passphrase, ...r }) => r), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mterm-veze.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#btnImport').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const arr = JSON.parse(await f.text());
    if (!Array.isArray(arr)) throw new Error('Neispravan format.');
    let n = 0;
    for (const c of arr) if (c && c.host && PROTO[c.protocol]) { connections.push({ ...c, id: uid() }); n++; }
    saveConnections();
    renderConnections();
    toast(`Uvezeno veza: ${n}`);
  } catch (err) { toast('Uvoz nije uspio: ' + err.message, true); }
  e.target.value = '';
});

// ---------- postavke ----------
const sdlg = $('#settingsDialog'), sform = $('#settingsForm');
$('#btnSettings').addEventListener('click', () => {
  sform.fontSize.value = settings.fontSize;
  sform.fontFamily.value = settings.fontFamily;
  sform.theme.value = settings.theme;
  sform.copyOnSelect.checked = settings.copyOnSelect;
  sdlg.classList.remove('hidden');
});
$('#btnSettingsCancel').addEventListener('click', () => sdlg.classList.add('hidden'));
sform.addEventListener('submit', (e) => {
  e.preventDefault();
  settings = { fontSize: Number(sform.fontSize.value) || 14, fontFamily: sform.fontFamily.value || settings.fontFamily,
    theme: sform.theme.value, copyOnSelect: sform.copyOnSelect.checked };
  store.set('settings', settings);
  for (const t of tabs) t.applySettings?.();
  sdlg.classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { dlg.classList.add('hidden'); sdlg.classList.add('hidden'); }
});

// ---------- tabovi ----------
const tabs = [];
let active = null;

function addTab(tab) {
  tabs.push(tab);
  const el = document.createElement('div');
  el.className = 'tab';
  el.innerHTML = `<span class="dot"></span><span class="title">${esc(tab.title)}</span><button class="x" title="Zatvori">×</button>`;
  el.addEventListener('click', (e) => { if (e.target.closest('.x')) closeTab(tab); else activate(tab); });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab); });
  tab.tabEl = el;
  tab.pane.__tab = tab; // za inline gumb "Pokušaj ponovno"
  $('#tabs').appendChild(el);
  $('#panes').appendChild(tab.pane);
  $('#welcome').classList.add('hidden');
  activate(tab);
}
function setTabState(tab, state) {
  const d = tab.tabEl?.querySelector('.dot');
  if (d) d.className = 'dot' + (state === 'on' ? ' on' : state === 'err' ? ' err' : '');
}
function activate(tab) {
  active = tab;
  for (const t of tabs) {
    t.tabEl.classList.toggle('active', t === tab);
    t.pane.classList.toggle('hidden-pane', t !== tab);
  }
  tab.onShow?.();
  document.title = tab.title + ' - MTerm';
}
function closeTab(tab) {
  tab.destroy?.();
  tab.tabEl.remove();
  tab.pane.remove();
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (active === tab) {
    const next = tabs[i] || tabs[i - 1];
    if (next) activate(next);
    else { active = null; $('#welcome').classList.remove('hidden'); document.title = 'MTerm'; }
  }
}

function openConnection(c) {
  if (PROTO[c.protocol]?.kind === 'term') addTab(new TerminalTab(c));
  else addTab(new FileTab(c));
  $('#sidebar').classList.remove('open');
}

// ---------- SSH terminal ----------
class TerminalTab {
  constructor(conn) {
    this.conn = conn;
    this.title = (conn.name || conn.host) + ' (SSH)';
    this.pane = document.createElement('div');
    this.pane.className = 'pane';
    this.pane.innerHTML = `<div class="toolbar">
        <button class="btn small" data-a="reconnect">↻ Ponovno spoji</button>
        <button class="btn small" data-a="sftp">📁 SFTP</button>
        <button class="btn small" data-a="paste" title="Zalijepi iz međuspremnika">Zalijepi</button>
        <button class="btn small" data-a="zoomout" title="Manji font">A−</button>
        <button class="btn small" data-a="zoomin" title="Veći font">A+</button>
        <span class="status"></span></div>
      <div class="term-wrap"></div>`;
    this.statusEl = $('.status', this.pane);
    this.term = new Terminal({
      cursorBlink: true, fontSize: settings.fontSize, fontFamily: settings.fontFamily, theme: THEMES[settings.theme],
      scrollback: 10000, allowProposedApi: true, macOptionIsMeta: true,
    });
    this.fit = new FitAddon.FitAddon();
    this.term.loadAddon(this.fit);
    try { this.term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}
    this.term.open($('.term-wrap', this.pane));
    this.term.onData((d) => this.send({ type: 'data', data: d }));
    this.term.onBinary((d) => this.send({ type: 'data', data: d }));
    this.term.onResize(({ cols, rows }) => this.send({ type: 'resize', cols, rows }));
    this.term.onSelectionChange(() => {
      if (settings.copyOnSelect && this.term.hasSelection()) navigator.clipboard?.writeText(this.term.getSelection()).catch(() => {});
    });
    this.term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Shift+C / Ctrl+Shift+V
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        navigator.clipboard?.writeText(this.term.getSelection()).catch(() => {});
        return false;
      }
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyV') { this.paste(); return false; }
      return true;
    });
    this.pane.querySelector('.toolbar').addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'reconnect') this.connect();
      if (a === 'sftp') openConnection({ ...this.conn, protocol: 'sftp' });
      if (a === 'paste') this.paste();
      if (a === 'zoomin' || a === 'zoomout') {
        this.term.options.fontSize = Math.max(8, Math.min(32, this.term.options.fontSize + (a === 'zoomin' ? 1 : -1)));
        this.doFit();
      }
    });
    this.ro = new ResizeObserver(() => this.doFit());
    this.ro.observe($('.term-wrap', this.pane));
    setTimeout(() => this.connect(), 0);
  }
  applySettings() {
    Object.assign(this.term.options, { fontSize: settings.fontSize, fontFamily: settings.fontFamily, theme: THEMES[settings.theme] });
    this.doFit();
  }
  doFit() {
    if (this.pane.classList.contains('hidden-pane')) return;
    try { this.fit.fit(); } catch {}
  }
  onShow() { setTimeout(() => { this.doFit(); this.term.focus(); }, 0); }
  async paste() {
    try { const t = await navigator.clipboard.readText(); if (t) this.send({ type: 'data', data: t }); }
    catch { toast('Preglednik ne dopušta čitanje međuspremnika (potreban HTTPS).', true); }
  }
  setStatus(s) { this.statusEl.textContent = s; }
  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  connect() {
    try { this.ws?.close(); } catch {}
    this.doFit();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = location.pathname.replace(/[^/]*$/, '');
    const ws = new WebSocket(`${proto}//${location.host}${base}ws/ssh`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    setTabState(this, '');
    ws.onopen = () => {
      const c = this.conn;
      ws.send(JSON.stringify({ type: 'connect', host: c.host, port: c.port, username: c.username, password: c.password,
        privateKey: c.privateKey, passphrase: c.passphrase, cols: this.term.cols, rows: this.term.rows }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') { this.term.write(new Uint8Array(ev.data)); return; }
      const m = JSON.parse(ev.data);
      if (m.type === 'status') { this.setStatus(m.message); this.term.write(`\x1b[90m${m.message}\x1b[0m\r\n`); }
      else if (m.type === 'hostkey') this.setStatus('Ključ hosta: ' + m.fingerprint);
      else if (m.type === 'ready') { setTabState(this, 'on'); this.setStatus(`${this.conn.username}@${this.conn.host} · spojeno`); this.term.focus(); this.doFit(); this.send({ type: 'resize', cols: this.term.cols, rows: this.term.rows }); }
      else if (m.type === 'error') { setTabState(this, 'err'); this.setStatus(m.message); this.term.write(`\r\n\x1b[31m${m.message}\x1b[0m\r\n`); }
      else if (m.type === 'closed') { setTabState(this, ''); this.setStatus(m.message); this.term.write(`\r\n\x1b[33m${m.message} Kliknite "Ponovno spoji".\x1b[0m\r\n`); }
    };
    let opened = false;
    ws.addEventListener('open', () => { opened = true; });
    ws.onclose = async () => {
      if (this.ws !== ws) return;
      setTabState(this, '');
      if (!opened) {
        const me = await fetch('api/me').then((r) => r.json()).catch(() => null);
        if (me?.authRequired && !me.authenticated) showLogin();
        else this.term.write('\r\n\x1b[31mWebSocket veza na MTerm server nije uspjela (provjerite proxy/WebSocket podršku).\x1b[0m\r\n');
      }
    };
  }
  destroy() { try { this.ws?.close(); } catch {} this.ro.disconnect(); this.term.dispose(); }
}

// ---------- upravitelj datoteka ----------
const fmtSize = (n) => {
  if (n == null || isNaN(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
};
const fmtDate = (t) => (t ? new Date(t).toLocaleString('hr-HR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const joinPath = (dir, name) => (dir.endsWith('/') ? dir : dir + '/') + name;
const parentPath = (p) => { const s = p.replace(/\/+$/, '').split('/'); s.pop(); return s.join('/') || '/'; };

class FileTab {
  constructor(conn) {
    this.conn = conn;
    this.title = (conn.name || conn.host) + ` (${PROTO[conn.protocol].label})`;
    this.path = '/';
    this.items = [];
    this.sel = new Set();
    this.sort = { key: 'name', dir: 1 };
    this.pane = document.createElement('div');
    this.pane.className = 'pane';
    this.pane.innerHTML = `<div class="fm">
      <div class="toolbar">
        <button class="btn small" data-a="up" title="Mapa iznad">⬆</button>
        <button class="btn small" data-a="refresh" title="Osvježi">↻</button>
        <form class="pathbar"><input name="path" spellcheck="false"></form>
        <button class="btn small" data-a="upload">⤒ Pošalji</button>
        <button class="btn small" data-a="download">⤓ Preuzmi</button>
        <button class="btn small" data-a="mkdir">+ Mapa</button>
        <button class="btn small" data-a="rename">Preimenuj</button>
        <button class="btn small danger" data-a="delete">Obriši</button>
        <input type="file" multiple hidden>
      </div>
      <div class="toolbar"><span class="status">Spajanje...</span></div>
      <div class="list"><table><thead><tr>
        <th data-k="name">Naziv</th><th data-k="size" class="num">Veličina</th><th data-k="mtime">Izmijenjeno</th><th data-k="perms" class="perm">Prava</th>
      </tr></thead><tbody></tbody></table></div>
      <div class="transfers"></div></div>`;
    this.statusEl = $('.status', this.pane);
    this.tbody = $('tbody', this.pane);
    this.listEl = $('.list', this.pane);
    this.fileInput = $('input[type=file]', this.pane);
    this.transfersEl = $('.transfers', this.pane);

    $('.fm > .toolbar', this.pane).addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a && this[a]) this[a]();
    });
    $('.pathbar', this.pane).addEventListener('submit', (e) => { e.preventDefault(); this.cd(e.target.path.value.trim() || '/'); });
    this.fileInput.addEventListener('change', () => { this.uploadFiles([...this.fileInput.files]); this.fileInput.value = ''; });
    $('thead', this.pane).addEventListener('click', (e) => {
      const k = e.target.closest('th')?.dataset.k;
      if (!k) return;
      this.sort = { key: k, dir: this.sort.key === k ? -this.sort.dir : 1 };
      this.render();
    });
    // povuci i ispusti
    let dragDepth = 0;
    this.listEl.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); if (dragDepth++ === 0) this.showDrop(true); } });
    this.listEl.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; this.showDrop(false); } });
    this.listEl.addEventListener('dragover', (e) => e.preventDefault());
    this.listEl.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; this.showDrop(false);
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) this.uploadFiles(files);
    });
    this.pane.tabIndex = 0;
    this.pane.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Delete') this.delete();
      else if (e.key === 'F2') this.rename();
      else if (e.key === 'Backspace') this.up();
      else if (e.key === 'F5') { e.preventDefault(); this.refresh(); }
    });
    this.connect();
  }

  setStatus(s) { this.statusEl.textContent = s; }
  showDrop(on) {
    let dz = $('.dropzone', this.listEl);
    if (on && !dz) this.listEl.insertAdjacentHTML('beforeend', '<div class="dropzone">Ispustite datoteke za slanje</div>');
    if (!on && dz) dz.remove();
  }
  url(action, p) { return `api/fs/${this.sid}/${action}?path=${encodeURIComponent(p)}`; }

  async connect() {
    setTabState(this, '');
    this.setStatus('Spajanje na ' + this.conn.host + ' ...');
    try {
      const c = this.conn;
      const r = await api('api/fs/connect', { method: 'POST', body: JSON.stringify({
        protocol: c.protocol, host: c.host, port: c.port, username: c.username, password: c.password,
        privateKey: c.privateKey, passphrase: c.passphrase, ftpsMode: c.ftpsMode, insecure: c.insecure, basePath: c.basePath }) });
      this.sid = r.id;
      setTabState(this, 'on');
      if (r.fingerprint) toast('Ključ hosta ' + c.host + ': ' + r.fingerprint, false, 6000);
      await this.cd(r.home || '/');
    } catch (err) {
      setTabState(this, 'err');
      this.setStatus('Greška: ' + err.message);
      this.tbody.innerHTML = `<tr><td colspan="4" class="empty">${esc(err.message)}<br><br><button class="btn" onclick="this.closest('.pane').__tab.connect()">Pokušaj ponovno</button></td></tr>`;
    }
  }

  async call(fn) {
    try { return await fn(); }
    catch (err) {
      if (/Sesija ne postoji/.test(err.message)) {
        toast('Sesija je istekla - ponovno spajanje...', true);
        await this.connect();
        return;
      }
      toast(err.message, true);
      this.setStatus('Greška: ' + err.message);
      throw err;
    }
  }

  async cd(p) {
    this.setStatus('Učitavanje ' + p + ' ...');
    try {
      const r = await this.call(() => api(this.url('list', p)));
      if (!r) return;
      this.path = r.path;
      this.items = r.items;
      this.sel.clear();
      $('.pathbar input', this.pane).value = this.path;
      this.render();
      const dirs = r.items.filter((i) => i.type === 'dir').length;
      this.setStatus(`${this.conn.username ? this.conn.username + '@' : ''}${this.conn.host} · ${dirs} mapa, ${r.items.length - dirs} datoteka`);
    } catch {}
  }

  isDir(i) { return i.type === 'dir' || i.target === 'dir'; }

  render() {
    const { key, dir } = this.sort;
    const items = [...this.items].sort((a, b) => {
      if (this.isDir(a) !== this.isDir(b)) return this.isDir(a) ? -1 : 1;
      const va = a[key], vb = b[key];
      if (typeof va === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'hr', { numeric: true, sensitivity: 'base' }) * dir;
    });
    this.tbody.innerHTML = '';
    if (this.path !== '/') {
      const tr = document.createElement('tr');
      tr.className = 'row';
      tr.innerHTML = '<td class="name"><span class="icon">📁</span>..</td><td></td><td></td><td class="perm"></td>';
      tr.addEventListener('dblclick', () => this.up());
      this.tbody.appendChild(tr);
    }
    if (!items.length) this.tbody.insertAdjacentHTML('beforeend', '<tr><td colspan="4" class="empty">Mapa je prazna. Povucite datoteke ovdje za slanje.</td></tr>');
    for (const i of items) {
      const tr = document.createElement('tr');
      tr.className = 'row' + (this.sel.has(i.name) ? ' sel' : '');
      const icon = this.isDir(i) ? (i.type === 'link' ? '🔗' : '📁') : i.type === 'link' ? '🔗' : '📄';
      tr.innerHTML = `<td class="name" title="${esc(i.name)}"><span class="icon">${icon}</span>${esc(i.name)}</td>
        <td class="num">${this.isDir(i) ? '' : fmtSize(i.size)}</td><td>${fmtDate(i.mtime)}</td><td class="mono perm">${esc(i.perms)}</td>`;
      tr.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) { this.sel.has(i.name) ? this.sel.delete(i.name) : this.sel.add(i.name); }
        else if (e.shiftKey && this.lastClick != null) {
          const names = items.map((x) => x.name);
          const [a, b] = [names.indexOf(this.lastClick), names.indexOf(i.name)].sort((x, y) => x - y);
          names.slice(a, b + 1).forEach((n) => this.sel.add(n));
        } else { this.sel.clear(); this.sel.add(i.name); }
        this.lastClick = i.name;
        this.tbody.querySelectorAll('tr.row').forEach((r) => r.classList.toggle('sel', this.sel.has(r.querySelector('.name')?.title)));
      });
      tr.addEventListener('dblclick', () => {
        if (this.isDir(i)) this.cd(joinPath(this.path, i.name));
        else this.downloadItem(i);
      });
      this.tbody.appendChild(tr);
    }
  }

  selected() { return this.items.filter((i) => this.sel.has(i.name)); }
  up() { if (this.path !== '/') this.cd(parentPath(this.path)); }
  refresh() { if (this.sid) this.cd(this.path); else this.connect(); }
  upload() { this.fileInput.click(); }

  download() {
    const files = this.selected().filter((i) => !this.isDir(i));
    if (!files.length) return toast('Označite jednu ili više datoteka.', true);
    files.forEach((f, n) => setTimeout(() => this.downloadItem(f), n * 400));
  }
  downloadItem(i) {
    const a = document.createElement('a');
    a.href = this.url('download', joinPath(this.path, i.name));
    a.download = i.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async mkdir() {
    const name = prompt('Naziv nove mape:');
    if (!name) return;
    try { await this.call(() => api(this.url('mkdir', joinPath(this.path, name)), { method: 'POST' })); this.refresh(); } catch {}
  }
  async rename() {
    const [i] = this.selected();
    if (!i) return toast('Označite stavku za preimenovanje.', true);
    const name = prompt('Novi naziv:', i.name);
    if (!name || name === i.name) return;
    const to = name.startsWith('/') ? name : joinPath(this.path, name);
    try {
      await this.call(() => api(this.url('rename', joinPath(this.path, i.name)), { method: 'POST', body: JSON.stringify({ to }) }));
      this.refresh();
    } catch {}
  }
  async delete() {
    const items = this.selected();
    if (!items.length) return toast('Označite stavke za brisanje.', true);
    const hasDir = items.some((i) => this.isDir(i) && i.type !== 'link');
    if (!confirm(`Obrisati ${items.length === 1 ? '"' + items[0].name + '"' : items.length + ' stavki'}?${hasDir ? '\nMape se brišu zajedno sa sadržajem!' : ''}`)) return;
    for (const i of items) {
      try {
        await this.call(() => api(this.url('delete', joinPath(this.path, i.name)), { method: 'POST',
          body: JSON.stringify({ isDir: i.type === 'dir' }) }));
      } catch { break; }
    }
    this.refresh();
  }

  async uploadFiles(files) {
    if (!this.sid) return;
    const dir = this.path;
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'transfer';
      row.innerHTML = `<span class="tname">⤒ ${esc(f.name)} (${fmtSize(f.size)})</span><progress max="100" value="0"></progress><span class="tstate">0%</span>`;
      this.transfersEl.prepend(row);
      const prog = $('progress', row), st = $('.tstate', row);
      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', this.url('upload', joinPath(dir, f.name)));
          xhr.setRequestHeader('X-File-Size', String(f.size));
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const p = Math.round((e.loaded / e.total) * 100); prog.value = p; st.textContent = p + '%'; } };
          xhr.onload = () => {
            let d = {};
            try { d = JSON.parse(xhr.responseText); } catch {}
            if (xhr.status === 401) showLogin();
            xhr.status === 200 ? resolve() : reject(new Error(d.error || 'HTTP ' + xhr.status));
          };
          xhr.onerror = () => reject(new Error('Mrežna greška'));
          xhr.send(f);
        });
        row.classList.add('done');
        prog.value = 100;
        st.textContent = 'Gotovo';
      } catch (err) {
        row.classList.add('fail');
        st.textContent = err.message;
        toast(`${f.name}: ${err.message}`, true);
      }
      setTimeout(() => row.classList.contains('done') && row.remove(), 8000);
    }
    if (this.path === dir) this.refresh();
  }

  onShow() { this.pane.focus({ preventScroll: true }); }
  destroy() {
    if (this.sid) fetch(`api/fs/${this.sid}/close`, { method: 'POST' }).catch(() => {});
  }
}
// ---------- pokretanje ----------
(async function init() {
  // izbornik za mobilne uređaje
  const menu = document.createElement('div');
  menu.className = 'tab menu-btn';
  menu.textContent = '☰';
  menu.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#tabs').appendChild(menu);

  renderConnections();
  try {
    const me = await fetch('api/me').then((r) => r.json());
    $('#version').textContent = 'v' + me.version;
    if (me.authRequired) $('#btnLogout').classList.remove('hidden');
    if (me.authRequired && !me.authenticated) showLogin();
  } catch { toast('Server MTerm nije dostupan.', true); }
})();
