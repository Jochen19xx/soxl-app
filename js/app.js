import { MAIN_SYMBOL, HOLDINGS, HOLDINGS_ASOF, EARNINGS_EXTRA, NEWS_SYMBOLS, POLL_MS, NEWS_POLL_MS, getApiKey, setApiKey, restoreApiKey } from './config.js';
import { createFinnhub, usdToEur } from './api.js';
import { demo } from './demo.js';
import { upcomingEvents } from './events.js';
import { toGerman, cachedGerman } from './translate.js';

const $ = (sel) => document.querySelector(sel);
const SYMBOLS = [MAIN_SYMBOL, ...HOLDINGS.map((h) => h.symbol)];

const state = {
  quotes: {},      // symbol -> quote
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
function renderMain(flash = false) {
  const q = state.quotes[MAIN_SYMBOL];
  if (!q) return;
  $('#soxl-price').textContent = usd(q.price);
  const ch = $('#soxl-change');
  ch.textContent = `${signed(q.change)} (${pct(q.changePct)})`;
  ch.className = 'hero-change ' + dir(q.change);
  $('#soxl-eur').textContent = state.eur ? `≈ ${eur(q.price * state.eur.rate)}` : '';
  $('#soxl-pc').textContent = usd(q.prevClose);
  $('#soxl-l').textContent = usd(q.low);
  $('#soxl-h').textContent = usd(q.high);
  $('#soxl-updated').textContent = `Stand ${timeDe(q.time)} Uhr`;
  if (flash) { const p = $('#soxl-price'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); }
}

function renderHoldings() {
  $('#holdings').innerHTML = HOLDINGS.map((h) => {
    const q = state.quotes[h.symbol];
    return `<li data-sym="${h.symbol}">
      <div class="left"><div class="sym">${h.symbol}</div><div class="name">${esc(h.name)}</div></div>
      <div class="weight">${h.weight.toLocaleString('de-DE', { minimumFractionDigits: 1 })} %</div>
      <div class="right">
        <div class="price">${q ? usd(q.price) : '–'}</div>
        <div class="chg ${q ? dir(q.change) : ''}">${q ? pct(q.changePct) : ''}</div>
      </div></li>`;
  }).join('');
  $('#holdings-asof').textContent = `Gewichte geschätzt, Stand ${HOLDINGS_ASOF}.`;
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
  const names = Object.fromEntries([...HOLDINGS, ...EARNINGS_EXTRA].map((h) => [h.symbol, h.name]));
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

async function loadNews() {
  try { renderNews(await api.news(NEWS_SYMBOLS)); }
  catch (e) { $('#news').innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
}

async function loadEarnings() {
  renderEvents([]); // feste Termine sofort zeigen, Quartalszahlen kommen dazu
  try { renderEvents(await api.earnings([...HOLDINGS, ...EARNINGS_EXTRA].map((h) => h.symbol))); } catch { /* feste Termine bleiben */ }
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

function start() {
  stop();
  const key = getApiKey();
  api = key ? createFinnhub(key) : demo;
  $('#demo-banner').hidden = !!key;
  $('#api-key').value = key;
  loadQuotes(); loadNews(); loadEarnings(); loadFx();
  stopLive = api.live(SYMBOLS, onTrade, (s) => { state.live = s; renderSession(); });
  // Zusätzlich regelmäßig abfragen: liefert Tageshoch/-tief und überbrückt Live-Ausfälle.
  pollTimer = setInterval(() => { if (!document.hidden) loadQuotes(); renderSession(); }, POLL_MS);
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
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
$('#btn-settings').addEventListener('click', () => show('settings'));

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
  $('#key-status').textContent = 'Gespeichert. Echte Kurse werden geladen.';
  start(); show('markt');
});
$('#btn-clear-key').addEventListener('click', () => {
  setApiKey(''); $('#key-status').textContent = 'Schlüssel gelöscht.'; start();
});

// Beim Zurückkehren in die App sofort aktualisieren.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadQuotes(); renderSession(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

renderSession();
renderHoldings();
restoreApiKey().then(start);
window.addEventListener('hashchange', () => { if (/key=/.test(location.hash)) restoreApiKey().then(start); });
