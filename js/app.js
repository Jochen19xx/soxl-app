import { MAIN_SYMBOL, HOLDINGS, HOLDINGS_ASOF, NEWS_SYMBOLS, POLL_MS, NEWS_POLL_MS, getApiKey, setApiKey } from './config.js';
import { createFinnhub, usdToEur } from './api.js';
import { demo } from './demo.js';

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

function renderNews(items) {
  $('#news').innerHTML = items.length ? items.map((n) => `<li>
      <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
      <div class="meta"><span class="tag">${esc(n.symbol)}</span> · ${esc(n.source)} · ${ago(n.time)}</div>
    </li>`).join('') : '<li class="empty">Keine News gefunden.</li>';
}

function renderEarnings(items) {
  const name = Object.fromEntries(HOLDINGS.map((h) => [h.symbol, h.name]));
  const when = { bmo: 'vor Börsenstart', amc: 'nach Börsenschluss' };
  $('#events').innerHTML = items.map((e) => `<li>
      <div class="left"><div class="sym">Quartalszahlen ${e.symbol}</div><div class="name">${esc(name[e.symbol] || '')}${when[e.hour] ? ' · ' + when[e.hour] : ''}</div></div>
      <div class="right">${new Date(e.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
    </li>`).join('');
  $('#events').hidden = !items.length;
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
  try { renderEarnings(await api.earnings(HOLDINGS.map((h) => h.symbol))); } catch { renderEarnings([]); }
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
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
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
    setApiKey(key);
    $('#key-status').textContent = 'Gespeichert. Echte Kurse werden geladen.';
    start(); show('markt');
  } catch (e) {
    $('#key-status').textContent = 'Das hat nicht geklappt: ' + e.message;
  }
});
$('#btn-clear-key').addEventListener('click', () => {
  setApiKey(''); $('#key-status').textContent = 'Schlüssel gelöscht.'; start();
});

// Beim Zurückkehren in die App sofort aktualisieren.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadQuotes(); renderSession(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

renderSession();
renderHoldings();
start();
