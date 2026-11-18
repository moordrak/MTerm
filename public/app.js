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

const THEMES = window.MTERM_THEMES;

// ---------- spremanje ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('mterm.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mterm.' + k, JSON.stringify(v)); } catch {} },
};
const DEFAULT_SETTINGS = {
  fontSize: 14, fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", Menlo, Consolas, monospace',
  theme: 'dark', syncUi: true, accent: '', cursorStyle: 'block', copyOnSelect: false,
  background: 'none', bgSpeed: 1, bgImage: '', termOpacity: 1, uiOpacity: 1, blur: 0,
  sidebar: 'visible',
};
let connections = store.get('connections', []);
let settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
if (!THEMES[settings.theme]) settings.theme = 'dark';
// način pohrane je vezan uz preglednik: 'local' ili 'server'
let storageMode = store.get('storageMode', 'local');
let serverAvailable = false;

let serverSaveTimer = null;
function scheduleServerSave() {
  if (storageMode !== 'server' || !serverAvailable) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(pushToServer, 400);
}
async function pushToServer() {
  try {
    await api('api/store', { method: 'PUT', body: JSON.stringify({ connections, settings }) });
  } catch (e) { toast('Spremanje na server nije uspjelo: ' + e.message, true); }
}
async function pullFromServer() {
  const d = await api('api/store');
  connections = Array.isArray(d.connections) ? d.connections : [];
  if (d.settings) settings = { ...DEFAULT_SETTINGS, ...d.settings };
  if (!THEMES[settings.theme]) settings.theme = 'dark';
  return d;
}
function localCopy(list) { // u preglednik se lozinke spremaju samo ako je to odabrano
  return list.map((c) => (c.savePassword ? c : (({ password, privateKey, passphrase, ...r }) => r)(c)));
}
const saveConnections = () => {
  if (storageMode === 'server') scheduleServerSave();
  else store.set('connections', localCopy(connections));
};
const saveSettings = () => {
  store.set('settings', settings);
  scheduleServerSave();
};

// ---------- izgled: teme, prozirnost, pozadine ----------
function hexRgb(h) {
  h = String(h || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const rgbaOf = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
const luminance = (h) => { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

function currentTheme() { return THEMES[settings.theme] || THEMES.dark; }
function accentColor() { return settings.accent || currentTheme().accent; }

function termTheme() {
  const c = { ...currentTheme().colors };
  // pozadinu daje okvir (.term-wrap) pa terminal mora biti potpuno proziran
  if (settings.termOpacity < 1) c.background = 'rgba(0,0,0,0)';
  return c;
}

// ---------- bočni izbornik ----------
function applySidebar() {
  const mode = ['visible', 'hidden', 'auto'].includes(settings.sidebar) ? settings.sidebar : 'visible';
  document.body.classList.toggle('sb-hidden', mode === 'hidden');
  document.body.classList.toggle('sb-auto', mode === 'auto');
  if (mode === 'visible') $('#sidebar').classList.remove('open');
}
function setSidebarMode(mode) {
  settings.sidebar = mode;
  applySidebar();
  saveSettings();
}
function toggleSidebar() {
  if (window.matchMedia('(max-width: 760px)').matches || settings.sidebar !== 'visible') {
    $('#sidebar').classList.toggle('open');
    if ($('#sidebar').classList.contains('open')) setTimeout(() => $('#search').focus(), 50);
    else active?.onShow?.();
  } else {
    setSidebarMode('hidden');
  }
}

function applyAppearance() {
  applySidebar();
  const t = currentTheme(), c = t.colors, root = document.documentElement.style;
  const acc = accentColor();
  const op = Number(settings.uiOpacity);
  let ui;
  if (settings.syncUi) {
    const bg = c.background, fg = c.foreground, light = luminance(bg) > 0.5;
    ui = {
      bg, panel: mix(bg, fg, light ? 0.05 : 0.06), panel2: mix(bg, fg, light ? 0.1 : 0.13), border: mix(bg, fg, 0.2),
      text: fg, muted: mix(fg, bg, 0.4), line: mix(bg, fg, 0.07), hover: mix(bg, fg, 0.09), light,
    };
  } else {
    ui = { bg: '#0b1020', panel: '#111827', panel2: '#1f2937', border: '#2b3546', text: '#e5e7eb', muted: '#8b95a7',
      line: '#161e2e', hover: '#141c2c', light: false };
  }
  root.setProperty('--bg', ui.bg);
  root.setProperty('--panel', ui.panel);
  root.setProperty('--panel2', ui.panel2);
  root.setProperty('--border', ui.border);
  root.setProperty('--text', ui.text);
  root.setProperty('--muted', ui.muted);
  root.setProperty('--line', ui.line);
  root.setProperty('--hover', ui.hover);
  root.setProperty('--accent', acc);
  root.setProperty('--accent2', mix(acc, ui.light ? '#000000' : '#000000', 0.25));
  root.setProperty('--on-accent', luminance(mix(acc, '#000000', 0.25)) > 0.6 ? '#000' : '#fff');
  root.setProperty('--selbg', rgbaOf(acc, 0.25));
  root.setProperty('--bg-a', rgbaOf(ui.bg, op));
  root.setProperty('--panel-a', rgbaOf(ui.panel, op));
  root.setProperty('--term-a', rgbaOf(c.background, settings.termOpacity));
  root.setProperty('--blur', (Number(settings.blur) || 0) + 'px');
  root.setProperty('color-scheme', ui.light ? 'light' : 'dark');
  document.body.style.background = ui.bg;
  const palette = [acc, c.magenta, c.blue, c.cyan, c.green, c.yellow].filter(Boolean);
  window.MTermBackground?.set({ name: settings.background, speed: Number(settings.bgSpeed), image: settings.bgImage,
    accent: acc, bg: ui.bg, fg: c.foreground, palette });
}

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
    window.__afterLogin?.();
    window.__afterLogin = null;
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
let settingsBackup = null;
{
  const sel = sform.theme;
  const dark = [], light = [];
  for (const [k, t] of Object.entries(THEMES)) (luminance(t.colors.background) > 0.5 ? light : dark).push([k, t]);
  for (const [label, list] of [['Tamne', dark], ['Svijetle', light]]) {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const [k, t] of list) g.appendChild(new Option(t.name, k));
    sel.appendChild(g);
  }
  const bg = sform.background;
  bg.appendChild(new Option('Bez pozadine', 'none'));
  for (const [k, label] of Object.entries(window.MTermBackground?.effects || {})) bg.appendChild(new Option(label, k));
  bg.appendChild(new Option('Slika (URL)', 'image'));
}
const fmtVal = { bgSpeed: (v) => Number(v).toFixed(1) + '×', termOpacity: (v) => Math.round(v * 100) + '%',
  uiOpacity: (v) => Math.round(v * 100) + '%', blur: (v) => v + ' px' };
function settingsFormValues() {
  return {
    theme: sform.theme.value, syncUi: sform.syncUi.checked, accent: sform.accent.dataset.touched ? sform.accent.value : settings.accent,
    background: sform.background.value, bgSpeed: Number(sform.bgSpeed.value), bgImage: sform.bgImage.value.trim(),
    termOpacity: Number(sform.termOpacity.value), uiOpacity: Number(sform.uiOpacity.value), blur: Number(sform.blur.value),
    fontSize: Number(sform.fontSize.value) || 14, fontFamily: sform.fontFamily.value || DEFAULT_SETTINGS.fontFamily,
    cursorStyle: sform.cursorStyle.value, copyOnSelect: sform.copyOnSelect.checked, sidebar: sform.sidebar.value,
  };
}
function fillSettingsForm(st) {
  for (const k of ['theme', 'background', 'bgSpeed', 'bgImage', 'termOpacity', 'uiOpacity', 'blur', 'fontSize', 'fontFamily', 'cursorStyle', 'sidebar']) sform[k].value = st[k];
  sform.syncUi.checked = st.syncUi;
  sform.copyOnSelect.checked = st.copyOnSelect;
  sform.accent.value = st.accent || (THEMES[st.theme] || THEMES.dark).accent;
  delete sform.accent.dataset.touched;
  sform.serverStorage.checked = storageMode === 'server';
  sform.serverStorage.disabled = !serverAvailable;
  $('#storageInfo').textContent = serverAvailable
    ? (storageMode === 'server' ? 'Veze i postavke spremaju se na MTerm server. Lozinke su na serveru šifrirane (AES-256-GCM).'
      : 'Veze se trenutno spremaju samo u ovom pregledniku.')
    : 'Pohrana na serveru je isključena (MTERM_SERVER_STORAGE=false).';
  updateSettingsLabels();
}
function updateSettingsLabels() {
  sform.querySelectorAll('.val').forEach((el) => { el.textContent = fmtVal[el.dataset.for](sform[el.dataset.for].value); });
  sform.querySelectorAll('.only-image').forEach((el) => el.classList.toggle('hidden', sform.background.value !== 'image'));
}
function previewSettings() {
  settings = { ...settings, ...settingsFormValues() };
  applyAppearance();
  for (const t of tabs) t.applySettings?.();
}
sform.addEventListener('input', (e) => {
  if (e.target.name === 'accent') e.target.dataset.touched = '1';
  if (e.target.name === 'theme' && !sform.accent.dataset.touched) sform.accent.value = THEMES[sform.theme.value].accent;
  if (e.target.name === 'serverStorage') return;
  updateSettingsLabels();
  previewSettings();
});
$('#btnSettings').addEventListener('click', () => {
  settingsBackup = { ...settings };
  fillSettingsForm(settings);
  sdlg.classList.remove('hidden');
});
function closeSettings(restore) {
  if (restore && settingsBackup) {
    settings = settingsBackup;
    applyAppearance();
    for (const t of tabs) t.applySettings?.();
  }
  settingsBackup = null;
  sdlg.classList.add('hidden');
}
$('#btnSettingsCancel').addEventListener('click', () => closeSettings(true));
$('#btnSettingsReset').addEventListener('click', () => {
  fillSettingsForm({ ...DEFAULT_SETTINGS });
  sform.accent.dataset.touched = '';
  delete sform.accent.dataset.touched;
  previewSettings();
  settings.accent = '';
});
sform.addEventListener('submit', async (e) => {
  e.preventDefault();
  settings = { ...settings, ...settingsFormValues() };
  const wantServer = sform.serverStorage.checked && serverAvailable;
  if (wantServer && storageMode !== 'server') await switchToServer();
  else if (!wantServer && storageMode === 'server') switchToLocal();
  saveSettings();
  applyAppearance();
  for (const t of tabs) t.applySettings?.();
  settingsBackup = null;
  sdlg.classList.add('hidden');
});

async function switchToServer() {
  try {
    const local = connections;
    const remote = (await api('api/store')).connections || [];
    // spajanje: veze s istim ID-jem iz preglednika imaju prednost
    const byId = new Map(remote.map((c) => [c.id, c]));
    for (const c of local) byId.set(c.id || uid(), { ...byId.get(c.id), ...c });
    connections = [...byId.values()];
    storageMode = 'server';
    store.set('storageMode', storageMode);
    await pushToServer();
    store.set('connections', []); // lokalna kopija više nije potrebna
    renderConnections();
    toast(`Veze su sada spremljene na serveru (${connections.length}).`);
  } catch (e) { toast('Prebacivanje na server nije uspjelo: ' + e.message, true); }
}
function switchToLocal() {
  storageMode = 'local';
  store.set('storageMode', storageMode);
  store.set('connections', localCopy(connections));
  toast('Veze se sada spremaju u ovom pregledniku. Kopija na serveru je zadržana.');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { dlg.classList.add('hidden'); if (!sdlg.classList.contains('hidden')) closeSettings(true); }
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
      cursorBlink: true, fontSize: settings.fontSize, fontFamily: settings.fontFamily, theme: termTheme(),
      cursorStyle: settings.cursorStyle, allowTransparency: true,
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
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyB') { if (e.type === 'keydown') toggleSidebar(); return false; }
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
    Object.assign(this.term.options, { fontSize: settings.fontSize, fontFamily: settings.fontFamily, theme: termTheme(),
      cursorStyle: settings.cursorStyle });
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
// hrvatska množina: plural(n, 'datoteka', 'datoteke', 'datoteka')
const plural = (n, one, few, many) => {
  const d = n % 10, h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many}`;
};
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
        <button class="btn small" data-a="upload" title="Pošalji datoteke">⤒ Pošalji</button>
        <button class="btn small" data-a="uploadFolder" title="Pošalji cijelu mapu s podmapama">⤒ Pošalji mapu</button>
        <button class="btn small" data-a="download">⤓ Preuzmi</button>
        <button class="btn small" data-a="mkdir">+ Mapa</button>
        <button class="btn small" data-a="rename">Preimenuj</button>
        <button class="btn small danger" data-a="delete">Obriši</button>
        <input type="file" multiple hidden class="pick-files">
        <input type="file" multiple hidden class="pick-folder" webkitdirectory directory>
      </div>
      <div class="toolbar"><span class="status">Spajanje...</span></div>
      <div class="list"><table><thead><tr>
        <th data-k="name">Naziv</th><th data-k="size" class="num">Veličina</th><th data-k="mtime">Izmijenjeno</th><th data-k="perms" class="perm">Prava</th>
      </tr></thead><tbody></tbody></table></div>
      <div class="transfers"></div></div>`;
    this.statusEl = $('.status', this.pane);
    this.tbody = $('tbody', this.pane);
    this.listEl = $('.list', this.pane);
    this.fileInput = $('.pick-files', this.pane);
    this.folderInput = $('.pick-folder', this.pane);
    this.transfersEl = $('.transfers', this.pane);

    $('.fm > .toolbar', this.pane).addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a && this[a]) this[a]();
    });
    $('.pathbar', this.pane).addEventListener('submit', (e) => { e.preventDefault(); this.cd(e.target.path.value.trim() || '/'); });
    this.fileInput.addEventListener('change', () => { this.uploadFiles([...this.fileInput.files]); this.fileInput.value = ''; });
    this.folderInput.addEventListener('change', () => {
      const entries = [...this.folderInput.files].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name }));
      this.folderInput.value = '';
      if (entries.length) this.uploadTree(entries, []);
    });
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
      // stavke treba uzeti odmah, dok je događaj aktivan
      const roots = [...(e.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
      const files = [...(e.dataTransfer.files || [])];
      if (roots.some((r) => r.isDirectory)) {
        this.setStatus('Čitanje sadržaja mape...');
        readDroppedEntries(roots).then(({ entries, dirs }) => this.uploadTree(entries, dirs))
          .catch((err) => toast('Čitanje mape nije uspjelo: ' + err.message, true));
      } else if (files.length) this.uploadFiles(files);
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
      this.setStatus(`${this.conn.username ? this.conn.username + '@' : ''}${this.conn.host} · ${plural(dirs, 'mapa', 'mape', 'mapa')}, ${plural(r.items.length - dirs, 'datoteka', 'datoteke', 'datoteka')}`);
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
  uploadFolder() { this.folderInput.click(); }

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

  // slanje jedne datoteke; onProgress(učitano bajtova); vraća {promise, abort}
  sendFile(remotePath, f, onProgress) {
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
      xhr.open('PUT', this.url('upload', remotePath));
      xhr.setRequestHeader('X-File-Size', String(f.size));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
      xhr.onload = () => {
        let d = {};
        try { d = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status === 401) showLogin();
        xhr.status === 200 ? resolve() : reject(new Error(d.error || 'HTTP ' + xhr.status));
      };
      xhr.onerror = () => reject(new Error('Mrežna greška'));
      xhr.onabort = () => reject(new Error('Prekinuto'));
      xhr.send(f);
    });
    return { promise, abort: () => xhr.abort() };
  }

  // Slanje strukture mapa: entries = [{file, rel: 'mapa/pod/datoteka.txt'}], dirs = ['mapa/prazna']
  async uploadTree(entries, dirs) {
    if (!this.sid) return;
    const base = this.path;
    const allDirs = new Set(dirs);
    for (const e of entries) {
      const parts = e.rel.split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) allDirs.add(parts.slice(0, i).join('/'));
    }
    const dirList = [...allDirs].filter(Boolean).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    const tops = [...new Set(entries.map((e) => e.rel.split('/')[0]).concat(dirList.map((d) => d.split('/')[0])))];
    const total = entries.reduce((s, e) => s + e.file.size, 0);

    const row = document.createElement('div');
    row.className = 'transfer';
    row.innerHTML = `<span class="tname">📁 ${esc(tops.length === 1 ? tops[0] : plural(tops.length, 'mapa', 'mape', 'mapa'))}
        · ${plural(entries.length, 'datoteka', 'datoteke', 'datoteka')} · ${fmtSize(total)} <span class="muted tcur"></span></span>
      <progress max="100" value="0"></progress><span class="tstate">0%</span>
      <button class="icon-btn tcancel" title="Prekini">✕</button>`;
    this.transfersEl.prepend(row);
    const prog = $('progress', row), st = $('.tstate', row), cur = $('.tcur', row);
    let cancelled = false, current = null;
    $('.tcancel', row).addEventListener('click', () => { cancelled = true; current?.abort(); });

    const failed = [];
    try {
      // 1) mape
      for (let i = 0; i < dirList.length && !cancelled; i++) {
        cur.textContent = `· mapa ${i + 1}/${dirList.length}`;
        try {
          await api(this.url('mkdir', joinPath(base, dirList[i])) + '&ensure=1', { method: 'POST' });
        } catch (err) {
          throw new Error(`Mapa "${dirList[i]}": ${err.message}`);
        }
      }
      // 2) datoteke
      let done = 0;
      for (let i = 0; i < entries.length && !cancelled; i++) {
        const { file, rel } = entries[i];
        cur.textContent = `· ${i + 1}/${entries.length} ${rel}`;
        current = this.sendFile(joinPath(base, rel), file, (loaded) => {
          const p = total ? Math.round(((done + loaded) / total) * 100) : Math.round((i / entries.length) * 100);
          prog.value = p; st.textContent = p + '%';
        });
        try { await current.promise; }
        catch (err) { if (!cancelled) failed.push(`${rel}: ${err.message}`); }
        done += file.size;
      }
      current = null;
      $('.tcancel', row).remove();
      if (cancelled) {
        row.classList.add('fail'); st.textContent = 'Prekinuto'; cur.textContent = '';
      } else if (failed.length) {
        row.classList.add('fail');
        st.textContent = plural(failed.length, 'greška', 'greške', 'grešaka');
        st.title = failed.join('\n');
        cur.textContent = '';
        toast(`Mapa poslana, ali neuspješno: ${plural(failed.length, 'datoteka', 'datoteke', 'datoteka')} (${failed[0]})`, true, 8000);
      } else {
        row.classList.add('done'); prog.value = 100; st.textContent = 'Gotovo'; cur.textContent = '';
        setTimeout(() => row.remove(), 8000);
      }
    } catch (err) {
      $('.tcancel', row)?.remove();
      row.classList.add('fail'); st.textContent = err.message; cur.textContent = '';
      toast(err.message, true);
    }
    if (this.path === base) this.refresh();
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
        await this.sendFile(joinPath(dir, f.name), f, (loaded) => {
          const p = f.size ? Math.round((loaded / f.size) * 100) : 100;
          prog.value = p; st.textContent = p + '%';
        }).promise;
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
// Čitanje mapa ispuštenih u preglednik (File System Entries API)
async function readDroppedEntries(roots) {
  const entries = [], dirs = [];
  const fileOf = (fe) => new Promise((res, rej) => fe.file(res, rej));
  const readAll = (dirEntry) => new Promise((res, rej) => {
    const reader = dirEntry.createReader(), out = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) return res(out);
      out.push(...batch);
      next(); // readEntries vraća najviše ~100 stavki odjednom
    }, rej);
    next();
  });
  async function walk(entry) {
    const rel = entry.fullPath.replace(/^\/+/, '');
    if (entry.isFile) entries.push({ file: await fileOf(entry), rel });
    else if (entry.isDirectory) {
      dirs.push(rel);
      for (const child of await readAll(entry)) await walk(child);
    }
  }
  for (const r of roots) await walk(r);
  return { entries, dirs };
}

// ---------- pokretanje ----------
(async function init() {
  // izbornik za mobilne uređaje
  const menu = document.createElement('div');
  menu.className = 'tab menu-btn';
  menu.textContent = '☰';
  menu.title = 'Izbornik (Ctrl+Shift+B)';
  menu.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });

  // skrivanje / prikvačivanje izbornika
  $('#btnHideSidebar').addEventListener('click', () => setSidebarMode('hidden'));
  $('#btnPin').addEventListener('click', () => setSidebarMode('visible'));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyB') { e.preventDefault(); toggleSidebar(); }
  });
  // klik izvan otvorenog izbornika ga zatvara
  $('#main').addEventListener('mousedown', () => {
    if ($('#sidebar').classList.contains('open')) $('#sidebar').classList.remove('open');
  });
  // automatski način: lijevi rub ekrana otvara izbornik, izlazak mišem ga zatvara
  const edge = document.createElement('div');
  edge.id = 'sbEdge';
  document.body.appendChild(edge);
  let closeTimer = null;
  edge.addEventListener('mouseenter', () => { if (settings.sidebar === 'auto') $('#sidebar').classList.add('open'); });
  $('#sidebar').addEventListener('mouseenter', () => clearTimeout(closeTimer));
  $('#sidebar').addEventListener('mouseleave', () => {
    if (settings.sidebar !== 'auto') return;
    if (document.activeElement && $('#sidebar').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    closeTimer = setTimeout(() => $('#sidebar').classList.remove('open'), 350);
  });
  $('#tabs').appendChild(menu);

  applyAppearance();
  renderConnections();
  let me = null;
  try {
    me = await fetch('api/me').then((r) => r.json());
    $('#version').textContent = 'v' + me.version;
    serverAvailable = !!me.serverStorage;
    if (me.authRequired) $('#btnLogout').classList.remove('hidden');
  } catch { toast('Server MTerm nije dostupan.', true); return; }
  if (me.authRequired && !me.authenticated) {
    showLogin();
    await new Promise((r) => { window.__afterLogin = r; });
  }
  if (storageMode === 'server') {
    if (!serverAvailable) { storageMode = 'local'; toast('Pohrana na serveru nije dostupna - koriste se lokalne veze.', true); }
    else {
      try { await pullFromServer(); store.set('settings', settings); applyAppearance(); renderConnections(); }
      catch (e) { toast('Učitavanje veza sa servera nije uspjelo: ' + e.message, true); }
    }
  }
})();
