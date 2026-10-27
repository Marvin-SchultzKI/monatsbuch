/* SM Monatsbuch – Oberfläche. Rechnet wie die Excel-Monatstabelle:
   Umsatz  = C·pC + W·pW + S·pS + K·pK
   Einkauf = (C + C Bon)·pCBon + (W + W Bon)·pWBon + (S + S Bon)·pSBon + (K + K Bon)·pKBon
   Profit  = Umsatz − Einkauf + Manuell
   Offen   = Status „offen“ → Teilbetrag, oder ganzer Umsatz wenn kein Teilbetrag */
'use strict';
(function () {

const FIELDS = ['c', 'cb', 'w', 'wb', 's', 'sb', 'k', 'kb'];
const LABEL = { c: 'C', cb: 'C Bon', w: 'W', wb: 'W Bon', s: 'S', sb: 'S Bon', k: 'K', kb: 'K Bon' };
const CATS = [
  { key: 'c', bon: 'cb', label: 'C' }, { key: 'w', bon: 'wb', label: 'W' },
  { key: 's', bon: 'sb', label: 'S' }, { key: 'k', bon: 'kb', label: 'K' },
];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
// Jeder Monat hat seine Farbe (Jahreszeiten-Kreis). Hell / Dunkel.
const MONTH_COLORS = {
  light: ['#2F6DB5', '#5B4FCF', '#0F9488', '#3E9B3A', '#7F9A00', '#D19A00', '#E2702A', '#D64545', '#B5517A', '#9A5B2E', '#8E44AD', '#1E7F9E'],
  dark:  ['#4F8EDB', '#8478E8', '#2DB6A8', '#5CBB55', '#A8C21A', '#E8B828', '#F08E4A', '#E66464', '#D06F98', '#B97A4B', '#B57BD0', '#3FA3C4'],
};
// Kategorie-Farben (geprüft auf Farbenblind-Tauglichkeit, feste Reihenfolge C, W, S, K)
const CAT_COLORS = { light: ['#eda100', '#e87ba4', '#008300', '#6250d6'], dark: ['#c98500', '#d55181', '#008300', '#9085e9'] };
const ZERO_P = { c: 0, w: 0, s: 0, k: 0, cb: 0, wb: 0, sb: 0, kb: 0, valid_from: null };

const S = {
  csrf: '', me: null, owner: null, users: [], entries: new Map(), prices: [], eff: [],
  view: 'tag', day: todayStr(), statsMode: 'monat',
  timers: new Map(), pending: new Set(), saving: 0, saveError: null, charts: [],
};
const app = document.getElementById('app');
const APP_NAME = app.dataset.appName || 'SM Monatsbuch';

/* ---------- Hilfen ---------- */
function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fmtDayKey(dt) { return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; }
function addDays(s, n) { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return fmtDayKey(d); }
function weekStart(s) { const d = parseDay(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return fmtDayKey(d); }
function isoWeek(s) {
  const d = parseDay(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const y = d.getUTCFullYear(); const jan4 = new Date(Date.UTC(y, 0, 4));
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}
function monthKey(s) { return s.slice(0, 7); }
function monthDays(key) {
  const [y, m] = key.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${key}-${pad(i + 1)}`);
}
function addMonths(key, n) {
  let [y, m] = key.split('-').map(Number); m += n;
  y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return `${y}-${pad(m)}`;
}
function monthName(key) { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }
function monthIdx(key) { return Number(key.slice(5, 7)) - 1; }
function dayDE(s) { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; }
function dayShort(s) { const [, m, d] = s.split('-'); return `${d}.${m}.`; }
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
function wd(s) { return parseDay(s).getUTCDay(); }
function dayLong(s) { const d = parseDay(s); return `${WD_LONG[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const numFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
function eur(n) { return eurFmt.format(n || 0); }
function eurShort(n) {
  const a = Math.abs(n);
  if (a >= 10000) return numFmt.format(Math.round(n / 100) / 10) + ' T€';
  return numFmt.format(Math.round(n)) + ' €';
}
function num(n) { return numFmt.format(n || 0); }
function pct(n) { return isFinite(n) ? numFmt.format(Math.round(n * 10) / 10) + ' %' : '–'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function parseNum(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (s === '' || s === '-') return 0;
  const n = Number(s); return isFinite(n) ? n : NaN;
}
function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function mode() { return isDark() ? 'dark' : 'light'; }
function monthColor(key) { return MONTH_COLORS[mode()][monthIdx(key)]; }
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function blankEntry(day) { return { day, c: 0, cb: 0, w: 0, wb: 0, s: 0, sb: 0, k: 0, kb: 0, manuell: 0, info: '', status: '', teil: null }; }
function getEntry(day) { return S.entries.get(day) || blankEntry(day); }

/* ---------- Preise & Rechnung ---------- */
function buildEff() {
  const sorted = [...S.prices].sort((a, b) => a.valid_from < b.valid_from ? -1 : 1);
  let cur = { ...ZERO_P };
  S.eff = sorted.map(p => {
    const e = { id: p.id, valid_from: p.valid_from, given: {} };
    FIELDS.forEach(f => { if (p[f] !== null && p[f] !== undefined) { cur[f] = p[f]; e.given[f] = true; } e[f] = cur[f]; });
    return e;
  });
}
function priceFor(day) {
  if (!S.eff.length) return ZERO_P;
  let r = S.eff[0];
  for (const p of S.eff) { if (p.valid_from <= day) r = p; else break; }
  return r;
}
function calc(e) {
  const p = priceFor(e.day);
  const umsatz = e.c * p.c + e.w * p.w + e.s * p.s + e.k * p.k;
  const einkauf = (e.c + e.cb) * p.cb + (e.w + e.wb) * p.wb + (e.s + e.sb) * p.sb + (e.k + e.kb) * p.kb;
  const profit = umsatz - einkauf + (e.manuell || 0);
  const offen = e.status === 'offen' ? (e.teil === null || e.teil === undefined ? umsatz : e.teil) : 0;
  return { umsatz, einkauf, profit, offen, p };
}
function hasData(e) { return FIELDS.some(f => e[f]) || e.manuell || e.info || e.status || e.teil !== null; }
function sumDays(days) {
  const t = { umsatz: 0, einkauf: 0, profit: 0, offen: 0, manuell: 0, active: 0, best: null, units: {}, catUmsatz: {}, catEinkauf: {} };
  FIELDS.forEach(f => t.units[f] = 0);
  CATS.forEach(c => { t.catUmsatz[c.key] = 0; t.catEinkauf[c.key] = 0; });
  for (const d of days) {
    const e = S.entries.get(d); if (!e) continue;
    const r = calc(e);
    t.umsatz += r.umsatz; t.einkauf += r.einkauf; t.profit += r.profit; t.offen += r.offen; t.manuell += e.manuell || 0;
    FIELDS.forEach(f => t.units[f] += e[f]);
    CATS.forEach(c => { t.catUmsatz[c.key] += e[c.key] * r.p[c.key]; t.catEinkauf[c.key] += (e[c.key] + e[c.bon]) * r.p[c.bon]; });
    if (FIELDS.some(f => e[f])) t.active++;
    if (r.umsatz > 0 && (!t.best || r.umsatz > t.best.umsatz)) t.best = { day: d, umsatz: r.umsatz };
  }
  return t;
}

/* ---------- Server ---------- */
async function api(action, body, query = '') {
  const opt = body ? { method: 'POST', keepalive: action === 'saveEntry', headers: { 'Content-Type': 'application/json', 'X-CSRF': S.csrf }, body: JSON.stringify(body) } : {};
  let r, j;
  try { r = await fetch(`api.php?action=${action}${query}`, { credentials: 'same-origin', ...opt }); }
  catch { throw new Error('Keine Verbindung zum Server. Bitte Internet prüfen.'); }
  try { j = await r.json(); } catch { throw new Error('Der Server hat keine gültige Antwort geschickt (PHP-Fehler?).'); }
  if (!r.ok) {
    const err = new Error(j.error || 'Unbekannter Fehler'); err.status = r.status;
    if (r.status === 401 && !['login', 'setup'].includes(action)) setTimeout(boot, 50);
    throw err;
  }
  return j;
}

async function boot() {
  try {
    const st = await api('state');
    S.csrf = st.csrf; S.version = st.version;
    if (st.needSetup) return renderAuth('setup');
    if (!st.user) return renderAuth('login');
    S.me = st.user;
    let want = null;
    try { want = sessionStorage.getItem('mb-owner'); } catch {}
    await loadData(want && S.me.isAdmin ? want : S.me.id);
    try { S.day = sessionStorage.getItem('mb-day') || S.day; } catch {}
    renderShell(); route();
  } catch (e) {
    app.innerHTML = `<div class="auth"><div class="card"><div class="brand">${esc(APP_NAME)}</div><p class="err">${esc(e.message)}</p><button class="btn" id="retry">Erneut versuchen</button></div></div>`;
    document.getElementById('retry').onclick = boot;
  }
}

async function loadData(uid) {
  let d;
  try { d = await api('data', null, `&u=${encodeURIComponent(uid)}`); }
  catch (e) { if (String(uid) !== String(S.me.id)) d = await api('data', null, `&u=${S.me.id}`); else throw e; }
  S.owner = d.owner; S.users = d.users || []; S.prices = d.prices;
  S.entries = new Map(d.entries.map(e => [e.day, e]));
  buildEff();
  try { sessionStorage.setItem('mb-owner', String(S.owner.id)); } catch {}
}

/* ---------- Speichern (pro Tag, verzögert) ---------- */
function setField(day, field, value) {
  const e = { ...getEntry(day), [field]: value };
  if (hasData(e)) S.entries.set(day, e); else S.entries.delete(day);
  queueSave(day);
}
function queueSave(day) {
  S.pending.add(day);
  clearTimeout(S.timers.get(day));
  S.timers.set(day, setTimeout(() => saveDay(day), 700));
  paintSave();
}
async function saveDay(day) {
  S.timers.delete(day);
  const e = getEntry(day);
  S.saving++; paintSave();
  try {
    await api('saveEntry', { u: S.owner.id, ...e });
    S.pending.delete(day); S.saveError = null;
  } catch (err) {
    S.saveError = err.message;
  } finally { S.saving--; paintSave(); }
}
async function flushSaves() {
  for (const [day, t] of S.timers) { clearTimeout(t); S.timers.delete(day); }
  await Promise.all([...S.pending].map(saveDay));
}
function paintSave() {
  const el = document.getElementById('save-state'); if (!el) return;
  el.className = 'save-state';
  if (S.saveError) { el.classList.add('err'); el.innerHTML = `<span class="dot"></span><button class="btn sm danger" id="save-retry">Nicht gespeichert – erneut</button>`; document.getElementById('save-retry').onclick = flushSaves; el.title = S.saveError; return; }
  if (S.saving || S.pending.size) { el.classList.add('busy'); el.innerHTML = '<span class="dot"></span>Speichert …'; return; }
  el.innerHTML = '<span class="dot"></span>Gespeichert';
}
window.addEventListener('beforeunload', ev => { if (S.pending.size) { flushSaves(); ev.preventDefault(); ev.returnValue = ''; } });

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}

/* ---------- Anmeldung / Einrichtung ---------- */
function renderAuth(kind) {
  const setup = kind === 'setup';
  app.innerHTML = `<div class="auth"><form class="card" id="auth-form" autocomplete="on">
    <div class="brand"><span class="brand-mark">M</span>${esc(APP_NAME)}</div>
    ${setup ? `<div class="banner info">Erster Start: Lege dein Admin-Konto an. Danach kannst du Mitarbeiter anlegen.</div>` : ''}
    ${setup ? `<label class="field">Dein Name<input class="input" id="a-name" required maxlength="40" placeholder="z. B. Marvin"></label>` : ''}
    <label class="field">Benutzername<input class="input" id="a-user" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
    <label class="field">Passwort<input class="input" id="a-pass" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 8 : 1}"></label>
    ${setup ? `<p class="small muted" style="margin:0">Mindestens 8 Zeichen. Benutzername: Buchstaben, Ziffern, Punkt, Minus.</p>` : ''}
    <p class="err" id="a-err" hidden></p>
    <button class="btn primary" type="submit">${setup ? 'Konto anlegen' : 'Anmelden'}</button>
  </form></div>`;
  document.getElementById('auth-form').onsubmit = async ev => {
    ev.preventDefault();
    const errEl = document.getElementById('a-err'); errEl.hidden = true;
    const body = { username: document.getElementById('a-user').value.trim(), password: document.getElementById('a-pass').value };
    if (setup) body.name = document.getElementById('a-name').value.trim();
    try { await api(setup ? 'setup' : 'login', body); boot(); }
    catch (e) { errEl.textContent = e.message; errEl.hidden = false; }
  };
}

/* ---------- Grundgerüst ---------- */
const ICONS = {
  tag: '<path d="M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M10 14h4"/>',
  woche: '<path d="M4 5h16v14H4zM8 5v14M12 5v14M16 5v14"/>',
  monat: '<path d="M4 5h16v15H4zM4 10h16M4 15h16M9 10v10M14 10v10"/>',
  auswertung: '<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
  offen: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  preise: '<path d="M4 12l8-8h7v7l-8 8z"/><circle cx="15.5" cy="8.5" r="1.3"/>',
};
const TABS = [['tag', 'Tag'], ['woche', 'Woche'], ['monat', 'Monat'], ['auswertung', 'Auswertung'], ['offen', 'Offen'], ['preise', 'Preise']];
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`; }

function renderShell() {
  const ownerPick = S.me.isAdmin && S.users.length > 1
    ? `<label class="owner-pick"><span class="lbl">Tabelle</span><select class="input" id="owner-pick" style="min-height:36px;padding:5px 8px">${S.users.map(u => `<option value="${u.id}" ${u.id === S.owner.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : '';
  app.innerHTML = `
    <header class="top"><div class="top-in">
      <div class="brand"><span class="brand-mark">M</span><span class="brand-name">${esc(APP_NAME)}</span></div>
      <div class="top-spacer"></div>
      <div class="save-state" id="save-state" aria-live="polite"></div>
      ${ownerPick}
      <button class="icon-btn" id="menu-btn" aria-haspopup="true" aria-expanded="false" title="Menü">☰</button>
    </div>
    <nav class="tabs" aria-label="Ansichten">${TABS.map(([k, l]) => `<a class="tab" href="#${k}" data-tab="${k}">${icon(k)}<span>${l}</span></a>`).join('')}</nav>
    </header>
    <div class="menu" id="menu" hidden>
      <div class="who">Angemeldet als <b>${esc(S.me.name)}</b>${S.me.isAdmin ? ' · Admin' : ''}</div>
      ${S.me.isAdmin ? '<button data-go="benutzer">Benutzer verwalten</button>' : ''}
      <button data-go="konto">Passwort ändern</button>
      <button data-go="export">Daten exportieren (CSV)</button>
      ${S.me.isAdmin ? '<button id="backup-dl">Sicherung herunterladen</button>' : ''}
      <button id="logout">Abmelden</button>
      <div class="who" style="border:0;border-top:1px solid var(--line-2);margin:4px 0 0">Version ${esc(S.version || '')}</div>
    </div>
    <main id="view"></main>`;
  paintSave();
  const menu = document.getElementById('menu'), mb = document.getElementById('menu-btn');
  mb.onclick = ev => { ev.stopPropagation(); menu.hidden = !menu.hidden; mb.setAttribute('aria-expanded', String(!menu.hidden)); };
  document.addEventListener('click', ev => { if (!menu.hidden && !menu.contains(ev.target)) { menu.hidden = true; mb.setAttribute('aria-expanded', 'false'); } });
  menu.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { menu.hidden = true; location.hash = b.dataset.go; });
  document.getElementById('backup-dl')?.addEventListener('click', async () => {
    menu.hidden = true; await flushSaves();
    window.location.href = 'api.php?action=backup';
    toast('Sicherung wird heruntergeladen. Bewahre sie außerhalb des Servers auf, z. B. in der Cloud.');
  });
  document.getElementById('logout').onclick = async () => { await flushSaves(); try { sessionStorage.clear(); } catch {} await api('logout', {}); boot(); };
  const op = document.getElementById('owner-pick');
  if (op) op.onchange = async () => { await flushSaves(); await loadData(op.value); renderShell(); route(); toast(`Tabelle von ${S.owner.name} geöffnet`); };
}

function route() {
  const h = (location.hash || '#tag').slice(1);
  const known = ['tag', 'woche', 'monat', 'auswertung', 'offen', 'preise', 'benutzer', 'konto', 'export'];
  S.view = known.includes(h) ? h : 'tag';
  if (S.view === 'benutzer' && !S.me.isAdmin) S.view = 'tag';
  document.querySelectorAll('.tab').forEach(t => { if (t.dataset.tab === S.view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  render();
}
window.addEventListener('hashchange', () => { if (S.me) route(); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S.me) render(); });

function setDay(d) { S.day = d; try { sessionStorage.setItem('mb-day', d); } catch {} }

function destroyCharts() { S.charts.forEach(c => c.destroy()); S.charts = []; }
function render() {
  destroyCharts();
  const v = document.getElementById('view'); if (!v) return;
  document.documentElement.style.setProperty('--month', monthColor(monthKey(S.day)));
  const otherBanner = S.owner.id !== S.me.id
    ? `<div class="banner info">Du siehst und bearbeitest die Tabelle von <b>${esc(S.owner.name)}</b>.</div>` : '';
  const noPrices = !S.prices.length && !['preise', 'benutzer', 'konto'].includes(S.view)
    ? `<div class="banner warn">Es sind noch keine Preise hinterlegt, deshalb rechnet alles mit 0 €. <a href="#preise">Jetzt Preise eintragen</a></div>` : '';
  v.innerHTML = otherBanner + noPrices + '<div id="inner" style="display:flex;flex-direction:column;gap:16px"></div>';
  const inner = document.getElementById('inner');
  ({ tag: viewTag, woche: viewWoche, monat: viewMonat, auswertung: viewAuswertung, offen: viewOffen, preise: viewPreise, benutzer: viewBenutzer, konto: viewKonto, export: viewExport })[S.view](inner);
  window.scrollTo({ top: 0 });
}

/* ---------- Ansicht: Tag ---------- */
function viewTag(el) {
  const day = S.day, e = getEntry(day), r = calc(e);
  const isToday = day === todayStr();
  el.innerHTML = `
    <div class="card">
      <div class="period">
        <button class="btn" data-nav="-1" aria-label="Vorheriger Tag">‹</button>
        <div class="period-title"><h2>${dayLong(day)}</h2><span class="sub"><span class="month-chip"></span>${monthName(monthKey(day))} · KW ${isoWeek(day)}</span></div>
        <button class="btn" data-nav="1" aria-label="Nächster Tag">›</button>
      </div>
      <div class="row" style="margin-top:12px">
        <input type="date" class="input" id="day-pick" value="${day}" style="max-width:180px">
        ${isToday ? '' : '<button class="btn sm" id="go-today">Heute</button>'}
      </div>
    </div>
    <div class="day-grid">${CATS.map((c, i) => `
      <div class="cat">
        <div class="cat-head"><span class="sw" style="background:${CAT_COLORS[mode()][i]}"></span>${c.label}
          <span class="price">${eur(r.p[c.key])} · Bon ${eur(r.p[c.bon])}</span></div>
        ${stepper(c.key, e[c.key])}${stepper(c.bon, e[c.bon])}
      </div>`).join('')}
    </div>
    <div class="card">
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
        <label class="field">Manuell ± (€) <span class="small muted">wirkt nur auf den Profit</span>
          <input class="input mono" id="f-manuell" inputmode="decimal" value="${e.manuell ? numFmt.format(e.manuell) : ''}" placeholder="z. B. -20 oder 15"></label>
        <div class="field">Status
          <div class="seg" role="group" aria-label="Status">${[['', '—'], ['offen', 'offen'], ['bezahlt', 'bezahlt']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${e.status === v}">${l}</button>`).join('')}</div></div>
        <label class="field" id="teil-wrap" ${e.status === 'offen' ? '' : 'hidden'}>Teilbetrag offen (€) <span class="small muted">leer = ganzer Umsatz offen</span>
          <input class="input mono" id="f-teil" inputmode="decimal" value="${e.teil !== null && e.teil !== undefined ? numFmt.format(e.teil) : ''}" placeholder="${numFmt.format(r.umsatz)}"></label>
      </div>
      <label class="field" style="margin-top:12px">Info<textarea class="input" id="f-info" maxlength="500" placeholder="z. B. Kunde, Notiz, Zahlung erhalten am …">${esc(e.info)}</textarea></label>
    </div>
    <div class="result" id="day-result"></div>
    <p class="small muted" id="price-note"></p>`;
  paintDayResult();
  el.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { setDay(addDays(S.day, +b.dataset.nav)); render(); });
  el.querySelector('#day-pick').onchange = ev => { if (ev.target.value) { setDay(ev.target.value); render(); } };
  el.querySelector('#go-today')?.addEventListener('click', () => { setDay(todayStr()); render(); });
  el.querySelectorAll('.stepper').forEach(st => {
    const f = st.dataset.f, inp = st.querySelector('input');
    const apply = v => { v = Math.max(0, Math.round(v * 100) / 100); inp.value = v ? numFmt.format(v) : ''; setField(day, f, v); paintDayResult(); };
    st.querySelector('[data-d="-1"]').onclick = () => apply(parseNum(inp.value) - 1);
    st.querySelector('[data-d="1"]').onclick = () => apply(parseNum(inp.value) + 1);
    inp.oninput = () => { const v = parseNum(inp.value); if (!isNaN(v) && v >= 0) { setField(day, f, v); paintDayResult(); } };
    inp.onblur = () => { const v = parseNum(inp.value); inp.value = v > 0 ? numFmt.format(v) : ''; };
  });
  const man = el.querySelector('#f-manuell');
  man.oninput = () => { const v = parseNum(man.value); man.classList.toggle('bad', isNaN(v)); if (!isNaN(v)) { setField(day, 'manuell', v); paintDayResult(); } };
  el.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    el.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    setField(day, 'status', b.dataset.v);
    el.querySelector('#teil-wrap').hidden = b.dataset.v !== 'offen';
    paintDayResult();
  });
  const teil = el.querySelector('#f-teil');
  teil.oninput = () => {
    const raw = teil.value.trim(); const v = parseNum(raw);
    teil.classList.toggle('bad', raw !== '' && (isNaN(v) || v < 0));
    if (raw === '') setField(day, 'teil', null); else if (!isNaN(v) && v >= 0) setField(day, 'teil', v);
    paintDayResult();
  };
  let infoT; const info = el.querySelector('#f-info');
  info.oninput = () => { clearTimeout(infoT); infoT = setTimeout(() => setField(day, 'info', info.value), 300); };
}
function stepper(f, v) {
  return `<div class="stepper" data-f="${f}"><span class="lbl">${LABEL[f]}</span><div class="ctl">
    <button type="button" data-d="-1" aria-label="${LABEL[f]} minus 1">−</button>
    <input inputmode="decimal" value="${v ? numFmt.format(v) : ''}" placeholder="0" aria-label="${LABEL[f]} Stückzahl">
    <button type="button" data-d="1" aria-label="${LABEL[f]} plus 1">+</button></div></div>`;
}
function paintDayResult() {
  const e = getEntry(S.day), r = calc(e);
  const box = document.getElementById('day-result'); if (!box) return;
  const teilInp = document.getElementById('f-teil'); if (teilInp) teilInp.placeholder = numFmt.format(r.umsatz);
  box.innerHTML = kpi('Umsatz', r.umsatz) + kpi('Einkauf', r.einkauf) + kpi('Profit', r.profit, r.profit < 0 ? 'neg' : 'profit') + kpi('Noch offen', r.offen, r.offen > 0 ? 'open' : 'open zero');
  const note = document.getElementById('price-note');
  note.textContent = r.p.valid_from ? `Gerechnet mit den Preisen gültig ab ${dayDE(r.p.valid_from)}.` : 'Noch keine Preise hinterlegt.';
  if (e.status === 'offen' && e.teil !== null && e.teil > r.umsatz) note.textContent += ' Achtung: Der Teilbetrag ist größer als der Umsatz.';
}
function kpi(label, val, cls = '', delta = '') {
  return `<div class="kpi ${cls}"><div class="lbl">${label}</div><div class="val">${eur(val)}</div>${delta}</div>`;
}

/* ---------- Tabellen für Woche und Monat ---------- */
function gridTable(days, opts = {}) {
  const head = `<tr><th class="l">Tag</th>${FIELDS.map(f => `<th class="${f.endsWith('b') ? 'bon' : ''}">${LABEL[f]}</th>`).join('')}<th>Manuell</th><th class="l">Status</th><th>Umsatz</th><th>Einkauf</th><th>Profit</th><th>Offen</th></tr>`;
  const today = todayStr();
  const rows = days.map(d => {
    const e = getEntry(d), r = calc(e), w = wd(d);
    return `<tr data-day="${d}" class="${w === 0 || w === 6 ? 'weekend' : ''} ${d === today ? 'today' : ''}">
      <td><a href="#tag" class="daylink" data-open="${d}">${WD[w]} ${dayShort(d)}</a></td>
      ${FIELDS.map(f => `<td><input class="cell" data-f="${f}" inputmode="decimal" value="${e[f] ? numFmt.format(e[f]) : ''}" aria-label="${LABEL[f]} am ${dayDE(d)}"></td>`).join('')}
      <td><input class="cell wide" data-f="manuell" inputmode="decimal" value="${e.manuell ? numFmt.format(e.manuell) : ''}" aria-label="Manuell am ${dayDE(d)}"></td>
      <td class="l"><select class="cell ${e.status}" data-f="status" aria-label="Status am ${dayDE(d)}"><option value="">—</option><option value="offen" ${e.status === 'offen' ? 'selected' : ''}>offen</option><option value="bezahlt" ${e.status === 'bezahlt' ? 'selected' : ''}>bezahlt</option></select></td>
      ${calcCells(r)}
    </tr>`;
  }).join('');
  return `<div class="table-wrap" style="${opts.maxH ? `max-height:${opts.maxH};` : ''}"><table class="grid"><thead>${head}</thead><tbody>${rows}</tbody><tfoot>${footRow(days)}</tfoot></table></div>`;
}
function calcCells(r) {
  return `<td class="num" data-c="umsatz">${eur(r.umsatz)}</td><td class="num dim" data-c="einkauf">${eur(r.einkauf)}</td>
    <td class="num ${r.profit < 0 ? 'neg' : ''}" data-c="profit">${eur(r.profit)}</td><td class="num ${r.offen > 0 ? 'open' : 'dim'}" data-c="offen">${r.offen ? eur(r.offen) : '–'}</td>`;
}
function footRow(days) {
  const t = sumDays(days);
  return `<tr><td>Summe</td>${FIELDS.map(f => `<td class="num">${t.units[f] ? num(t.units[f]) : ''}</td>`).join('')}<td class="num">${t.manuell ? eur(t.manuell) : ''}</td><td></td>
    <td class="num">${eur(t.umsatz)}</td><td class="num">${eur(t.einkauf)}</td><td class="num ${t.profit < 0 ? 'neg' : ''}">${eur(t.profit)}</td><td class="num ${t.offen ? 'open' : ''}">${t.offen ? eur(t.offen) : '–'}</td></tr>`;
}
function wireGrid(el, days, onChange) {
  el.querySelectorAll('[data-open]').forEach(a => a.onclick = ev => { ev.preventDefault(); setDay(a.dataset.open); location.hash = 'tag'; });
  el.querySelectorAll('tbody tr').forEach(tr => {
    const d = tr.dataset.day;
    const refresh = () => {
      const r = calc(getEntry(d));
      tr.querySelectorAll('[data-c]').forEach(td => td.remove());
      tr.insertAdjacentHTML('beforeend', calcCells(r));
      el.querySelector('tfoot').innerHTML = footRow(days);
      onChange && onChange();
    };
    tr.querySelectorAll('input.cell').forEach(inp => {
      inp.oninput = () => {
        const v = parseNum(inp.value), f = inp.dataset.f;
        const bad = isNaN(v) || (f !== 'manuell' && v < 0);
        inp.classList.toggle('bad', bad);
        if (!bad) { setField(d, f, v); refresh(); }
      };
      inp.onblur = () => { const v = parseNum(inp.value); if (!isNaN(v)) inp.value = v ? numFmt.format(v) : ''; };
      inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); const next = tr.nextElementSibling?.querySelector(`[data-f="${inp.dataset.f}"]`); next?.focus(); next?.select?.(); } };
    });
    const sel = tr.querySelector('select.cell');
    sel.onchange = () => { sel.className = `cell ${sel.value}`; setField(d, 'status', sel.value); refresh(); };
  });
}

/* ---------- Diagramme ---------- */
function chartDefaults() {
  const ink2 = css('--ink-2'), grid = css('--grid');
  Chart.defaults.font.family = css('--sans') || 'system-ui';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = ink2;
  return { grid, ink: css('--ink'), ink3: css('--ink-3'), cost: css('--cost'), surface: css('--surface') };
}
function moneyChart(canvas, labels, series, opts = {}) {
  const c = chartDefaults();
  const datasets = [];
  // Balken einer Gruppe eng beieinander, auch wenn nur wenige Monate da sind
  const nBars = (series.umsatz ? 1 : 0) + (series.einkauf ? 1 : 0);
  const catW = (canvas.parentElement.clientWidth || 600) / Math.max(1, labels.length);
  const catPct = Math.min(0.8, Math.max(0.15, (nBars * 44) / catW));
  const bar = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 40, barPercentage: 0.9, categoryPercentage: catPct };
  if (series.umsatz) datasets.push({ type: 'bar', label: 'Umsatz', data: series.umsatz, backgroundColor: series.umsatzColors || series.color, ...bar, order: 2 });
  if (series.einkauf) datasets.push({ type: 'bar', label: 'Einkauf', data: series.einkauf, backgroundColor: c.cost, ...bar, order: 3 });
  if (series.profit) datasets.push({ type: 'line', label: 'Profit', data: series.profit, borderColor: c.ink, backgroundColor: c.ink, borderWidth: 2, pointRadius: labels.length > 20 ? 2 : 4, pointHoverRadius: 6, pointBackgroundColor: c.surface, pointBorderWidth: 2, tension: 0.25, order: 1 });
  if (series.cum) datasets.push({ type: 'line', label: opts.cumLabel || 'Profit kumuliert', data: series.cum, borderColor: series.cumColor || c.ink, backgroundColor: (series.cumColor || c.ink) + '22', fill: 'origin', borderWidth: 2, pointRadius: 3, tension: 0.25 });
  const ch = new Chart(canvas, {
    type: series.umsatz || series.einkauf ? 'bar' : 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: c.ink, titleColor: c.surface, bodyColor: c.surface, padding: 10, cornerRadius: 8, boxPadding: 4,
          callbacks: { title: items => opts.titles ? opts.titles[items[0].dataIndex] : items[0].label, label: it => ` ${it.dataset.label}: ${eur(it.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 8, color: c.ink3 }, border: { color: c.grid } },
        y: { grid: { color: c.grid }, border: { display: false }, ticks: { color: c.ink3, callback: v => eurShort(v), maxTicksLimit: 6 }, beginAtZero: true, suggestedMax: 100 },
      },
    },
  });
  S.charts.push(ch); return ch;
}
function legend(items) {
  return `<div class="legend">${items.map(([l, color, line]) => `<span><i class="${line ? 'line' : ''}" style="background:${color}"></i>${l}</span>`).join('')}</div>`;
}

/* ---------- Ansicht: Woche ---------- */
function viewWoche(el) {
  const ws = weekStart(S.day), days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  el.innerHTML = `
    <div class="card"><div class="period">
      <button class="btn" data-nav="-7" aria-label="Vorherige Woche">‹</button>
      <div class="period-title"><h2>KW ${isoWeek(ws)} · ${dayShort(ws)} – ${dayDE(days[6])}</h2><span class="sub">Zahlen direkt in die Tabelle tippen. Auf den Tag tippen für Info und Teilbetrag.</span></div>
      <button class="btn" data-nav="7" aria-label="Nächste Woche">›</button>
    </div></div>
    <div class="kpis" id="w-kpis"></div>
    <div class="card"><h3>Eintragen</h3>${gridTable(days)}</div>
    <div class="card"><h3>Woche im Diagramm</h3><div id="w-leg"></div><div class="chart-box short"><canvas id="w-chart" aria-label="Umsatz, Einkauf und Profit pro Tag"></canvas></div></div>`;
  el.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { setDay(addDays(S.day, +b.dataset.nav)); render(); });
  let chart;
  const draw = () => {
    paintKpis('w-kpis', sumDays(days));
    const rs = days.map(d => calc(getEntry(d)));
    const colors = days.map(d => monthColor(monthKey(d)));
    el.querySelector('#w-leg').innerHTML = legend([['Umsatz (Farbe = Monat)', colors[0]], ['Einkauf', css('--cost')], ['Profit', css('--ink'), true]]);
    if (chart) { chart.destroy(); S.charts = S.charts.filter(c => c !== chart); }
    chart = moneyChart(el.querySelector('#w-chart'), days.map(d => `${WD[wd(d)]} ${dayShort(d)}`),
      { umsatz: rs.map(r => r.umsatz), umsatzColors: colors, einkauf: rs.map(r => r.einkauf), profit: rs.map(r => r.profit) });
  };
  draw();
  let t; wireGrid(el, days, () => { paintKpis('w-kpis', sumDays(days)); clearTimeout(t); t = setTimeout(draw, 600); });
}
function paintKpis(id, t, prev) {
  const box = document.getElementById(id); if (!box) return;
  const d = (cur, old) => {
    if (!prev) return '';
    if (!old) return '<div class="delta">Vormonat: –</div>';
    const ch = (cur - old) / Math.abs(old) * 100;
    return `<div class="delta ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲' : '▼'} ${pct(Math.abs(ch))} zum Vormonat</div>`;
  };
  box.innerHTML = kpi('Umsatz', t.umsatz, '', d(t.umsatz, prev?.umsatz)) + kpi('Einkauf', t.einkauf, '', d(t.einkauf, prev?.einkauf))
    + kpi('Profit', t.profit, t.profit < 0 ? 'neg' : 'profit', d(t.profit, prev?.profit)) + kpi('Noch offen', t.offen, t.offen > 0 ? 'open' : 'open zero');
}

/* ---------- Ansicht: Monat ---------- */
function viewMonat(el) {
  const mk = monthKey(S.day), days = monthDays(mk), col = monthColor(mk);
  el.innerHTML = `
    <div class="card"><div class="month-band" style="margin:-4px 0 12px"></div><div class="period">
      <button class="btn" data-nav="-1" aria-label="Vorheriger Monat">‹</button>
      <div class="period-title"><h2><span class="month-chip"></span>${monthName(mk)}</h2><span class="sub">${days.length} Tage · Zahlen direkt eintippen, Enter springt zum nächsten Tag</span></div>
      <button class="btn" data-nav="1" aria-label="Nächster Monat">›</button>
    </div></div>
    <div class="kpis" id="m-kpis"></div>
    <div class="card"><h3>Umsatz, Einkauf und Profit pro Tag</h3><div id="m-leg"></div><div class="chart-box"><canvas id="m-chart" aria-label="Tageswerte im ${monthName(mk)}"></canvas></div></div>
    <div class="card"><div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">Eintragen</h3><button class="btn sm" id="m-csv">Monat als CSV</button></div>${gridTable(days, { maxH: '70vh' })}</div>`;
  el.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { setDay(addMonths(mk, +b.dataset.nav) + '-01'); render(); });
  el.querySelector('#m-csv').onclick = () => exportCSV(days, `Monatsbuch_${S.owner.name}_${mk}.csv`);
  let chart;
  const draw = () => {
    const rs = days.map(d => calc(getEntry(d)));
    el.querySelector('#m-leg').innerHTML = legend([['Umsatz', col], ['Einkauf', css('--cost')], ['Profit', css('--ink'), true]]);
    if (chart) { chart.destroy(); S.charts = S.charts.filter(c => c !== chart); }
    chart = moneyChart(el.querySelector('#m-chart'), days.map(d => String(Number(d.slice(8)))),
      { umsatz: rs.map(r => r.umsatz), color: col, einkauf: rs.map(r => r.einkauf), profit: rs.map(r => r.profit) },
      { titles: days.map(d => `${WD[wd(d)]}, ${dayDE(d)}`) });
  };
  paintKpis('m-kpis', sumDays(days), sumDays(monthDays(addMonths(mk, -1))));
  draw();
  let t; wireGrid(el, days, () => { paintKpis('m-kpis', sumDays(days), sumDays(monthDays(addMonths(mk, -1)))); clearTimeout(t); t = setTimeout(draw, 700); });
}

/* ---------- Ansicht: Auswertung ---------- */
function viewAuswertung(el) {
  el.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="margin:0">Auswertung</h2>
    <div class="seg" role="group" aria-label="Zeitraum"><button data-m="monat" aria-pressed="${S.statsMode === 'monat'}">Monat</button><button data-m="gesamt" aria-pressed="${S.statsMode === 'gesamt'}">Gesamt</button></div></div></div>
    <div id="a-body" style="display:flex;flex-direction:column;gap:16px"></div>`;
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { S.statsMode = b.dataset.m; render(); });
  const body = el.querySelector('#a-body');
  S.statsMode === 'monat' ? statsMonth(body) : statsAll(body);
}
function catBlock(t) {
  const colors = CAT_COLORS[mode()];
  const max = Math.max(1, ...CATS.map(c => t.catUmsatz[c.key]));
  return `<div class="card"><h3>Nach Kategorie</h3>
    <div style="display:flex;flex-direction:column;gap:12px">${CATS.map((c, i) => {
      const u = t.catUmsatz[c.key], w = Math.max(0, u / max * 100);
      return `<div><div class="row small" style="justify-content:space-between;gap:6px"><span><b>${c.label}</b> · ${num(t.units[c.key])} Stk. + ${num(t.units[c.bon])} Bon</span><span class="num">${eur(u)}</span></div>
        <div style="height:10px;border-radius:5px;background:var(--surface-2);margin-top:4px;overflow:hidden"><div style="height:100%;width:${w}%;background:${colors[i]};border-radius:5px"></div></div>
        <div class="small muted" style="margin-top:2px">Einkauf ${eur(t.catEinkauf[c.key])} · Profit ${eur(u - t.catEinkauf[c.key])}</div></div>`;
    }).join('')}</div></div>`;
}
function factsBlock(t, daysInPeriod) {
  const marge = t.umsatz ? t.profit / t.umsatz * 100 : NaN;
  const rows = [
    ['Tage mit Einträgen', `${t.active}${daysInPeriod ? ` von ${daysInPeriod}` : ''}`],
    ['Ø Umsatz pro Arbeitstag', t.active ? eur(t.umsatz / t.active) : '–'],
    ['Ø Profit pro Arbeitstag', t.active ? eur(t.profit / t.active) : '–'],
    ['Marge (Profit ÷ Umsatz)', pct(marge)],
    ['Bester Tag', t.best ? `${dayDE(t.best.day)} · ${eur(t.best.umsatz)}` : '–'],
    ['Manuelle Beträge', eur(t.manuell)],
    ['Stück gesamt (ohne Bon)', num(CATS.reduce((a, c) => a + t.units[c.key], 0))],
    ['Bon gesamt', num(CATS.reduce((a, c) => a + t.units[c.bon], 0))],
  ];
  return `<div class="card"><h3>Kennzahlen</h3><div class="list">${rows.map(([k, v]) => `<div class="item" style="padding:9px 0"><span class="main muted">${k}</span><span class="num">${v}</span></div>`).join('')}</div></div>`;
}
function statsMonth(el) {
  const mk = monthKey(S.day), days = monthDays(mk), col = monthColor(mk);
  const t = sumDays(days), prev = sumDays(monthDays(addMonths(mk, -1)));
  el.innerHTML = `
    <div class="card"><div class="month-band" style="margin:-4px 0 12px"></div><div class="period">
      <button class="btn" data-nav="-1" aria-label="Vorheriger Monat">‹</button>
      <div class="period-title"><h2><span class="month-chip"></span>${monthName(mk)}</h2><span class="sub">Vergleich mit ${monthName(addMonths(mk, -1))}</span></div>
      <button class="btn" data-nav="1" aria-label="Nächster Monat">›</button></div></div>
    <div class="kpis" id="s-kpis"></div>
    <div class="two">
      <div class="card"><h3>Tagesverlauf</h3>${legend([['Umsatz', col], ['Einkauf', css('--cost')], ['Profit', css('--ink'), true]])}<div class="chart-box tall"><canvas id="s-chart"></canvas></div></div>
      ${catBlock(t)}
    </div>
    <div class="two">
      <div class="card"><h3>Profit im Monat aufsummiert</h3>${legend([['Profit kumuliert', col, true]])}<div class="chart-box short"><canvas id="s-cum"></canvas></div></div>
      ${factsBlock(t, days.length)}
    </div>`;
  el.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { setDay(addMonths(mk, +b.dataset.nav) + '-01'); render(); });
  paintKpis('s-kpis', t, prev);
  const rs = days.map(d => calc(getEntry(d)));
  const labels = days.map(d => String(Number(d.slice(8)))), titles = days.map(d => `${WD[wd(d)]}, ${dayDE(d)}`);
  moneyChart(el.querySelector('#s-chart'), labels, { umsatz: rs.map(r => r.umsatz), color: col, einkauf: rs.map(r => r.einkauf), profit: rs.map(r => r.profit) }, { titles });
  let acc = 0; const cum = rs.map(r => (acc += r.profit));
  moneyChart(el.querySelector('#s-cum'), labels, { cum, cumColor: col }, { titles });
}
function monthRange() {
  const keys = [...S.entries.keys()].sort();
  const cur = monthKey(todayStr());
  if (!keys.length) return [cur];
  let a = monthKey(keys[0]), b = monthKey(keys[keys.length - 1]);
  if (cur > b) b = cur;
  const out = []; for (let k = a; k <= b; k = addMonths(k, 1)) out.push(k);
  return out;
}
function statsAll(el) {
  const months = monthRange();
  const per = months.map(k => ({ k, t: sumDays(monthDays(k)) }));
  const all = sumDays([...S.entries.keys()]);
  const best = per.reduce((a, b) => (!a || b.t.profit > a.t.profit ? b : a), null);
  el.innerHTML = `
    <div class="kpis" id="g-kpis"></div>
    <div class="card"><h3>Monate im Vergleich</h3>${legend([['Umsatz (jeder Monat in seiner Farbe)', monthColor(months[months.length - 1])], ['Einkauf', css('--cost')], ['Profit', css('--ink'), true]])}
      <div class="chart-box tall"><canvas id="g-chart"></canvas></div></div>
    <div class="two">
      <div class="card"><h3>Profit seit Beginn aufsummiert</h3><div class="chart-box short"><canvas id="g-cum"></canvas></div></div>
      ${catBlock(all)}
    </div>
    <div class="card"><div class="row" style="margin-bottom:10px"><h3 class="grow" style="margin:0">Alle Monate</h3><button class="btn sm" id="g-csv">Alles als CSV</button></div>
      <div class="table-wrap"><table class="grid"><thead><tr><th class="l">Monat</th><th>Umsatz</th><th>Einkauf</th><th>Profit</th><th>Marge</th><th>Noch offen</th><th>Arbeitstage</th></tr></thead>
      <tbody>${per.slice().reverse().map(({ k, t }) => `<tr><td><a href="#monat" class="daylink" data-month="${k}"><span class="month-chip" style="background:${monthColor(k)}"></span>${monthName(k)}</a></td>
        <td class="num">${eur(t.umsatz)}</td><td class="num dim">${eur(t.einkauf)}</td><td class="num ${t.profit < 0 ? 'neg' : ''}">${eur(t.profit)}</td>
        <td class="num">${pct(t.umsatz ? t.profit / t.umsatz * 100 : NaN)}</td><td class="num ${t.offen ? 'open' : 'dim'}">${t.offen ? eur(t.offen) : '–'}</td><td class="num">${t.active}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Gesamt</td><td class="num">${eur(all.umsatz)}</td><td class="num">${eur(all.einkauf)}</td><td class="num">${eur(all.profit)}</td><td class="num">${pct(all.umsatz ? all.profit / all.umsatz * 100 : NaN)}</td><td class="num">${all.offen ? eur(all.offen) : '–'}</td><td class="num">${all.active}</td></tr></tfoot></table></div>
      ${best && best.t.profit ? `<p class="small muted" style="margin:10px 0 0">Bester Monat: <b>${monthName(best.k)}</b> mit ${eur(best.t.profit)} Profit.</p>` : ''}
    </div>`;
  const avg = per.filter(p => p.t.active).length;
  document.getElementById('g-kpis').innerHTML = kpi('Umsatz gesamt', all.umsatz) + kpi('Einkauf gesamt', all.einkauf)
    + kpi('Profit gesamt', all.profit, all.profit < 0 ? 'neg' : 'profit', `<div class="delta">Ø ${eur(avg ? all.profit / avg : 0)} pro Monat</div>`)
    + kpi('Noch offen', all.offen, all.offen > 0 ? 'open' : 'open zero');
  const labels = per.map(p => `${MONTHS_SHORT[monthIdx(p.k)]} ${p.k.slice(2, 4)}`), titles = per.map(p => monthName(p.k));
  moneyChart(el.querySelector('#g-chart'), labels, { umsatz: per.map(p => p.t.umsatz), umsatzColors: per.map(p => monthColor(p.k)), einkauf: per.map(p => p.t.einkauf), profit: per.map(p => p.t.profit) }, { titles });
  let acc = 0;
  moneyChart(el.querySelector('#g-cum'), labels, { cum: per.map(p => (acc += p.t.profit)), cumColor: css('--accent') }, { titles });
  el.querySelectorAll('[data-month]').forEach(a => a.onclick = ev => { ev.preventDefault(); setDay(a.dataset.month + '-01'); location.hash = 'monat'; });
  el.querySelector('#g-csv').onclick = () => exportCSV([...S.entries.keys()].sort(), `Monatsbuch_${S.owner.name}_alles.csv`);
}

/* ---------- Ansicht: Offen ---------- */
function viewOffen(el) {
  const items = [...S.entries.values()].filter(e => e.status === 'offen').sort((a, b) => a.day < b.day ? 1 : -1);
  const total = items.reduce((a, e) => a + calc(e).offen, 0), totalU = items.reduce((a, e) => a + calc(e).umsatz, 0);
  el.innerHTML = `
    <div class="kpis"><div class="kpi open ${total ? '' : 'zero'}"><div class="lbl">Noch offen</div><div class="val">${eur(total)}</div></div>
      <div class="kpi"><div class="lbl">Offene Posten</div><div class="val">${items.length}</div></div>
      <div class="kpi"><div class="lbl">Umsatz dieser Posten</div><div class="val">${eur(totalU)}</div></div>
      <div class="kpi"><div class="lbl">Schon bezahlt davon</div><div class="val">${eur(totalU - total)}</div></div></div>
    <div class="card"><h2>Offene Posten</h2>${items.length ? `<div class="list">${items.map(e => {
      const r = calc(e);
      return `<div class="item" data-day="${e.day}">
        <div class="main"><div class="t"><a href="#tag" class="daylink" data-open="${e.day}">${WD[wd(e.day)]}, ${dayDE(e.day)}</a> <span class="pill offen">offen</span></div>
          <div class="small muted">Umsatz ${eur(r.umsatz)}${e.teil !== null ? ' · Teilbetrag' : ' · ganzer Betrag'}${e.info ? ' · ' + esc(e.info) : ''}</div></div>
        <div class="amt open">${eur(r.offen)}</div>
        <div class="actions">
          <input class="input mono" style="width:110px;min-height:36px" inputmode="decimal" placeholder="Rest €" value="${e.teil !== null ? numFmt.format(e.teil) : ''}" aria-label="Teilbetrag offen am ${dayDE(e.day)}" data-teil>
          <button class="btn sm good" data-paid>Bezahlt</button></div></div>`;
    }).join('')}</div>` : '<p class="muted" style="margin:0">Keine offenen Posten. Wenn du im Tag-Reiter oder in Woche/Monat den Status auf „offen“ stellst, erscheint der Posten hier.</p>'}</div>`;
  el.querySelectorAll('[data-open]').forEach(a => a.onclick = ev => { ev.preventDefault(); setDay(a.dataset.open); location.hash = 'tag'; });
  el.querySelectorAll('.item[data-day]').forEach(it => {
    const d = it.dataset.day;
    it.querySelector('[data-paid]').onclick = () => { setField(d, 'status', 'bezahlt'); toast(`${dayDE(d)} als bezahlt markiert`); render(); };
    const inp = it.querySelector('[data-teil]');
    inp.onchange = () => { const raw = inp.value.trim(), v = parseNum(raw); if (raw === '') setField(d, 'teil', null); else if (!isNaN(v) && v >= 0) setField(d, 'teil', v); else return inp.classList.add('bad'); render(); };
  });
}

/* ---------- Ansicht: Preise ---------- */
function viewPreise(el) {
  const rows = S.eff.slice().reverse();
  el.innerHTML = `
    <div class="card"><h2>Preise</h2>
      <p class="muted" style="margin:0 0 12px">Jede Zeile gilt ab ihrem Datum. Jeder Tag rechnet mit den Preisen, die an diesem Tag galten. Bei einer Preisänderung legst du eine <b>neue Zeile</b> an und trägst nur die geänderten Preise ein. Leere Felder übernehmen den Preis von davor. Alte Tage bleiben so, wie sie waren.</p>
      <form id="p-form" class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">
        <label class="field" style="grid-column:span 2">Gültig ab<input type="date" class="input" id="p-date" required value="${todayStr()}"></label>
        ${['c', 'w', 's', 'k', 'cb', 'wb', 'sb', 'kb'].map(f => `<label class="field">${LABEL[f]} (€)<input class="input mono" data-p="${f}" inputmode="decimal" placeholder="${S.eff.length ? numFmt.format(priceFor(todayStr())[f]) : '0'}"></label>`).join('')}
        <div class="field" style="grid-column:1/-1"><p class="err" id="p-err" hidden></p><div class="row"><button class="btn primary" type="submit">${S.eff.length ? 'Preisänderung speichern' : 'Erste Preise speichern'}</button><span class="small muted">${S.eff.length ? 'Leere Felder = gleicher Preis wie vorher (grau vorgeschlagen).' : 'Die erste Zeile braucht alle 8 Preise. 0 ist erlaubt.'}</span></div></div>
      </form></div>
    <div class="card"><h3>Preisverlauf</h3>${rows.length ? `<div class="table-wrap"><table class="grid price-tbl"><thead><tr><th class="l">Gültig ab</th>${['c', 'w', 's', 'k', 'cb', 'wb', 'sb', 'kb'].map(f => `<th>${LABEL[f]}</th>`).join('')}<th></th></tr></thead><tbody>
      ${rows.map(p => `<tr data-id="${p.id}"><td>${dayDE(p.valid_from)}</td>${['c', 'w', 's', 'k', 'cb', 'wb', 'sb', 'kb'].map(f => `<td class="num ${p.given[f] ? 'given' : 'carried'}">${eur(p[f])}</td>`).join('')}
        <td class="l"><button class="btn sm danger" data-del>Löschen</button></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin:10px 0 0">Fett = in dieser Zeile eingetragen, grau = von davor übernommen. Löschen ändert die Berechnung aller Tage ab diesem Datum.</p>` : '<p class="muted" style="margin:0">Noch keine Preise.</p>'}</div>`;
  el.querySelector('#p-form').onsubmit = async ev => {
    ev.preventDefault();
    const err = el.querySelector('#p-err'); err.hidden = true;
    const body = { u: S.owner.id, valid_from: el.querySelector('#p-date').value };
    for (const inp of el.querySelectorAll('[data-p]')) {
      const raw = inp.value.trim();
      if (raw === '') { body[inp.dataset.p] = null; continue; }
      const v = parseNum(raw); if (isNaN(v) || v < 0) { err.textContent = `${LABEL[inp.dataset.p]}: bitte einen Betrag ab 0 eintragen.`; err.hidden = false; return; }
      body[inp.dataset.p] = v;
    }
    if (FIELDS.every(f => body[f] === null)) { err.textContent = 'Bitte mindestens einen Preis eintragen.'; err.hidden = false; return; }
    try { await api('savePrice', body); await reloadKeepView(); toast(`Preise ab ${dayDE(body.valid_from)} gespeichert`); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Wirklich löschen?'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Löschen'; } }, 4000); return; }
    try { await api('deletePrice', { u: S.owner.id, id: Number(b.closest('tr').dataset.id) }); await reloadKeepView(); toast('Preiszeile gelöscht'); }
    catch (e) { toast(e.message); }
  });
}
async function reloadKeepView() { await flushSaves(); await loadData(S.owner.id); render(); }

/* ---------- Ansicht: Benutzer (Admin) ---------- */
function viewBenutzer(el) {
  el.innerHTML = `
    <div class="card"><h2>Benutzer</h2>
      <p class="muted" style="margin:0 0 12px">Jeder Benutzer hat seine eigene, unabhängige Tabelle mit eigenen Preisen. Mitarbeiter sehen nur ihre eigenen Daten. Als Admin kannst du oben rechts jede Tabelle öffnen.</p>
      <div class="list">${S.users.map(u => `<div class="item" data-id="${u.id}">
        <div class="main"><div class="t">${esc(u.name)} ${u.isAdmin ? '<span class="pill admin">Admin</span>' : ''} ${u.id === S.me.id ? '<span class="small muted">(du)</span>' : ''}</div>
          <div class="small muted">@${esc(u.username)} · ${u.days} Tage erfasst${u.lastDay ? ' · zuletzt ' + dayDE(u.lastDay) : ''}</div></div>
        <div class="actions">
          <button class="btn sm" data-open>Tabelle öffnen</button>
          <button class="btn sm" data-pw>Passwort setzen</button>
          ${u.id !== S.me.id ? `<button class="btn sm" data-admin>${u.isAdmin ? 'Admin entziehen' : 'Zum Admin machen'}</button><button class="btn sm danger" data-del>Löschen</button>` : ''}
        </div>
        <form class="row" data-pwform hidden style="width:100%"><input class="input" type="password" minlength="8" required placeholder="Neues Passwort (min. 8 Zeichen)" autocomplete="new-password" style="max-width:280px"><button class="btn sm primary">Speichern</button></form>
      </div>`).join('')}</div></div>
    <div class="card"><h3>Neuen Benutzer anlegen</h3>
      <form id="u-form" class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        <label class="field">Name<input class="input" id="u-name" required maxlength="40" placeholder="z. B. Mitarbeiter 1"></label>
        <label class="field">Benutzername<input class="input" id="u-user" required pattern="[A-Za-z0-9._\\-]{3,32}" autocapitalize="none" spellcheck="false" placeholder="z. B. mitarbeiter1"></label>
        <label class="field">Startpasswort<input class="input" id="u-pass" type="text" required minlength="8" autocomplete="off" placeholder="min. 8 Zeichen"></label>
        <div class="field" style="grid-column:1/-1;gap:8px">
          <label class="check"><input type="checkbox" id="u-copy" checked> Preise aus der Tabelle von ${esc(S.owner.name)} übernehmen</label>
          <label class="check"><input type="checkbox" id="u-admin"> Admin-Rechte (sieht und bearbeitet alle Tabellen)</label>
          <p class="err" id="u-err" hidden></p>
          <div><button class="btn primary" type="submit">Benutzer anlegen</button></div>
        </div>
      </form></div>`;
  el.querySelector('#u-form').onsubmit = async ev => {
    ev.preventDefault();
    const err = el.querySelector('#u-err'); err.hidden = true;
    const body = { name: el.querySelector('#u-name').value.trim(), username: el.querySelector('#u-user').value.trim(), password: el.querySelector('#u-pass').value, isAdmin: el.querySelector('#u-admin').checked };
    if (el.querySelector('#u-copy').checked) body.copyPricesFrom = S.owner.id;
    try { const r = await api('createUser', body); S.users = r.users; render(); toast(`${body.name} angelegt. Zugangsdaten weitergeben: ${body.username} / Startpasswort`); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  el.querySelectorAll('.item[data-id]').forEach(it => {
    const id = Number(it.dataset.id), u = S.users.find(x => x.id === id);
    it.querySelector('[data-open]').onclick = async () => { await flushSaves(); await loadData(id); renderShell(); location.hash = 'tag'; route(); };
    it.querySelector('[data-pw]').onclick = () => { const f = it.querySelector('[data-pwform]'); f.hidden = !f.hidden; f.querySelector('input').focus(); };
    it.querySelector('[data-pwform]').onsubmit = async ev => { ev.preventDefault(); try { await api('updateUser', { id, password: ev.target.querySelector('input').value }); toast(`Passwort für ${u.name} gesetzt`); ev.target.hidden = true; } catch (e) { toast(e.message); } };
    it.querySelector('[data-admin]')?.addEventListener('click', async () => { try { const r = await api('updateUser', { id, isAdmin: !u.isAdmin }); S.users = r.users; render(); } catch (e) { toast(e.message); } });
    const del = it.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = `Ja, ${u.name} und alle Daten löschen`; setTimeout(() => { if (del.isConnected) { del.dataset.armed = ''; del.textContent = 'Löschen'; } }, 5000); return; }
      try { const r = await api('deleteUser', { id }); S.users = r.users; if (S.owner.id === id) { await loadData(S.me.id); renderShell(); location.hash = 'benutzer'; route(); } else render(); toast(`${u.name} gelöscht`); }
      catch (e) { toast(e.message); }
    };
  });
}

/* ---------- Konto & Export ---------- */
function viewKonto(el) {
  el.innerHTML = `<div class="card" style="max-width:480px"><h2>Passwort ändern</h2>
    <form id="k-form" style="display:flex;flex-direction:column;gap:10px">
      <input type="text" autocomplete="username" value="${esc(S.me.username)}" hidden>
      <label class="field">Altes Passwort<input class="input" type="password" id="k-old" required autocomplete="current-password"></label>
      <label class="field">Neues Passwort<input class="input" type="password" id="k-new" required minlength="8" autocomplete="new-password"></label>
      <p class="err" id="k-err" hidden></p><div><button class="btn primary">Speichern</button></div></form></div>`;
  el.querySelector('#k-form').onsubmit = async ev => {
    ev.preventDefault(); const err = el.querySelector('#k-err'); err.hidden = true;
    try { await api('changePassword', { old: el.querySelector('#k-old').value, new: el.querySelector('#k-new').value }); toast('Passwort geändert'); location.hash = 'tag'; }
    catch (e) { err.textContent = e.message; err.hidden = false; }
  };
}
function viewExport(el) {
  const mk = monthKey(S.day);
  el.innerHTML = `<div class="card" style="max-width:560px"><h2>Daten exportieren</h2>
    <p class="muted">CSV-Dateien öffnen sich in Excel und Google Sheets. Getrennt mit Semikolon, Komma als Dezimalzeichen.</p>
    <div class="row"><button class="btn" id="x-m">${monthName(mk)}</button><button class="btn primary" id="x-a">Alle Tage</button></div></div>`;
  el.querySelector('#x-m').onclick = () => exportCSV(monthDays(mk), `Monatsbuch_${S.owner.name}_${mk}.csv`);
  el.querySelector('#x-a').onclick = () => exportCSV([...S.entries.keys()].sort(), `Monatsbuch_${S.owner.name}_alles.csv`);
}
function exportCSV(days, filename) {
  const n = v => String(Math.round((v || 0) * 100) / 100).replace('.', ',');
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const head = ['Datum', ...FIELDS.map(f => LABEL[f]), 'Manuell', 'Umsatz', 'Einkauf', 'Profit', 'Status', 'Teilbetrag offen', 'Noch offen', 'Info'];
  const lines = [head.join(';')];
  for (const d of days) {
    const e = S.entries.get(d); if (!e) continue; const r = calc(e);
    lines.push([dayDE(d), ...FIELDS.map(f => n(e[f])), n(e.manuell), n(r.umsatz), n(r.einkauf), n(r.profit), e.status, e.teil === null ? '' : n(e.teil), n(r.offen), q(e.info)].join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename.replace(/[^\wäöüÄÖÜß.-]+/g, '_');
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`${lines.length - 1} Tage exportiert`);
}

boot();
})();
