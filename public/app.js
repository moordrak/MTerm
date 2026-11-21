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
  sidebar: 'visible', splitView: true, splitRatio: 0.5,
  keepAlive: true, autoReconnect: true, sshKeep: 15, restoreTabs: true, warnClose: false,
};
let connections = store.get('connections', []);
let settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
if (!THEMES[settings.theme]) settings.theme = 'dark';
// način pohrane je vezan uz preglednik: 'local' ili 'server'
let storageMode = store.get('storageMode', 'local');
let serverAvailable = false;
let sshKeepMax = 240;

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
    keepAlive: sform.keepAlive.checked, autoReconnect: sform.autoReconnect.checked, sshKeep: Number(sform.sshKeep.value),
    restoreTabs: sform.restoreTabs.checked, warnClose: sform.warnClose.checked,
  };
}
function fillSettingsForm(st) {
  for (const k of ['theme', 'background', 'bgSpeed', 'bgImage', 'termOpacity', 'uiOpacity', 'blur', 'fontSize', 'fontFamily', 'cursorStyle', 'sidebar']) sform[k].value = st[k];
  sform.syncUi.checked = st.syncUi;
  for (const k of ['keepAlive', 'autoReconnect', 'restoreTabs', 'warnClose']) sform[k].checked = !!st[k];
  sform.sshKeep.value = String(st.sshKeep);
  if (sform.sshKeep.value === '') sform.sshKeep.value = '15';
  [...sform.sshKeep.options].forEach((o) => { o.disabled = Number(o.value) > sshKeepMax; });
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
  saveOpenTabs();
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
  saveOpenTabs();
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
  saveOpenTabs();
  updateKeepAlive();
}

function openConnection(c) {
  if (PROTO[c.protocol]?.kind === 'term') addTab(new TerminalTab(c));
  else addTab(new FileTab(c));
  $('#sidebar').classList.remove('open');
}

// ---------- održavanje veza i vraćanje tabova ----------
// podaci veze bez tajni (za sessionStorage)
function publicConn(c) {
  const { password, privateKey, passphrase, ...rest } = c || {};
  return rest;
}
function saveOpenTabs() {
  if (!settings.restoreTabs) { try { sessionStorage.removeItem('mterm.openTabs'); } catch {} return; }
  const list = tabs.map((t) => ({ ...(t.snapshot?.() || {}), active: t === active })).filter((x) => x.kind);
  try { sessionStorage.setItem('mterm.openTabs', JSON.stringify(list)); } catch {}
}
function restoreTabs() {
  if (!settings.restoreTabs) return;
  let list = [];
  try { list = JSON.parse(sessionStorage.getItem('mterm.openTabs') || '[]'); } catch {}
  let toActivate = null;
  for (const t of list) {
    // tajne se uzimaju iz spremljenih veza (ako su spremljene)
    const saved = t.conn?.id && connections.find((c) => c.id === t.conn.id);
    const conn = saved ? { ...t.conn, ...saved } : t.conn;
    if (!conn?.host) continue;
    const tab = t.kind === 'term' ? new TerminalTab(conn, { resume: t.sid }) : new FileTab(conn, { sid: t.sid, path: t.path });
    addTab(tab);
    if (t.active) toActivate = tab;
  }
  if (toActivate) activate(toActivate);
  if (list.length) toast(`Vraćeno tabova: ${list.length}`);
}

// Web Lock dok postoje aktivne veze: Chrome/Edge tada rjeđe zamrzavaju tab u pozadini
let keepAliveRelease = null;
function updateKeepAlive() {
  const need = settings.keepAlive && tabs.some((t) => t.isLive?.());
  if (need && !keepAliveRelease && navigator.locks?.request) {
    navigator.locks.request('mterm-aktivne-veze-' + uid(), () => new Promise((res) => { keepAliveRelease = res; })).catch(() => {});
  } else if (!need && keepAliveRelease) {
    keepAliveRelease();
    keepAliveRelease = null;
  }
}
// povratak u fokus / ponovno uspostavljena mreža: odmah obnovi prekinute veze
function wakeAll() { for (const t of tabs) t.wake?.(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeAll(); });
window.addEventListener('online', wakeAll);
window.addEventListener('focus', wakeAll);
window.addEventListener('beforeunload', (e) => {
  if (settings.warnClose && tabs.some((t) => t.isLive?.())) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- SSH terminal ----------
class TerminalTab {
  constructor(conn, opts = {}) {
    this.conn = conn;
    this.kind = 'term';
    this.sessionId = opts.resume || null;
    this.received = 0;     // primljeni bajtovi izlaza (za nadoknadu nakon prekida)
    this.live = false;
    this.retries = 0;
    this.retryTimer = null;
    this.userClosed = false;
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
      if (a === 'reconnect') this.reconnectClicked();
      if (a === 'sftp') openConnection({ ...this.conn, protocol: 'sftp' });
      if (a === 'paste') this.paste();
      if (a === 'zoomin' || a === 'zoomout') {
        this.term.options.fontSize = Math.max(8, Math.min(32, this.term.options.fontSize + (a === 'zoomin' ? 1 : -1)));
        this.doFit();
      }
    });
    this.ro = new ResizeObserver(() => this.doFit());
    this.ro.observe($('.term-wrap', this.pane));
    setTimeout(() => (this.sessionId ? this.openSocket('resume') : this.connect()), 0);
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
  isLive() { return this.live; }
  // nova SSH sesija
  connect() {
    if (needsSecret(this.conn)) return this.askSecret();
    if (this.sessionId) { this.sendClose(); this.sessionId = null; }
    this.openSocket('new');
  }
  reconnectClicked() {
    clearTimeout(this.retryTimer);
    this.retries = 0;
    if (this.live) { this.term.write('\r\n\x1b[90m--- nova sesija ---\x1b[0m\r\n'); this.connect(); }
    else if (this.sessionId) this.openSocket('resume');
    else this.connect();
  }
  askSecret() {
    this.setStatus('Potrebna je lozinka');
    this.term.write('\r\n\x1b[33mZa novu SSH sesiju potrebna je lozinka ili ključ - otvara se prozor veze.\x1b[0m\r\n');
    openDialog(this.conn, true);
    closeTab(this);
  }
  sendClose() { try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'close' })); } catch {} }

  openSocket(mode) {
    clearTimeout(this.retryTimer);
    const old = this.ws;
    this.ws = null;
    try { old?.close(); } catch {}
    this.doFit();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = location.pathname.replace(/[^/]*$/, '');
    const ws = new WebSocket(`${proto}//${location.host}${base}ws/ssh`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.live = false;
    setTabState(this, '');
    let opened = false;
    ws.onopen = () => {
      opened = true;
      const c = this.conn;
      if (mode === 'resume') {
        this.setStatus('Ponovno spajanje na sesiju...');
        ws.send(JSON.stringify({ type: 'resume', id: this.sessionId, since: this.received, cols: this.term.cols, rows: this.term.rows }));
      } else {
        this.received = 0;
        ws.send(JSON.stringify({ type: 'connect', host: c.host, port: c.port, username: c.username, password: c.password,
          privateKey: c.privateKey, passphrase: c.passphrase, cols: this.term.cols, rows: this.term.rows,
          keepMinutes: Number(settings.sshKeep) }));
      }
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (typeof ev.data !== 'string') {
        this.received += ev.data.byteLength;
        this.term.write(new Uint8Array(ev.data));
        return;
      }
      const m = JSON.parse(ev.data);
      if (m.type === 'status') { this.setStatus(m.message); this.term.write(`\x1b[90m${m.message}\x1b[0m\r\n`); }
      else if (m.type === 'hostkey') this.setStatus('Ključ hosta: ' + m.fingerprint);
      else if (m.type === 'session') { this.sessionId = m.id; this.received = 0; saveOpenTabs(); }
      else if (m.type === 'ready') this.onLive('spojeno');
      else if (m.type === 'resumed') {
        if (m.reset) this.term.reset();
        this.received = m.seq;
        this.onLive('ponovno spojeno');
      }
      else if (m.type === 'expired') {
        this.sessionId = null;
        saveOpenTabs();
        this.term.write('\r\n\x1b[33mSSH sesija na serveru više ne postoji (istekla je ili je server ponovno pokrenut).\x1b[0m\r\n');
        if (settings.autoReconnect && !needsSecret(this.conn)) { this.term.write('\x1b[90mOtvaram novu sesiju...\x1b[0m\r\n'); this.connect(); }
        else { this.setStatus('Sesija je istekla - kliknite "Ponovno spoji"'); setTabState(this, 'err'); }
      }
      else if (m.type === 'error') {
        this.sessionId = null; this.live = false; saveOpenTabs();
        setTabState(this, 'err'); this.setStatus(m.message); this.term.write(`\r\n\x1b[31m${m.message}\x1b[0m\r\n`);
      }
      else if (m.type === 'closed') {
        this.sessionId = null; this.live = false; saveOpenTabs(); updateKeepAlive();
        setTabState(this, ''); this.setStatus(m.message);
        if (m.reason === 'lost' && settings.autoReconnect && !needsSecret(this.conn)) {
          this.term.write(`\r\n\x1b[33m${m.message} Ponovno spajanje...\x1b[0m\r\n`);
          this.scheduleRetry('new');
        } else this.term.write(`\r\n\x1b[33m${m.message} Kliknite "Ponovno spoji".\x1b[0m\r\n`);
      }
    };
    ws.onclose = async (ev) => {
      if (this.ws !== ws || this.userClosed) return;
      const wasLive = this.live;
      this.live = false;
      updateKeepAlive();
      setTabState(this, '');
      if (ev.code === 4000) { this.setStatus('Sesija je otvorena u drugom prozoru.'); return; }
      if (!opened && !this.sessionId) {
        const me = await fetch('api/me').then((r) => r.json()).catch(() => null);
        if (me?.authRequired && !me.authenticated) return showLogin();
        this.term.write('\r\n\x1b[31mWebSocket veza na MTerm server nije uspjela (provjerite proxy/WebSocket podršku).\x1b[0m\r\n');
        return;
      }
      if (!this.sessionId) return;
      // veza s MTerm serverom je pukla, a SSH sesija i dalje živi na serveru
      if (wasLive) this.term.write('\r\n\x1b[90m[veza s MTerm serverom prekinuta - SSH sesija ostaje aktivna na serveru]\x1b[0m\r\n');
      if (settings.autoReconnect) this.scheduleRetry('resume');
      else this.setStatus('Veza prekinuta - kliknite "Ponovno spoji"');
    };
  }
  onLive(text) {
    this.live = true;
    this.retries = 0;
    setTabState(this, 'on');
    this.setStatus(`${this.conn.username}@${this.conn.host} · ${text}`);
    if (active === this) this.term.focus();
    this.doFit();
    this.send({ type: 'resize', cols: this.term.cols, rows: this.term.rows });
    updateKeepAlive();
  }
  scheduleRetry(mode) {
    clearTimeout(this.retryTimer);
    const delays = [1, 2, 4, 8, 15, 30];
    const d = delays[Math.min(this.retries, delays.length - 1)];
    this.retries++;
    this.setStatus(`Ponovno spajanje za ${d} s... (pokušaj ${this.retries})`);
    this.retryTimer = setTimeout(() => this.openSocket(mode), d * 1000);
  }
  // pozvano kad se preglednik vrati u fokus ili mreža ponovno proradi
  wake() {
    if (this.userClosed || this.live || !this.sessionId || !settings.autoReconnect) return;
    if (this.ws && this.ws.readyState <= 1) return; // spajanje je već u tijeku
    this.retries = 0;
    this.openSocket('resume');
  }
  destroy() {
    this.userClosed = true;
    clearTimeout(this.retryTimer);
    this.sendClose();
    try { this.ws?.close(); } catch {}
    this.ro.disconnect();
    this.term.dispose();
  }
  snapshot() { return { kind: 'term', conn: publicConn(this.conn), sid: this.sessionId }; }
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
  constructor(conn, opts = {}) {
    this.conn = conn;
    this.kind = 'files';
    this.restore = opts.sid ? { sid: opts.sid, path: opts.path || '/' } : null;
    this.title = (conn.name || conn.host) + ` (${PROTO[conn.protocol].label})`;
    this.path = '/';
    this.items = [];
    this.sel = new Set();
    this.sort = { key: 'name', dir: 1 };
    this.pane = document.createElement('div');
    this.pane.className = 'pane';
    this.pane.innerHTML = `<div class="fm-wrap"><div class="split">
      <div class="side local hidden"></div>
      <div class="divider hidden" title="Povucite za promjenu širine"></div>
      <div class="fm remote">
      <div class="toolbar">
        <button class="btn small" data-a="toggleSplit" title="Podijeljeni prikaz: lokalne i udaljene mape">⇆ Lokalno</button>
        <button class="btn small" data-a="up" title="Mapa iznad">⬆</button>
        <button class="btn small" data-a="refresh" title="Osvježi">↻</button>
        <form class="pathbar"><input name="path" spellcheck="false"></form>
        <button class="btn small" data-a="upload" title="Pošalji datoteke">⤒ Pošalji</button>
        <button class="btn small" data-a="uploadFolder" title="Pošalji cijelu mapu s podmapama">⤒ Pošalji mapu</button>
        <button class="btn small split-only" data-a="toLocal" title="Kopiraj označeno u lokalnu mapu (lijevo)">⇐ U lokalnu</button>
        <button class="btn small" data-a="download" title="Preuzmi u preglednik (mape kao ZIP)">⤓ Preuzmi</button>
        <button class="btn small" data-a="mkdir">+ Mapa</button>
        <button class="btn small" data-a="rename">Preimenuj</button>
        <button class="btn small danger" data-a="delete">Obriši</button>
        <button class="btn small" data-a="keyHelp" title="Prečaci tipkovnice (?)">⌨</button>
        <input type="file" multiple hidden class="pick-files">
        <input type="file" multiple hidden class="pick-folder" webkitdirectory directory>
      </div>
      <div class="toolbar"><span class="side-label">🌐 Udaljeno</span><span class="status">Spajanje...</span></div>
      <div class="list"><table><thead><tr>
        <th data-k="name">Naziv</th><th data-k="size" class="num">Veličina</th><th data-k="mtime">Izmijenjeno</th><th data-k="perms" class="perm">Prava</th>
      </tr></thead><tbody></tbody></table></div>
      </div></div>
      <div class="transfers"></div></div>`;
    const R = this.remoteEl = $('.fm.remote', this.pane);
    this.statusEl = $('.status', R);
    this.tbody = $('tbody', R);
    this.listEl = $('.list', R);
    this.fileInput = $('.pick-files', R);
    this.folderInput = $('.pick-folder', R);
    this.transfersEl = $('.transfers', this.pane);
    this.local = new LocalPanel(this, $('.side.local', this.pane));
    this.setupSplit();

    $('.toolbar', R).addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a && this[a]) this[a]();
    });
    $('.pathbar', R).addEventListener('submit', (e) => {
      e.preventDefault();
      this.cd(e.target.path.value.trim() || '/').then(() => this.pane.focus({ preventScroll: true }));
    });
    $('.pathbar input', R).addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.target.value = this.path; this.pane.focus({ preventScroll: true }); }
    });
    this.fileInput.addEventListener('change', () => { this.uploadFiles([...this.fileInput.files]); this.fileInput.value = ''; });
    this.folderInput.addEventListener('change', () => {
      const entries = [...this.folderInput.files].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name }));
      this.folderInput.value = '';
      if (entries.length) this.uploadTree(entries, []);
    });
    $('thead', R).addEventListener('click', (e) => {
      const k = e.target.closest('th')?.dataset.k;
      if (!k) return;
      this.sort = { key: k, dir: this.sort.key === k ? -this.sort.dir : 1 };
      this.render();
    });
    // povuci i ispusti
    let dragDepth = 0;
    this.listEl.addEventListener('dragenter', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('Files') || (t.includes('application/x-mterm') && this.drag?.side === 'local')) {
        e.preventDefault(); if (dragDepth++ === 0) this.showDrop(true);
      }
    });
    this.listEl.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; this.showDrop(false); } });
    this.listEl.addEventListener('dragover', (e) => e.preventDefault());
    this.listEl.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; this.showDrop(false);
      if (e.dataTransfer.types.includes('application/x-mterm')) {
        if (this.drag?.side === 'local') this.local.sendToRemote(this.drag.items);
        this.drag = null;
        return;
      }
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
    this.pane.addEventListener('keydown', (e) => fileListKey(this, e));
    // klik na stranu je čini aktivnom za tipkovnicu
    R.addEventListener('mousedown', () => this.setActiveSide('remote'));
    $('.side.local', this.pane).addEventListener('mousedown', () => this.setActiveSide('local'));
    this.activeSide = 'remote';
    if (this.restore) {
      this.sid = this.restore.sid;
      setTabState(this, 'on');
      this.cd(this.restore.path);
    } else this.connect();
    // otkucaj svake minute: sesija na serveru ne istječe dok je tab otvoren (i u pozadini)
    this.heartbeat = setInterval(() => {
      if (settings.keepAlive && this.sid) fetch(`api/fs/${this.sid}/ping`, { method: 'POST' }).catch(() => {});
    }, 60 * 1000);
  }

  setStatus(s) { this.statusEl.textContent = s; }
  showDrop(on) {
    let dz = $('.dropzone', this.listEl);
    if (on && !dz) this.listEl.insertAdjacentHTML('beforeend', '<div class="dropzone">Ispustite datoteke za slanje</div>');
    if (!on && dz) dz.remove();
  }
  url(action, p) { return `api/fs/${this.sid}/${action}?path=${encodeURIComponent(p)}`; }

  isLive() { return !!this.sid; }
  snapshot() { return { kind: 'files', conn: publicConn(this.conn), sid: this.sid, path: this.path }; }
  async connect() {
    if (needsSecret(this.conn)) {
      this.sid = null;
      setTabState(this, 'err');
      this.setStatus('Sesija je istekla - potrebna je lozinka');
      this.tbody.innerHTML = `<tr><td colspan="4" class="empty">Sesija na serveru je istekla, a lozinka nije spremljena.<br><br>
        <button class="btn primary" data-secret>Unesi lozinku i spoji</button></td></tr>`;
      $('[data-secret]', this.tbody).addEventListener('click', () => { openDialog(this.conn, true); closeTab(this); });
      return;
    }
    setTabState(this, '');
    this.setStatus('Spajanje na ' + this.conn.host + ' ...');
    try {
      const c = this.conn;
      const r = await api('api/fs/connect', { method: 'POST', body: JSON.stringify({
        protocol: c.protocol, host: c.host, port: c.port, username: c.username, password: c.password,
        privateKey: c.privateKey, passphrase: c.passphrase, ftpsMode: c.ftpsMode, insecure: c.insecure, basePath: c.basePath }) });
      this.sid = r.id;
      setTabState(this, 'on');
      saveOpenTabs();
      updateKeepAlive();
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

  async cd(p, focusName) {
    this.setStatus('Učitavanje ' + p + ' ...');
    try {
      const r = await this.call(() => api(this.url('list', p)));
      if (!r) return;
      const same = r.path === this.path;
      const keepSel = same ? new Set(this.sel) : new Set();
      this.path = r.path;
      this.items = r.items;
      this.sel = new Set([...keepSel].filter((n) => r.items.some((i) => i.name === n)));
      $('.pathbar input', this.remoteEl).value = this.path;
      saveOpenTabs();
      this.render();
      placeCursor(this, focusName ?? (same ? this.cursor : null));
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
    this.viewItems = items;
    this.tbody.innerHTML = '';
    if (this.path !== '/') {
      const tr = document.createElement('tr');
      tr.className = 'row';
      tr.dataset.name = '..';
      tr.innerHTML = '<td class="name"><span class="icon">📁</span>..</td><td></td><td></td><td class="perm"></td>';
      tr.addEventListener('click', () => { this.sel.clear(); this.cursor = '..'; markRows(this); });
      tr.addEventListener('dblclick', () => this.up());
      this.tbody.appendChild(tr);
    }
    if (!items.length) this.tbody.insertAdjacentHTML('beforeend', '<tr><td colspan="4" class="empty">Mapa je prazna. Povucite datoteke ovdje za slanje.</td></tr>');
    for (const i of items) {
      const tr = document.createElement('tr');
      tr.className = 'row' + (this.sel.has(i.name) ? ' sel' : '');
      tr.dataset.name = i.name;
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
        this.cursor = i.name;
        this.anchor = i.name;
        markRows(this);
      });
      tr.addEventListener('dblclick', () => this.openItem(i.name));
      tr.draggable = true;
      tr.addEventListener('dragstart', (e) => {
        if (!this.sel.has(i.name)) { this.sel.clear(); this.sel.add(i.name); }
        this.drag = { side: 'remote', items: this.selected() };
        e.dataTransfer.setData('application/x-mterm', 'remote');
        e.dataTransfer.effectAllowed = 'copy';
      });
      tr.addEventListener('dragend', () => setTimeout(() => { this.drag = null; }, 0));
      this.tbody.appendChild(tr);
    }
  }

  selected() { return this.items.filter((i) => this.sel.has(i.name)); }
  up() { if (this.path !== '/') this.cd(parentPath(this.path), this.path.split('/').filter(Boolean).pop()); }
  // Enter / dvoklik: mapa -> uđi, datoteka -> preuzmi (u lokalnu mapu ako je podijeljeni prikaz)
  openItem(name) {
    if (name === '..') return this.up();
    const i = this.items.find((x) => x.name === name);
    if (!i) return;
    if (this.isDir(i)) this.cd(joinPath(this.path, i.name));
    else if (this.splitOn() && this.local.dir) this.downloadToLocal([i]);
    else this.downloadItem(i);
  }
  isDirName(name) { const i = this.items.find((x) => x.name === name); return !!i && this.isDir(i); }
  isActive() { return !this.splitOn() || this.activeSide !== 'local'; }
  copyToOther() { this.toLocal(); }
  keyHelp() { showKeyHelp(); }
  focusPath() { const inp = $('.pathbar input', this.remoteEl); inp.focus(); inp.select(); }
  setActiveSide(side) {
    if (side === 'local' && !this.splitOn()) side = 'remote';
    this.activeSide = side;
    const on = this.splitOn();
    this.remoteEl.classList.toggle('side-active', on && side === 'remote');
    $('.side.local', this.pane).classList.toggle('side-active', on && side === 'local');
    markRows(this);
    if (this.local) markRows(this.local);
  }
  refresh() { if (this.sid) this.cd(this.path); else this.connect(); }
  upload() { this.fileInput.click(); }
  uploadFolder() { this.folderInput.click(); }

  download() {
    const sel = this.selected();
    if (!sel.length) {
      const name = this.path.split('/').filter(Boolean).pop() || 'root';
      if (confirm(`Preuzeti cijelu mapu "${name}" kao ZIP?`)) this.downloadZip(null, name + '.zip');
      return;
    }
    if (sel.some((i) => this.isDir(i))) {
      const name = sel.length === 1 ? sel[0].name + '.zip' : (this.path.split('/').filter(Boolean).pop() || 'mterm') + '-odabrano.zip';
      return this.downloadZip(sel.map((i) => i.name), name);
    }
    sel.forEach((f, n) => setTimeout(() => this.downloadItem(f), n * 400));
  }
  downloadZip(names, zipName) {
    let u = this.url('zip', this.path) + '&name=' + encodeURIComponent(zipName);
    if (names) u += '&items=' + encodeURIComponent(JSON.stringify(names));
    const a = document.createElement('a');
    a.href = u;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`Priprema ZIP-a "${zipName}" - preuzimanje počinje odmah, veličina se ne zna unaprijed.`);
  }

  // ---------- podijeljeni prikaz ----------
  splitOn() { return !!settings.splitView; }
  setupSplit() {
    const split = $('.split', this.pane), div = $('.divider', this.pane);
    this.applySplit();
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = split.getBoundingClientRect();
      const move = (ev) => {
        settings.splitRatio = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width));
        for (const t of tabs) t.applySplit?.();
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveSettings(); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }
  applySplit() {
    const on = this.splitOn();
    if (!on && this.activeSide === 'local') this.activeSide = 'remote';
    queueMicrotask(() => this.setActiveSide(this.activeSide || 'remote'));
    $('.side.local', this.pane).classList.toggle('hidden', !on);
    $('.divider', this.pane).classList.toggle('hidden', !on);
    this.pane.classList.toggle('split-on', on);
    $('.split', this.pane).style.setProperty('--split', ((settings.splitRatio || 0.5) * 100) + '%');
    if (on) this.local.init();
  }
  applySettings() { this.applySplit(); }
  toggleSplit() {
    settings.splitView = !settings.splitView;
    saveSettings();
    for (const t of tabs) t.applySplit?.();
  }
  toLocal() {
    const sel = this.selected();
    if (!sel.length) return toast('Označite stavke za kopiranje u lokalnu mapu.', true);
    this.downloadToLocal(sel);
  }

  // Red napretka za skupni prijenos
  transferRow(label) {
    const row = document.createElement('div');
    row.className = 'transfer';
    row.innerHTML = `<span class="tname">${label} <span class="muted tcur"></span></span>
      <progress max="100" value="0"></progress><span class="tstate">0%</span>
      <button class="icon-btn tcancel" title="Prekini">✕</button>`;
    this.transfersEl.prepend(row);
    const prog = $('progress', row), st = $('.tstate', row), cur = $('.tcur', row);
    const t = {
      cancelled: false, abort: null,
      progress(p) { prog.value = p; st.textContent = p + '%'; },
      cur(text) { cur.textContent = text; },
      finish(failed) {
        $('.tcancel', row)?.remove(); cur.textContent = '';
        if (t.cancelled) { row.classList.add('fail'); st.textContent = 'Prekinuto'; }
        else if (failed.length) {
          row.classList.add('fail');
          st.textContent = plural(failed.length, 'greška', 'greške', 'grešaka');
          st.title = failed.join('\n');
          toast(`Neuspješno: ${plural(failed.length, 'stavka', 'stavke', 'stavki')} (${failed[0]})`, true, 8000);
        } else {
          row.classList.add('done'); prog.value = 100; st.textContent = 'Gotovo';
          setTimeout(() => row.remove(), 8000);
        }
      },
      fail(msg) { $('.tcancel', row)?.remove(); row.classList.add('fail'); st.textContent = msg; cur.textContent = ''; toast(msg, true); },
    };
    $('.tcancel', row).addEventListener('click', () => { t.cancelled = true; t.abort?.(); });
    return t;
  }

  // Udaljeno -> lokalna mapa (File System Access API)
  async downloadToLocal(items) {
    const L = this.local;
    if (!L.dir) return toast('Najprije lijevo odaberite lokalnu mapu.', true);
    const target = L.dir, base = this.path;
    const plan = { dirs: [], files: [], errors: [] };
    try {
      for (const i of items) {
        if (this.isDir(i)) {
          plan.dirs.push(i.name);
          const t = await this.call(() => api(this.url('tree', joinPath(base, i.name))));
          if (!t) return;
          plan.dirs.push(...t.dirs.map((d) => i.name + '/' + d));
          plan.files.push(...t.files.map((f) => ({ ...f, rel: i.name + '/' + f.rel })));
          plan.errors.push(...t.errors);
        } else plan.files.push({ rel: i.name, size: i.size || 0 });
      }
    } catch { return; }
    const total = plan.files.reduce((s, f) => s + (f.size || 0), 0);
    const T = this.transferRow(`⇐ ${esc(items.length === 1 ? items[0].name : plural(items.length, 'stavka', 'stavke', 'stavki'))}
      · ${plural(plan.files.length, 'datoteka', 'datoteke', 'datoteka')} · ${fmtSize(total)}`);
    const failed = [...plan.errors];
    try {
      for (const d of plan.dirs) {
        if (T.cancelled) break;
        await L.dirHandle(target, d, true);
      }
      let done = 0;
      for (let n = 0; n < plan.files.length && !T.cancelled; n++) {
        const f = plan.files[n];
        T.cur(`· ${n + 1}/${plan.files.length} ${f.rel}`);
        const ctrl = new AbortController();
        T.abort = () => ctrl.abort();
        let w = null;
        try {
          const parts = f.rel.split('/');
          const dir = await L.dirHandle(target, parts.slice(0, -1).join('/'), true);
          const res = await fetch(this.url('download', joinPath(base, f.rel)), { signal: ctrl.signal });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            if (res.status === 401) showLogin();
            throw new Error(d.error || 'HTTP ' + res.status);
          }
          const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
          w = await fh.createWritable();
          const reader = res.body.getReader();
          let got = 0;
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            await w.write(value);
            got += value.length;
            T.progress(total ? Math.min(100, Math.round(((done + got) / total) * 100)) : Math.round((n / plan.files.length) * 100));
          }
          await w.close();
          w = null;
        } catch (err) {
          try { await w?.abort(); } catch {}
          if (!T.cancelled) failed.push(`${f.rel}: ${err.message}`);
        }
        done += f.size || 0;
      }
      T.finish(failed);
    } catch (err) {
      T.fail(err.message);
    }
    L.refresh();
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

  onShow() { this.pane.focus({ preventScroll: true }); this.applySplit(); }
  destroy() {
    clearInterval(this.heartbeat);
    if (this.sid) fetch(`api/fs/${this.sid}/close`, { method: 'POST' }).catch(() => {});
  }
}
// ---------- navigacija tipkovnicom (udaljena i lokalna strana) ----------
const rowNames = (P) => [...P.tbody.querySelectorAll('tr.row')].map((r) => r.dataset.name);
function markRows(P) {
  const active = P.isActive?.() ?? true;
  P.tbody.querySelectorAll('tr.row').forEach((r) => {
    r.classList.toggle('sel', P.sel.has(r.dataset.name));
    r.classList.toggle('cursor', r.dataset.name === P.cursor);
    r.classList.toggle('cursor-dim', r.dataset.name === P.cursor && !active);
  });
}
function scrollToCursor(P) {
  const r = [...P.tbody.querySelectorAll('tr.row')].find((x) => x.dataset.name === P.cursor);
  r?.scrollIntoView({ block: 'nearest' });
}
// nakon učitavanja mape: pokazivač na zadanu stavku, inače na prvu stavku (ne na "..")
function placeCursor(P, prefer) {
  const names = rowNames(P);
  P.cursor = names.includes(prefer) ? prefer : (names.find((n) => n !== '..') ?? names[0] ?? null);
  P.anchor = P.cursor;
  markRows(P);
  scrollToCursor(P);
}
function moveCursor(P, idx, e) {
  const names = rowNames(P);
  if (!names.length) return;
  idx = Math.max(0, Math.min(names.length - 1, idx));
  const name = names[idx];
  if (e.shiftKey) {
    const a = names.indexOf(P.anchor ?? P.cursor ?? name);
    const [x, y] = [a < 0 ? idx : a, idx].sort((m, n) => m - n);
    P.sel = new Set(names.slice(x, y + 1).filter((n) => n !== '..'));
  } else if (!(e.ctrlKey || e.metaKey)) {
    P.sel = new Set(name === '..' ? [] : [name]);
    P.anchor = name;
  }
  P.cursor = name;
  markRows(P);
  scrollToCursor(P);
}
// ako ništa nije označeno, radnja se odnosi na stavku pod pokazivačem
function ensureSelection(P) {
  if (!P.sel.size && P.cursor && P.cursor !== '..') { P.sel.add(P.cursor); markRows(P); }
}

const typeAhead = { text: '', timer: null };
function fileListKey(tab, e) {
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable]')) return;
  if (t.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return; // neka gumb odradi svoj klik
  if (document.querySelector('.overlay:not(.hidden)')) return;
  const split = tab.splitOn();
  const P = split && tab.activeSide === 'local' ? tab.local : tab;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  const done = () => { e.preventDefault(); e.stopPropagation(); };

  if (k === 'Tab' && split && !ctrl && !e.altKey) {
    done();
    tab.setActiveSide(tab.activeSide === 'local' ? 'remote' : 'local');
    const S = tab.activeSide === 'local' ? tab.local : tab;
    if (!S.cursor) placeCursor(S, null);
    return;
  }
  if (k === '?' || k === 'F1') { done(); showKeyHelp(); return; }
  if (P === tab.local && !tab.local.dir) {
    if (k === 'Enter') { done(); tab.local.pick(); }
    return;
  }
  const names = rowNames(P);
  const idx = Math.max(0, names.indexOf(P.cursor));
  const page = Math.max(1, Math.floor((P.listEl.clientHeight || 400) / 30) - 1);

  if (k === 'ArrowDown') { done(); moveCursor(P, P.cursor == null ? 0 : idx + 1, e); }
  else if (k === 'ArrowUp' && e.altKey) { done(); P.up(); }
  else if (k === 'ArrowUp') { done(); moveCursor(P, idx - 1, e); }
  else if (k === 'Home') { done(); moveCursor(P, 0, e); }
  else if (k === 'End') { done(); moveCursor(P, names.length - 1, e); }
  else if (k === 'PageDown') { done(); moveCursor(P, idx + page, e); }
  else if (k === 'PageUp') { done(); moveCursor(P, idx - page, e); }
  else if (k === 'Enter') { done(); if (P.cursor) P.openItem(P.cursor); }
  else if (k === 'ArrowRight' && !ctrl) { done(); if (P.cursor && P.isDirName(P.cursor)) P.openItem(P.cursor); }
  else if ((k === 'ArrowLeft' && !ctrl) || k === 'Backspace') { done(); P.up(); }
  else if (k === ' ' || k === 'Insert') {
    done();
    if (P.cursor && P.cursor !== '..') {
      P.sel.has(P.cursor) ? P.sel.delete(P.cursor) : P.sel.add(P.cursor);
      P.anchor = P.cursor;
      markRows(P);
    }
    if (k === 'Insert') moveCursor(P, idx + 1, { ctrlKey: true });
  }
  else if (ctrl && (k === 'a' || k === 'A')) { done(); P.sel = new Set(names.filter((n) => n !== '..')); markRows(P); }
  else if (k === 'Escape') { done(); P.sel.clear(); markRows(P); }
  else if (k === 'Delete' || k === 'F8') { done(); ensureSelection(P); P.delete(); }
  else if (k === 'F2') { done(); ensureSelection(P); P.rename(); }
  else if (k === 'F7') { done(); P.mkdir(); }
  else if (k === 'F5' || (ctrl && (k === 'r' || k === 'R'))) { done(); P.refresh(); }
  else if (k === 'F6') {
    done();
    if (!split) return toast('Kopiranje na drugu stranu radi u podijeljenom prikazu (⇆ Lokalno).', true);
    ensureSelection(P); P.copyToOther();
  }
  else if (ctrl && (k === 'l' || k === 'L') && P === tab) { done(); tab.focusPath(); }
  else if (k.length === 1 && !ctrl && !e.altKey) {
    // upisivanje imena: skok na prvu stavku koja počinje upisanim tekstom
    done();
    clearTimeout(typeAhead.timer);
    typeAhead.text += k.toLocaleLowerCase('hr');
    typeAhead.timer = setTimeout(() => { typeAhead.text = ''; }, 900);
    const list = names.filter((n) => n !== '..');
    const lc = (n) => n.toLocaleLowerCase('hr');
    let hit = list.find((n) => lc(n).startsWith(typeAhead.text));
    if (!hit && typeAhead.text.length === 1) hit = null;
    if (!hit) hit = list.find((n) => lc(n).includes(typeAhead.text));
    if (hit) moveCursor(P, names.indexOf(hit), {});
  }
}

function showKeyHelp() {
  let el = $('#keyHelp');
  if (!el) {
    el = document.createElement('div');
    el.id = 'keyHelp';
    el.className = 'overlay';
    const rows = [
      ['↑ ↓', 'pomicanje'], ['Shift + ↑ ↓', 'označavanje niza'], ['Ctrl + ↑ ↓', 'pomicanje bez promjene oznake'],
      ['Home / End', 'prva / zadnja stavka'], ['PgUp / PgDn', 'stranica gore / dolje'],
      ['Enter', 'otvori mapu / preuzmi ili pošalji datoteku'], ['→', 'uđi u mapu'], ['← / Backspace / Alt + ↑', 'mapa iznad'],
      ['Razmak', 'označi / odznači'], ['Insert', 'označi i idi na sljedeću'], ['Ctrl + A', 'označi sve'], ['Esc', 'poništi oznake'],
      ['slova', 'skok na stavku koja počinje upisanim'], ['Tab', 'prebacivanje lokalno ⇄ udaljeno'],
      ['F6', 'kopiraj na drugu stranu'], ['F7', 'nova mapa'], ['F2', 'preimenuj'], ['Delete / F8', 'obriši'],
      ['F5 / Ctrl + R', 'osvježi'], ['Ctrl + L', 'upis putanje (udaljeno)'], ['? / F1', 'ova pomoć'],
    ];
    el.innerHTML = `<div class="card dialog small"><h2>Tipkovnica - datoteke</h2><table class="keys">${rows
      .map(([a, b]) => `<tr><td><kbd>${a}</kbd></td><td>${b}</td></tr>`).join('')}</table>
      <div class="actions"><span class="spacer"></span><button class="btn primary">Zatvori</button></div></div>`;
    document.body.appendChild(el);
    const close = () => { el.classList.add('hidden'); active?.onShow?.(); };
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('button')) close(); });
    el.addEventListener('keydown', (e) => { e.preventDefault(); close(); });
  }
  el.classList.remove('hidden');
  el.tabIndex = -1;
  el.focus();
}

// ---------- lokalne mape (File System Access API) ----------
const idb = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('mterm', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; });
  },
};

class LocalPanel {
  constructor(tab, el) {
    this.tab = tab;
    this.el = el;
    this.stack = []; // [{handle, name}]
    this.items = [];
    this.sel = new Set();
    this.started = false;
    el.innerHTML = `
      <div class="toolbar">
        <button class="btn small" data-a="pick" title="Odaberi mapu na ovom računalu">📂 Mapa…</button>
        <button class="btn small" data-a="up" title="Mapa iznad">⬆</button>
        <button class="btn small" data-a="refresh" title="Osvježi">↻</button>
        <span class="lpath mono" title=""></span>
        <button class="btn small" data-a="mkdir">+ Mapa</button>
        <button class="btn small danger" data-a="delete">Obriši</button>
        <button class="btn small" data-a="send" title="Pošalji označeno na server (desno)">Na server ⇒</button>
      </div>
      <div class="toolbar"><span class="side-label">💻 Lokalno</span><span class="status"></span></div>
      <div class="list"><table><thead><tr>
        <th>Naziv</th><th class="num">Veličina</th><th>Izmijenjeno</th>
      </tr></thead><tbody></tbody></table></div>`;
    this.tbody = $('tbody', el);
    this.listEl = $('.list', el);
    this.statusEl = $('.status', el);
    $('.toolbar', el).addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a && this[a]) this[a]();
    });
    // ispuštanje redova iz udaljenog popisa = preuzimanje u ovu mapu
    let depth = 0;
    this.listEl.addEventListener('dragenter', (e) => {
      if (e.dataTransfer.types.includes('application/x-mterm') && this.tab.drag?.side === 'remote') {
        e.preventDefault(); if (depth++ === 0) this.showDrop(true);
      }
    });
    this.listEl.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; this.showDrop(false); } });
    this.listEl.addEventListener('dragover', (e) => e.preventDefault());
    this.listEl.addEventListener('drop', (e) => {
      e.preventDefault(); depth = 0; this.showDrop(false);
      if (this.tab.drag?.side === 'remote') this.tab.downloadToLocal(this.tab.drag.items);
      this.tab.drag = null;
    });
  }

  get supported() { return typeof window.showDirectoryPicker === 'function'; }
  get dir() { return this.stack.length ? this.stack[this.stack.length - 1].handle : null; }
  setStatus(s) { this.statusEl.textContent = s; }
  showDrop(on) {
    const dz = $('.dropzone', this.listEl);
    if (on && !dz) this.listEl.insertAdjacentHTML('beforeend', '<div class="dropzone">Ispustite za preuzimanje u ovu mapu</div>');
    if (!on && dz) dz.remove();
  }
  message(html) { this.tbody.innerHTML = `<tr><td colspan="3" class="empty">${html}</td></tr>`; }

  async init() {
    if (this.started) return;
    this.started = true;
    if (!this.supported) {
      const http = location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname);
      this.setStatus('nije dostupno u ovom pregledniku');
      this.message(`Pristup lokalnim mapama zahtijeva <b>Chrome ili Edge</b>${http ? ' i <b>HTTPS</b> vezu' : ''}.<br><br>` +
        (http ? `MTerm je otvoren preko <span class="mono">${esc(location.origin)}</span> (http). Mogućnosti:<br>
          • otvorite MTerm preko HTTPS-a (npr. iza nginx reverse proxyja), ili<br>
          • u Chromeu/Edgeu otvorite <span class="mono">chrome://flags/#unsafely-treat-insecure-origin-as-secure</span>
            (Edge: <span class="mono">edge://flags/...</span>), upišite <span class="mono">${esc(location.origin)}</span>, uključite i ponovno pokrenite preglednik.<br><br>`
          : 'Firefox i Safari ne podržavaju pristup mapama na disku.<br><br>') +
        'Do tada koristite ⤒ Pošalji / ⤓ Preuzmi desno.');
      return;
    }
    const saved = await idb.get('localDir').catch(() => null);
    if (saved) {
      const perm = saved.queryPermission ? await saved.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt') : 'granted';
      if (perm === 'granted') return this.open(saved);
      this.setStatus('');
      this.message(`<button class="btn primary" data-resume>Nastavi s mapom „${esc(saved.name)}”</button><br><br>
        <button class="btn" data-pick>Odaberi drugu mapu…</button>`);
      $('[data-resume]', this.tbody).addEventListener('click', async () => {
        const p = await saved.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
        if (p === 'granted') this.open(saved); else toast('Pristup mapi nije odobren.', true);
      });
      $('[data-pick]', this.tbody).addEventListener('click', () => this.pick());
      return;
    }
    this.setStatus('');
    this.message('<button class="btn primary" data-pick>📂 Odaberi lokalnu mapu…</button><br><br>' +
      '<span class="muted">Preglednik će pitati za dopuštenje čitanja i pisanja u odabranu mapu.</span>');
    $('[data-pick]', this.tbody).addEventListener('click', () => this.pick());
  }

  async pick() {
    if (!this.supported) return;
    try {
      const h = await window.showDirectoryPicker({ id: 'mterm-local', mode: 'readwrite' });
      await idb.set('localDir', h).catch(() => {});
      this.open(h);
    } catch (e) { if (e.name !== 'AbortError') toast('Odabir mape: ' + e.message, true); }
  }
  open(h) { this.stack = [{ handle: h, name: h.name }]; this.refresh(); }
  up() { if (this.stack.length > 1) { const from = this.stack.pop(); this.refresh(from.name); } }
  openItem(name) {
    if (name === '..') return this.up();
    const i = this.items.find((x) => x.name === name);
    if (!i) return;
    if (i.dir) { this.stack.push({ handle: i.handle, name: i.name }); this.refresh(null, true); }
    else this.sendToRemote([i]);
  }
  isDirName(name) { return !!this.items.find((x) => x.name === name && x.dir); }
  copyToOther() { this.send(); }
  rename() { toast('Preimenovanje lokalnih stavki preglednik ne podržava.', true); }
  get listElement() { return this.listEl; }
  isActive() { return this.tab.splitOn() && this.tab.activeSide === 'local'; }

  async refresh(focusName, entered) {
    if (!this.dir) return;
    const pathText = this.stack.map((s) => s.name).join('/');
    $('.lpath', this.el).textContent = pathText;
    $('.lpath', this.el).title = pathText;
    this.setStatus('Učitavanje...');
    try {
      const items = [];
      for await (const [name, h] of this.dir.entries()) {
        if (h.kind === 'directory') items.push({ name, dir: true, handle: h, size: 0, mtime: 0 });
        else {
          let f = null;
          try { f = await h.getFile(); } catch {}
          items.push({ name, dir: false, handle: h, size: f?.size ?? 0, mtime: f?.lastModified ?? 0 });
        }
      }
      items.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, 'hr', { numeric: true, sensitivity: 'base' })));
      const prevCursor = entered ? null : this.cursor;
      const keep = entered ? new Set() : new Set([...this.sel].filter((n) => items.some((i) => i.name === n)));
      this.items = items;
      this.sel = keep;
      this.render();
      placeCursor(this, focusName ?? prevCursor);
      const d = items.filter((i) => i.dir).length;
      this.setStatus(`${plural(d, 'mapa', 'mape', 'mapa')}, ${plural(items.length - d, 'datoteka', 'datoteke', 'datoteka')}`);
    } catch (e) {
      this.setStatus('Greška: ' + e.message);
      if (e.name === 'NotAllowedError') { this.started = false; this.init(); }
    }
  }

  render() {
    this.tbody.innerHTML = '';
    if (this.stack.length > 1) {
      const tr = document.createElement('tr');
      tr.className = 'row';
      tr.dataset.name = '..';
      tr.innerHTML = '<td class="name"><span class="icon">📁</span>..</td><td></td><td></td>';
      tr.addEventListener('click', () => { this.sel.clear(); this.cursor = '..'; markRows(this); });
      tr.addEventListener('dblclick', () => this.up());
      this.tbody.appendChild(tr);
    }
    if (!this.items.length) this.tbody.insertAdjacentHTML('beforeend', '<tr><td colspan="3" class="empty">Mapa je prazna. Povucite stavke s desne strane ovdje.</td></tr>');
    for (const i of this.items) {
      const tr = document.createElement('tr');
      tr.className = 'row' + (this.sel.has(i.name) ? ' sel' : '');
      tr.dataset.name = i.name;
      tr.innerHTML = `<td class="name" title="${esc(i.name)}"><span class="icon">${i.dir ? '📁' : '📄'}</span>${esc(i.name)}</td>
        <td class="num">${i.dir ? '' : fmtSize(i.size)}</td><td>${fmtDate(i.mtime)}</td>`;
      tr.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) { this.sel.has(i.name) ? this.sel.delete(i.name) : this.sel.add(i.name); }
        else if (e.shiftKey && this.lastClick != null) {
          const names = this.items.map((x) => x.name);
          const [a, b] = [names.indexOf(this.lastClick), names.indexOf(i.name)].sort((x, y) => x - y);
          names.slice(a, b + 1).forEach((n) => this.sel.add(n));
        } else { this.sel.clear(); this.sel.add(i.name); }
        this.lastClick = i.name;
        this.cursor = i.name;
        this.anchor = i.name;
        markRows(this);
      });
      tr.addEventListener('dblclick', () => this.openItem(i.name));
      tr.draggable = true;
      tr.addEventListener('dragstart', (e) => {
        if (!this.sel.has(i.name)) { this.sel.clear(); this.sel.add(i.name); }
        this.tab.drag = { side: 'local', items: this.selected() };
        e.dataTransfer.setData('application/x-mterm', 'local');
        e.dataTransfer.effectAllowed = 'copy';
      });
      tr.addEventListener('dragend', () => setTimeout(() => { this.tab.drag = null; }, 0));
      this.tbody.appendChild(tr);
    }
  }

  selected() { return this.items.filter((i) => this.sel.has(i.name)); }

  // put 'a/b/c' od zadane mape (opcionalno kreira mape)
  async dirHandle(root, rel, create) {
    let h = root;
    for (const part of rel.split('/').filter(Boolean)) h = await h.getDirectoryHandle(part, { create });
    return h;
  }

  async mkdir() {
    if (!this.dir) return toast('Najprije odaberite lokalnu mapu.', true);
    const name = prompt('Naziv nove lokalne mape:');
    if (!name) return;
    try { await this.dir.getDirectoryHandle(name, { create: true }); this.refresh(); }
    catch (e) { toast(e.message, true); }
  }

  async delete() {
    const items = this.selected();
    if (!items.length) return toast('Označite lokalne stavke za brisanje.', true);
    if (!confirm(`Obrisati s OVOG RAČUNALA ${items.length === 1 ? '"' + items[0].name + '"' : plural(items.length, 'stavku', 'stavke', 'stavki')}?` +
      (items.some((i) => i.dir) ? '\nMape se brišu zajedno sa sadržajem!' : ''))) return;
    for (const i of items) {
      try { await this.dir.removeEntry(i.name, { recursive: true }); }
      catch (e) { toast(`${i.name}: ${e.message}`, true); break; }
    }
    this.refresh();
  }

  send() {
    const sel = this.selected();
    if (!sel.length) return toast('Označite lokalne stavke za slanje.', true);
    this.sendToRemote(sel);
  }

  // Lokalno -> udaljeno: skupi datoteke (i mape) pa koristi postojeće slanje mapa
  async sendToRemote(items) {
    if (!this.tab.sid) return toast('Udaljena strana nije spojena.', true);
    this.setStatus('Priprema za slanje...');
    const entries = [], dirs = [];
    const walk = async (h, rel) => {
      if (h.kind === 'file') { entries.push({ file: await h.getFile(), rel }); return; }
      dirs.push(rel);
      for await (const [name, child] of h.entries()) await walk(child, rel + '/' + name);
    };
    try {
      for (const i of items) await walk(i.handle, i.name);
    } catch (e) { toast('Čitanje lokalnih datoteka: ' + e.message, true); this.refresh(); return; }
    this.setStatus('');
    await this.tab.uploadTree(entries, dirs);
    this.refresh();
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
    if (me.sshKeepMax != null) sshKeepMax = Number(me.sshKeepMax);
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
  restoreTabs();
})();
