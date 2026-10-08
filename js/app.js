import { SERVER_URL, MAIN_SYMBOL, HOLDINGS, HOLDINGS_ASOF, EARNINGS_EXTRA, NEWS_SYMBOLS, POLL_MS, NEWS_POLL_MS, getApiKey, setApiKey, restoreApiKey } from './config.js';
import { createFinnhub, usdToEur, lastFinnhub } from './api.js';

const VERSION = '2026-10-08.14';
import { demo } from './demo.js';
import { upcomingEvents } from './events.js';
import { getPortfolio, setPortfolio, portfolioFigures } from './portfolio.js';
import { pushSupport, permission, enablePush, listAlarms, addAlarm, deleteAlarm, sendTest } from './alarms.js';
import { toGerman, cachedGerman } from './translate.js';

const $ = (sel) => document.querySelector(sel);
// Top-10: zuerst die eingebaute Liste, beim Start durch Direxions aktuelle Liste ersetzt.
let holdings = HOLDINGS;
let holdingsNote = `Anteil am Fondsvermögen laut Direxion, Stand ${HOLDINGS_ASOF}.`;
let SYMBOLS = [MAIN_SYMBOL, ...holdings.map((h) => h.symbol)];
const KNOWN_NAMES = Object.fromEntries([...HOLDINGS, ...EARNINGS_EXTRA].map((h) => [h.symbol, h.name]));
const prettyName = (s) => s.toLowerCase().replace(/\b(inc|corp|corporation|co|ltd|plc|sa|nv|adr|sponsored|class [a-z]|com|new)\b\.?/g, '')
  .replace(/\s+/g, ' ').trim().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

async function loadHoldings() {
  try {
    const r = await api.holdings();
    holdings = r.holdings.map((h) => ({ ...h, name: KNOWN_NAMES[h.symbol] || prettyName(h.name) }));
    SYMBOLS = [MAIN_SYMBOL, ...holdings.map((h) => h.symbol)];
    const m = String(r.asOf).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); // Direxion: Monat/Tag/Jahr
    holdingsNote = `Anteil am Fondsvermögen laut Direxion, Stand ${m ? `${m[2]}.${m[1]}.${m[3]}` : r.asOf}.`;
  } catch { /* eingebaute Liste bleibt */ }
  renderHoldings();
}

const state = {
  quotes: {},      // symbol -> quote
  ext: {},         // symbol -> Kurs inkl. Vor-/Nachbörse
  eur: null,       // { rate, date }
  live: 'offline',
};

let api, stopLive, pollTimer, newsTimer;

// ---------- Formatierung ----------
const usd = (n) => n == null ? '–' : '$' + n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (n) => n == null ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const pct = (n) => (n > 0 ? '+' : '') + n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
const signed = (n) => (n > 0 ? '+' : '') + n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dir = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const timeDe = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `vor ${Math.max(m, 1)} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- US-Handelszeit (New York) ----------
export function marketSession(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'closed';
  const min = +parts.hour * 60 + +parts.minute;
  if (min >= 240 && min < 570) return 'pre';
  if (min >= 570 && min < 960) return 'open';
  if (min >= 960 && min < 1200) return 'post';
  return 'closed';
}
const SESSION_LABEL = { pre: 'Vorbörse', open: 'Handel offen', post: 'Nachbörse', closed: 'Börse zu' };

function renderSession() {
  const s = marketSession();
  const el = $('#session');
  el.textContent = SESSION_LABEL[s] + (state.live === 'live' ? ' · live' : '');
  el.className = 'badge ' + (s === 'open' ? 'open' : s === 'pre' || s === 'post' ? 'ext' : '');
}

// ---------- Darstellung ----------
// Was für ein Symbol angezeigt wird: während des Handels der Finnhub-Kurs, außerhalb der
// Handelszeit der Vor- bzw. Nachbörsenkurs, verglichen mit dem letzten Schlusskurs.
function view(sym) {
  const q = state.quotes[sym], e = state.ext[sym];
  if (e?.price && e.session !== 'regular' && marketSession() !== 'open') {
    const base = e.regularPrice ?? q?.price;
    return { price: e.price, base, change: e.price - base, changePct: base ? (e.price / base - 1) * 100 : 0,
      time: e.time, ext: e.session === 'pre' ? 'Vorbörse' : 'Nachbörse', q };
  }
  if (!q) return null;
  return { price: q.price, base: q.prevClose, change: q.change, changePct: q.changePct, time: q.time, q };
}

function renderMain(flash = false) {
  const v = view(MAIN_SYMBOL);
  if (!v) return;
  const q = v.q;
  $('#soxl-price').textContent = usd(v.price);
  const ch = $('#soxl-change');
  ch.textContent = `${signed(v.change)} (${pct(v.changePct)})${v.ext ? ' · ' + v.ext : ''}`;
  ch.className = 'hero-change ' + dir(v.change);
  $('#soxl-eur').textContent = state.eur ? `≈ ${eur(v.price * state.eur.rate)}` : '';
  $('#soxl-ext').hidden = !v.ext;
  if (v.ext && q) $('#soxl-ext').textContent = `Letzter Schlusskurs ${usd(v.base)}${q.prevClose ? ` (${pct((v.base / q.prevClose - 1) * 100)} zum Vortag)` : ''}`;
  $('#soxl-pc-label').textContent = v.ext ? 'Schluss' : 'Vortag';
  $('#soxl-pc').textContent = usd(v.base);
  $('#soxl-l').textContent = q ? usd(q.low) : '–';
  $('#soxl-h').textContent = q ? usd(q.high) : '–';
  $('#soxl-updated').textContent = `Stand ${timeDe(v.time)} Uhr${v.ext ? ' (' + v.ext + ')' : ''}`;
  if (flash) { const p = $('#soxl-price'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); }
  renderPortfolio();
}

// ---------- Portfolio ----------
const money = (usdVal, eurVal) => eurVal != null ? eur(eurVal) : usd(usdVal);
const signedMoney = (usdVal, eurVal) => ((eurVal ?? usdVal) > 0 ? '+' : '') + money(usdVal, eurVal);

function renderPortfolio() {
  const p = getPortfolio();
  const v = view(MAIN_SYMBOL);
  const f = portfolioFigures(p, v && { price: v.price, prevClose: v.base }, state.eur?.rate);
  $('#pf-summary').hidden = !f;
  $('#mini-pf').hidden = !f;
  if (!f) return;
  $('#pf-shares').textContent = `${p.shares.toLocaleString('de-DE')} Anteile`;
  $('#pf-value-eur').textContent = money(f.valueUsd, f.valueEur);
  $('#pf-value-usd').textContent = f.valueEur != null ? usd(f.valueUsd) : '';
  const day = $('#pf-day');
  day.innerHTML = `${signedMoney(f.dayUsd, f.dayEur)}<small>${pct(f.dayPct)}</small>`;
  day.className = 'pf-num ' + dir(f.dayUsd);
  $('#pf-pl-box').hidden = f.plPct == null && f.plUsd == null;
  if (f.plUsd != null || f.plEur != null) {
    const pl = $('#pf-pl');
    pl.innerHTML = `${signedMoney(f.plUsd, f.plEur)}<small>${f.plPct != null ? pct(f.plPct) : ''}</small>`;
    pl.className = 'pf-num ' + dir(f.plUsd ?? f.plEur);
  }
  $('#pf-foot').textContent = state.eur ? `Euro-Kurs der EZB vom ${new Date(state.eur.date).toLocaleDateString('de-DE')}: 1 $ = ${state.eur.rate.toLocaleString('de-DE', { maximumFractionDigits: 4 })} €` : 'Euro-Kurs wird geladen …';
  $('#mini-pf').innerHTML = `<div><div class="pf-label">Dein Depot</div><div class="pf-num">${money(f.valueUsd, f.valueEur)}</div></div>
    <div class="pf-num ${dir(f.dayUsd)}">${signedMoney(f.dayUsd, f.dayEur)}<small>heute</small></div>`;
}

function fillPortfolioForm() {
  const p = getPortfolio();
  $('#pf-shares-in').value = p.shares || '';
  $('#pf-cost-in').value = p.cost || '';
  $('#pf-cur-in').value = p.currency;
}

$('#pf-save').addEventListener('click', () => {
  const num = (v) => parseFloat(String(v).replace(',', '.')) || 0;
  const shares = num($('#pf-shares-in').value), cost = num($('#pf-cost-in').value);
  if (shares < 0 || cost < 0) { $('#pf-status').textContent = 'Bitte nur positive Zahlen eingeben.'; return; }
  setPortfolio({ shares, cost, currency: $('#pf-cur-in').value });
  $('#pf-status').textContent = shares ? 'Gespeichert.' : 'Portfolio geleert.';
  renderPortfolio();
});
$('#mini-pf').addEventListener('click', () => show('portfolio'));

function renderHoldings() {
  $('#holdings').innerHTML = holdings.map((h) => {
    const q = view(h.symbol);
    return `<li data-sym="${h.symbol}">
      <div class="left"><div class="sym">${h.symbol}</div><div class="name">${esc(h.name)}</div></div>
      <div class="weight">${h.weight.toLocaleString('de-DE', { minimumFractionDigits: 1 })} %</div>
      <div class="right">
        <div class="price">${q ? usd(q.price) : '–'}</div>
        <div class="chg ${q ? dir(q.change) : ''}">${q ? pct(q.changePct) : ''}</div>
      </div></li>`;
  }).join('');
  $('#holdings-asof').textContent = holdingsNote;
}

// Ganzen Artikel über Google Übersetzer öffnen (nur auf Wunsch, aus der Lesansicht heraus).
const germanUrl = (url) => /^https?:/.test(url)
  ? `https://translate.google.com/translate?sl=auto&tl=de&hl=de&u=${encodeURIComponent(url)}` : url;

let newsItems = [];

function renderNews(items) {
  newsItems = items;
  $('#news').innerHTML = items.length ? items.map((n, i) => `<li data-i="${i}" role="button" tabindex="0">
      <div class="headline">${esc(cachedGerman(n.title) || n.title)}</div>
      <div class="meta"><span class="tag">${esc(n.symbol)}</span> · ${esc(n.source)} · ${ago(n.time)}</div>
    </li>`).join('') : '<li class="empty">Keine News gefunden.</li>';
  // Überschriften im Hintergrund übersetzen und dann austauschen.
  toGerman(items.map((n) => n.title)).then((de) => {
    if (items !== newsItems) return;
    document.querySelectorAll('#news li[data-i] .headline').forEach((el, i) => { el.textContent = de[i]; });
  });
}

async function openArticle(i) {
  const n = newsItems[i];
  if (!n) return;
  $('#article-title').textContent = cachedGerman(n.title) || n.title;
  $('#article-meta').textContent = `${n.symbol} · ${n.source} · ${ago(n.time)}`;
  $('#article-body').textContent = n.summary ? 'Wird übersetzt …' : 'Zu dieser Meldung liefert die Quelle keine Zusammenfassung.';
  $('#article-orig-title').textContent = n.title;
  $('#article-full').href = germanUrl(n.url);
  $('#article-full').hidden = !/^https?:/.test(n.url);
  show('article', 'news');
  const [title, body] = await toGerman([n.title, n.summary || '']);
  if (newsItems[i] !== n) return;
  $('#article-title').textContent = title;
  if (n.summary) $('#article-body').textContent = body;
}
$('#news').addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) openArticle(+li.dataset.i); });
$('#btn-back').addEventListener('click', () => show('news'));

const KIND_ICON = { fed: '🏦', macro: '📊', earnings: '💰', market: '🔔' };
const dayKey = (d) => d.toLocaleDateString('sv-SE');

function renderEvents(earnings) {
  const names = Object.fromEntries([...holdings, ...EARNINGS_EXTRA].map((h) => [h.symbol, h.name]));
  const events = upcomingEvents(earnings, names, 28);
  const today = dayKey(new Date()), tomorrow = dayKey(new Date(Date.now() + 864e5));
  let html = '', last = '';
  for (const e of events) {
    if (e.date !== last) {
      last = e.date;
      const label = new Date(e.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
      html += `<li class="day">${e.date === today ? 'Heute, ' : e.date === tomorrow ? 'Morgen, ' : ''}${label}</li>`;
    }
    const time = e.at ? timeDe(e.at) + ' Uhr' : '';
    html += `<li class="ev ev-${e.kind}">
      <div class="ev-icon">${KIND_ICON[e.kind] || '•'}</div>
      <div class="left"><div class="ev-title">${esc(e.title)}</div><div class="name">${esc(e.detail || '')}</div></div>
      <div class="right ev-time">${time}</div></li>`;
  }
  $('#events').innerHTML = html || '<li class="empty">Keine Termine in den nächsten vier Wochen.</li>';
}

// ---------- Laden ----------
async function loadQuotes() {
  const results = await Promise.allSettled(SYMBOLS.map((s) => api.quote(s)));
  results.forEach((r, i) => { if (r.status === 'fulfilled') state.quotes[SYMBOLS[i]] = r.value; });
  const failed = results.find((r) => r.status === 'rejected');
  if (failed && !state.quotes[MAIN_SYMBOL]) $('#soxl-updated').textContent = failed.reason.message;
  renderMain(); renderHoldings();
}

// Vor-/Nachbörsenkurse, nur außerhalb der regulären Handelszeit.
async function loadExtended() {
  if (!api.extended || marketSession() === 'open') return;
  const results = await Promise.allSettled(SYMBOLS.map((s) => api.extended(s)));
  results.forEach((r, i) => { if (r.status === 'fulfilled' && r.value.price) state.ext[SYMBOLS[i]] = r.value; });
  renderMain(); renderHoldings();
}

async function loadNews() {
  try { renderNews(await api.news(NEWS_SYMBOLS)); }
  catch (e) { $('#news').innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
}

async function loadEarnings() {
  renderEvents([]); // feste Termine sofort zeigen, Quartalszahlen kommen dazu
  try { renderEvents(await api.earnings([...new Set([...holdings, ...EARNINGS_EXTRA].map((h) => h.symbol))])); } catch { /* feste Termine bleiben */ }
}

async function loadFx() {
  try { state.eur = await usdToEur(); renderMain(); } catch { /* Euro-Anzeige ist optional */ }
}

function onTrade(symbol, price, time) {
  const q = state.quotes[symbol];
  if (!q) return;
  q.price = price;
  q.change = price - q.prevClose;
  q.changePct = q.prevClose ? (q.change / q.prevClose) * 100 : 0;
  q.high = Math.max(q.high || price, price);
  q.low = q.low ? Math.min(q.low, price) : price;
  q.time = time;
  scheduleRender(symbol === MAIN_SYMBOL);
}

// Live-Trades kommen teils mehrmals pro Sekunde; höchstens einmal pro Frame zeichnen.
let renderQueued = false, flashMain = false;
function scheduleRender(main) {
  flashMain ||= main;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderMain(flashMain); renderHoldings(); flashMain = false; });
}

async function start() {
  stop();
  const key = getApiKey();
  api = key || SERVER_URL ? createFinnhub(key, SERVER_URL) : demo;
  $('#demo-banner').hidden = !!(key || SERVER_URL);
  $('#api-key').value = key;
  loadNews(); loadFx();
  await loadHoldings();
  loadQuotes(); loadExtended(); loadEarnings();
  stopLive = api.live(SYMBOLS, onTrade, (s) => { state.live = s; renderSession(); });
  // Zusätzlich regelmäßig abfragen: liefert Tageshoch/-tief und überbrückt Live-Ausfälle.
  pollTimer = setInterval(() => { if (!document.hidden) { loadQuotes(); loadExtended(); } renderSession(); }, key ? POLL_MS : 20_000);
  newsTimer = setInterval(() => { if (!document.hidden) loadNews(); }, NEWS_POLL_MS);
}

function stop() {
  stopLive && stopLive();
  clearInterval(pollTimer); clearInterval(newsTimer);
}

// ---------- Navigation & Einstellungen ----------
function show(view, tab = view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === tab));
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => { show(b.dataset.view); if (b.dataset.view === 'portfolio') fillPortfolioForm(); }));
$('#btn-settings').addEventListener('click', () => { show('settings'); renderDiag(); renderAlarms(); });

// ---------- Preisalarme ----------
const ALARM_TEXT = {
  above: (a) => `SOXL über ${usd(a.value)}`,
  below: (a) => `SOXL unter ${usd(a.value)}`,
  move: (a) => `SOXL ±${a.value.toLocaleString('de-DE')} % zum Vortag`,
  depotBelow: (a) => `Depot unter ${eur(a.value)}`,
  depotAbove: (a) => `Depot über ${eur(a.value)}`,
};

async function renderAlarms() {
  const support = pushSupport();
  const info = $('#alarm-info');
  $('#alarm-enable').hidden = true; $('#alarm-ui').hidden = true;
  if (support === 'ios-install') { info.textContent = 'Auf dem iPhone gehen Alarme nur in der installierten App: Safari, Teilen-Symbol, „Zum Home-Bildschirm“. Dann die App über das Symbol öffnen.'; return; }
  if (support !== 'ok') { info.textContent = 'Dieses Gerät oder dieser Browser unterstützt keine Push-Nachrichten.'; return; }
  if (permission() === 'denied') { info.textContent = 'Benachrichtigungen sind für diese App gesperrt. Du kannst sie in den Einstellungen deines Handys wieder erlauben.'; return; }
  if (permission() !== 'granted') { info.textContent = 'Du bekommst automatisch eine Nachricht, wenn der SOXL sich um 10 % oder mehr zum Vortag bewegt. Dafür musst du einmal erlauben, dass die App dir Nachrichten schicken darf.'; $('#alarm-enable').hidden = false; return; }
  info.textContent = '';
  $('#alarm-ui').hidden = false;
  try {
    await enablePush({ ask: false });
    const alarms = await listAlarms();
    info.textContent = alarms.some((a) => a.type === 'move')
      ? 'Aktiv: Du bekommst automatisch eine Nachricht, wenn der SOXL sich deutlich zum Vortag bewegt. Weitere Alarme kannst du hier anlegen.'
      : 'Benachrichtigungen sind erlaubt. Leg hier deine Alarme an.';
    $('#alarm-list').innerHTML = alarms.length ? alarms.map((a) => `<li><div class="left">${esc(ALARM_TEXT[a.type]?.(a) || a.type)}</div>
      <button class="del" data-id="${esc(a.id)}">Löschen</button></li>`).join('') : '<li class="empty">Noch keine Alarme.</li>';
  } catch (e) { $('#alarm-status').textContent = 'Server nicht erreichbar: ' + e.message; }
}

$('#alarm-enable').addEventListener('click', async () => {
  try { await enablePush(); } catch (e) { $('#alarm-info').textContent = e.message; return; }
  renderAlarms();
});
$('#alarm-type').addEventListener('change', () => {
  const t = $('#alarm-type').value;
  $('#alarm-value').placeholder = t === 'move' ? 'z. B. 5' : t.startsWith('depot') ? 'z. B. 120000' : 'z. B. 170';
});
$('#alarm-add').addEventListener('click', async () => {
  const type = $('#alarm-type').value;
  const value = parseFloat(String($('#alarm-value').value).replace(',', '.'));
  const status = $('#alarm-status');
  if (!(value > 0)) { status.textContent = 'Bitte einen Wert eingeben.'; return; }
  const alarm = { type, value };
  if (type.startsWith('depot')) {
    alarm.shares = getPortfolio().shares;
    if (!alarm.shares) { status.textContent = 'Trag zuerst unter „Portfolio“ deine Stückzahl ein.'; return; }
  }
  try { await addAlarm(alarm); status.textContent = 'Alarm angelegt.'; $('#alarm-value').value = ''; renderAlarms(); }
  catch (e) { status.textContent = 'Das hat nicht geklappt: ' + e.message; }
});
$('#alarm-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button.del');
  if (!btn) return;
  try { await deleteAlarm(btn.dataset.id); renderAlarms(); } catch (err) { $('#alarm-status').textContent = err.message; }
});
$('#alarm-test').addEventListener('click', async () => {
  $('#alarm-status').textContent = 'Sende …';
  try { await sendTest(); $('#alarm-status').textContent = 'Gesendet. Die Nachricht sollte gleich erscheinen.'; }
  catch (e) { $('#alarm-status').textContent = 'Senden fehlgeschlagen: ' + e.message; }
});

// Zeigt, welcher Schlüssel gespeichert ist und was Finnhub zuletzt geantwortet hat.
function renderDiag() {
  const key = getApiKey();
  const masked = key ? `${key.slice(0, 4)}…${key.slice(-3)} (${key.length} Zeichen)` : 'keiner';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const last = lastFinnhub.ok == null ? 'noch keine Abfrage'
    : `${lastFinnhub.ok ? '✓' : '✗'} ${lastFinnhub.message} (${timeDe(lastFinnhub.time)} Uhr)`;
  $('#diag').innerHTML = `Gespeicherter Schlüssel: <b>${esc(masked)}</b><br>
    Letzte Abfrage: ${esc(last)}<br>
    Geöffnet als: ${standalone ? 'installierte App' : 'Browser-Seite'} · Version ${VERSION}`;
}

$('#btn-save-key').addEventListener('click', async () => {
  const key = $('#api-key').value.trim();
  if (!key) return;
  $('#key-status').textContent = 'Prüfe Schlüssel …';
  try {
    await createFinnhub(key).quote(MAIN_SYMBOL);
  } catch (e) {
    // Nur ablehnen, wenn Finnhub den Schlüssel ausdrücklich nicht kennt.
    if (e.status === 401 || e.status === 403) { $('#key-status').textContent = 'Das hat nicht geklappt: ' + e.message; return; }
  }
  setApiKey(key);
  $('#key-status').textContent = getApiKey() === key ? 'Gespeichert. Echte Kurse werden geladen.' : 'Speichern hat nicht geklappt: Der Browser lässt keine Daten ablegen (privater Modus?).';
  start(); show('markt');
});
$('#btn-clear-key').addEventListener('click', () => {
  setApiKey(''); $('#key-status').textContent = 'Schlüssel gelöscht.'; start();
});

// Beim Zurückkehren in die App sofort aktualisieren.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadQuotes(); loadExtended(); renderSession(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

renderSession();
renderHoldings();
restoreApiKey().then(start);
window.addEventListener('hashchange', () => { if (/key=/.test(location.hash)) restoreApiKey().then(start); });
