import { SERVER_URL, MAIN_SYMBOL, HOLDINGS, HOLDINGS_ASOF, EARNINGS_EXTRA, NEWS_SYMBOLS, POLL_MS, NEWS_POLL_MS, DEFAULT_WATCH, EXTRA_HOLDINGS, getApiKey, setApiKey, restoreApiKey, loadState, saveState } from './config.js';
import { createFinnhub, usdToEur, lastFinnhub } from './api.js';

const VERSION = '2026-10-08.24';
import { demo } from './demo.js';
import { upcomingEvents } from './events.js';
import { getPortfolio, setPortfolio, portfolioFigures, getPositions, setPositions, positionFigures } from './portfolio.js';
import { renderCandles, renderRsi } from './chart.js';
import { trend, rsiZone } from './trend.js';
import { pushSupport, permission, enablePush, listAlarms, addAlarm, deleteAlarm, sendTest, getPrefs, setPrefs } from './alarms.js';
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
  yq: {},          // symbol -> Kurs über Yahoo (weitere Werte wie VVSM und deren Top 10)
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
// Betrag in der Währung des Werts (SOXL in Dollar, VVSM in Euro, SK Hynix in Won …).
const money$ = (n, c = 'USD') => n == null ? '–' : c === 'USD' ? usd(n) : c === 'EUR' ? eur(n)
  : n.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' ' + c;

// ---------- Weitere Werte im Reiter Markt (SOXL, VVSM, + …) ----------
let watch = (() => { const w = loadState().watch; return Array.isArray(w) ? w : DEFAULT_WATCH; })();
let sel = (() => { const s = loadState().sel; return watch.some((w) => w.symbol === s) ? s : MAIN_SYMBOL; })();
function saveWatch() { const st = loadState(); st.watch = watch; st.sel = sel; saveState(st); }
const isMain = () => sel === MAIN_SYMBOL;
const labelOf = (sym) => sym === MAIN_SYMBOL ? MAIN_SYMBOL : (watch.find((w) => w.symbol === sym)?.label || sym.replace(/\.[A-Z]+$/, ''));
function yview(sym) {
  const q = state.yq[sym];
  return q && { price: q.price, base: q.prevClose, change: q.change, changePct: q.changePct, time: q.time, q };
}

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
  const el = $('#session');
  if (!isMain()) {
    const q = state.yq[sel], s = q?.session || 'closed';
    el.textContent = (q?.exchange ? q.exchange + ' · ' : '') + SESSION_LABEL[s === 'open' ? 'open' : s];
    el.className = 'badge ' + (s === 'open' ? 'open' : s === 'pre' || s === 'post' ? 'ext' : '');
    return;
  }
  const s = marketSession();
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

const MAIN_LABEL = '<b>SOXL</b> · Direxion Daily Semiconductor Bull 3X';
function renderMain(flash = false) {
  renderChips();
  if (!isMain()) { renderOther(); renderTrend(); return; }
  $('#hero-label').innerHTML = MAIN_LABEL;
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
  renderTrend();
}

// Kopf für einen weiteren Wert (z. B. VVSM in Euro an Xetra).
function renderOther() {
  const w = watch.find((x) => x.symbol === sel), v = yview(sel), q = v?.q;
  $('#hero-label').innerHTML = `<b>${esc(labelOf(sel))}</b> · ${esc(w?.name || q?.name || '')}${w?.isin ? ` (${esc(w.isin)})` : ''}`;
  $('#mini-pf').hidden = true;
  $('#soxl-ext').hidden = true;
  $('#soxl-pc-label').textContent = 'Vortag';
  if (!v) {
    for (const id of ['#soxl-price', '#soxl-pc', '#soxl-l', '#soxl-h']) $(id).textContent = '–';
    $('#soxl-change').textContent = 'Kurs wird geladen …'; $('#soxl-change').className = 'hero-change';
    $('#soxl-eur').textContent = ''; $('#soxl-updated').textContent = '';
    return;
  }
  const c = q.currency || 'USD';
  $('#soxl-price').textContent = money$(v.price, c);
  $('#soxl-change').textContent = `${signed(v.change)} (${pct(v.changePct)})`;
  $('#soxl-change').className = 'hero-change ' + dir(v.change);
  $('#soxl-eur').textContent = c === 'USD' && state.eur ? `≈ ${eur(v.price * state.eur.rate)}` : '';
  $('#soxl-pc').textContent = money$(v.base, c);
  $('#soxl-l').textContent = money$(q.low, c);
  $('#soxl-h').textContent = money$(q.high, c);
  $('#soxl-updated').textContent = `Stand ${timeDe(v.time)} Uhr${q.exchange ? ' · ' + q.exchange : ''}`;
}

function renderChips() {
  const items = [{ symbol: MAIN_SYMBOL }, ...watch];
  $('#chips').innerHTML = items.map((w) => {
    const v = w.symbol === MAIN_SYMBOL ? view(MAIN_SYMBOL) : yview(w.symbol);
    return `<button class="chip${w.symbol === sel ? ' active' : ''}" data-sym="${esc(w.symbol)}" role="tab">${esc(labelOf(w.symbol))}
      <small class="${v ? dir(v.change) : ''}">${v ? pct(v.changePct) : '–'}</small></button>`;
  }).join('') + '<button class="chip add" id="chip-add" aria-label="Wert hinzufügen">+</button>';
}

function select(sym) {
  if (sym === sel) return;
  sel = sym; saveWatch();
  dailyCandles = [];
  $('#chart').innerHTML = ''; $('#rsi-chart').innerHTML = ''; $('#chart-info').textContent = 'Lade Kerzen …';
  $('#trend').hidden = true;
  renderMain(); renderHoldings(); renderSession();
  loadChart(); loadOther();
}

$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'chip-add') { const card = $('#add-card'); card.hidden = !card.hidden; if (!card.hidden) { renderMine(); $('#add-q').focus(); } return; }
  select(b.dataset.sym);
});

// Hinzufügen per Suche (Name, Kürzel oder ISIN) und Entfernen eigener Werte.
let searchTimer, searchResults = [];
$('#add-q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('#add-q').value.trim();
  if (q.length < 2) { $('#add-results').innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    try {
      searchResults = await api.search(q);
      if ($('#add-q').value.trim() !== q) return;
      $('#add-results').innerHTML = searchResults.length ? searchResults.map((r, i) => `<li data-i="${i}">
        <div class="left"><div class="sym">${esc(r.symbol)}</div><div class="name">${esc(r.name)} · ${esc(r.exchange || '')}</div></div>
        <span class="addbtn">+</span></li>`).join('') : '<li class="empty">Nichts gefunden.</li>';
    } catch (e) { $('#add-results').innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
  }, 350);
});
$('#add-results').addEventListener('click', (e) => {
  const r = searchResults[+e.target.closest('li[data-i]')?.dataset.i];
  if (!r) return;
  if (!watch.some((w) => w.symbol === r.symbol) && r.symbol !== MAIN_SYMBOL) {
    watch.push({ symbol: r.symbol, label: r.symbol.replace(/\.[A-Z]+$/, ''), name: r.name });
    saveWatch();
  }
  $('#add-q').value = ''; $('#add-results').innerHTML = ''; $('#add-card').hidden = true;
  select(r.symbol); renderChips();
});
function renderMine() {
  $('#add-mine').innerHTML = watch.length ? watch.map((w) => `<li><div class="left"><div class="sym">${esc(w.label || w.symbol)}</div>
    <div class="name">${esc(w.name || '')}</div></div><button class="del" data-sym="${esc(w.symbol)}">Entfernen</button></li>`).join('')
    : '<li class="empty">Nur SOXL. Such oben nach weiteren Werten.</li>';
}
$('#add-mine').addEventListener('click', (e) => {
  const b = e.target.closest('button.del');
  if (!b) return;
  watch = watch.filter((w) => w.symbol !== b.dataset.sym);
  if (sel === b.dataset.sym) { sel = '__'; select(MAIN_SYMBOL); }
  saveWatch(); renderMine(); renderChips();
});
$('#add-close').addEventListener('click', () => { $('#add-card').hidden = true; });

// ---------- Portfolio ----------
const money = (usdVal, eurVal) => eurVal != null ? eur(eurVal) : usd(usdVal);
const signedMoney = (usdVal, eurVal) => ((eurVal ?? usdVal) > 0 ? '+' : '') + money(usdVal, eurVal);

function renderPortfolio() {
  const p = getPortfolio();
  const v = view(MAIN_SYMBOL);
  const f = portfolioFigures(p, v && { price: v.price, prevClose: v.base }, state.eur?.rate);
  $('#pf-summary').hidden = !f;
  $('#mini-pf').hidden = !f || !isMain();
  renderPositions(f);
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

// Weitere Positionen (z. B. VVSM) und Gesamtdepot in Euro.
const posLabel = (pos) => pos.label || labelOf(pos.symbol);
function renderPositions(soxl) {
  const list = getPositions();
  let totalEur = soxl?.valueEur ?? 0, dayEur = soxl?.dayEur ?? 0, plEur = soxl?.plEur ?? 0, hasPl = soxl?.plEur != null, complete = !soxl || soxl.valueEur != null;
  $('#pf-positions').innerHTML = list.map((pos, i) => {
    const q = state.yq[pos.symbol], f = positionFigures(pos, q, state.eur?.rate);
    if (!f) { complete = false; return `<div class="card pf-pos"><div class="pf-pos-head"><b>${esc(posLabel(pos))}</b><span class="hint">${pos.shares.toLocaleString('de-DE')} Anteile</span></div><p class="hint">Kurs wird geladen …</p></div>`; }
    if (f.valueEur == null) complete = false; else { totalEur += f.valueEur; dayEur += f.dayEur; }
    if (f.plEur != null) { plEur += f.plEur; hasPl = true; }
    const main = f.valueEur != null ? eur(f.valueEur) : money$(f.value, f.currency);
    return `<div class="card pf-pos">
      <div class="hero-label">Dein ${esc(posLabel(pos))}-Depot · ${pos.shares.toLocaleString('de-DE')} Anteile</div>
      <div class="pf-pos-value">${main}</div>
      ${f.currency !== 'EUR' ? `<div class="hero-eur">${money$(f.value, f.currency)}</div>` : ''}
      <div class="pf-grid">
        <div><div class="pf-label">Heute</div><div class="pf-num ${dir(f.day)}">${f.dayEur != null ? (f.dayEur > 0 ? '+' : '') + eur(f.dayEur) : signed(f.day)}<small>${pct(f.dayPct)}</small></div></div>
        ${f.plEur != null ? `<div><div class="pf-label">Gewinn / Verlust</div><div class="pf-num ${dir(f.plEur)}">${(f.plEur > 0 ? '+' : '') + eur(f.plEur)}<small>${pct(f.plPct)}</small></div></div>` : ''}
      </div>
      <div class="pf-pos-actions"><button data-edit="${i}">Bearbeiten</button><button class="del" data-del="${i}">Entfernen</button></div>
    </div>`;
  }).join('');
  // Gesamtdepot nur, wenn es mehr als eine Position gibt.
  const count = list.length + (soxl ? 1 : 0);
  $('#pf-total').hidden = count < 2;
  if (count < 2) return;
  $('#pf-total-count').textContent = `${count} Werte`;
  $('#pf-total-value').textContent = eur(totalEur) + (complete ? '' : ' *');
  $('#pf-total-day').innerHTML = `${(dayEur > 0 ? '+' : '') + eur(dayEur)}<small>${pct(totalEur - dayEur ? dayEur / (totalEur - dayEur) * 100 : 0)}</small>`;
  $('#pf-total-day').className = 'pf-num ' + dir(dayEur);
  $('#pf-total-pl-box').hidden = !hasPl;
  $('#pf-total-pl').textContent = (plEur > 0 ? '+' : '') + eur(plEur);
  $('#pf-total-pl').className = 'pf-num ' + dir(plEur);
}

function fillAddForm(pos) {
  const opts = [...watch.map((w) => ({ symbol: w.symbol, label: w.label || w.symbol, name: w.name })),
    ...getPositions().filter((p) => !watch.some((w) => w.symbol === p.symbol))];
  $('#pf-add-sym').innerHTML = opts.length ? opts.map((o) => `<option value="${esc(o.symbol)}">${esc(o.label || o.symbol)}${o.name ? ' · ' + esc(o.name) : ''}</option>`).join('')
    : '<option value="">Erst im Reiter „Markt“ mit + einen Wert hinzufügen</option>';
  $('#pf-add-sym').value = pos?.symbol || opts[0]?.symbol || '';
  $('#pf-add-shares').value = pos?.shares || '';
  $('#pf-add-cost').value = pos?.cost || '';
  $('#pf-add-cur').value = pos?.currency || 'EUR';
  $('#pf-add-status').textContent = '';
  $('#pf-add').hidden = false; $('#pf-add-open').hidden = true;
}
$('#pf-add-open').addEventListener('click', () => fillAddForm());
$('#pf-add-cancel').addEventListener('click', () => { $('#pf-add').hidden = true; $('#pf-add-open').hidden = false; });
$('#pf-add-save').addEventListener('click', () => {
  const num = (v) => parseFloat(String(v).replace(',', '.')) || 0;
  const symbol = $('#pf-add-sym').value, shares = num($('#pf-add-shares').value), cost = num($('#pf-add-cost').value);
  if (!symbol) { $('#pf-add-status').textContent = 'Bitte zuerst einen Wert wählen.'; return; }
  if (!(shares > 0) || cost < 0) { $('#pf-add-status').textContent = 'Bitte eine Anzahl größer als 0 eingeben.'; return; }
  const w = watch.find((x) => x.symbol === symbol) || getPositions().find((x) => x.symbol === symbol) || {};
  const list = getPositions().filter((p) => p.symbol !== symbol);
  list.push({ symbol, label: w.label || labelOf(symbol), name: w.name || '', shares, cost, currency: $('#pf-add-cur').value });
  setPositions(list);
  $('#pf-add').hidden = true; $('#pf-add-open').hidden = false;
  renderPortfolio(); loadOther();
});
$('#pf-positions').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const list = getPositions();
  if (b.dataset.edit != null) { fillAddForm(list[+b.dataset.edit]); $('#pf-add').scrollIntoView({ block: 'center' }); }
  if (b.dataset.del != null) { list.splice(+b.dataset.del, 1); setPositions(list); renderPortfolio(); }
});

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
  const extra = !isMain() && EXTRA_HOLDINGS[sel];
  const none = !isMain() && !extra;
  for (const id of ['#holdings-title', '#holdings', '#holdings-asof']) $(id).hidden = none;
  if (none) return;
  $('#holdings-title').textContent = `Top 10 im ${labelOf(sel)}`;
  $('#holdings').innerHTML = (extra ? extra.list : holdings).map((h) => {
    const q = extra ? yview(h.symbol) : view(h.symbol);
    const c = extra ? q?.q.currency : 'USD';
    return `<li data-sym="${esc(h.symbol)}">
      <div class="left"><div class="sym">${esc(h.label || h.symbol)}</div><div class="name">${esc(h.name)}</div></div>
      <div class="weight">${h.weight.toLocaleString('de-DE', { minimumFractionDigits: 1 })} %</div>
      <div class="right">
        <div class="price">${q ? money$(q.price, c) : '–'}</div>
        <div class="chg ${q ? dir(q.change) : ''}">${q ? pct(q.changePct) : ''}</div>
      </div></li>`;
  }).join('');
  $('#holdings-asof').textContent = extra ? `Anteil am Fondsvermögen laut ${extra.source}, Stand ${extra.asOf}.` : holdingsNote;
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
  if (failed && !state.quotes[MAIN_SYMBOL] && isMain()) $('#soxl-updated').textContent = failed.reason.message;
  renderMain(); renderHoldings();
}

// ---------- Tagesbericht (von der Claude-Routine ins Repository geschrieben) ----------
const dateDe = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

function renderReport(r) {
  const el = $('#report');
  if (!r) { el.innerHTML = '<p>Noch kein Tagesbericht vorhanden. Der erste kommt am nächsten Werktag gegen 7 Uhr.</p>'; return; }
  const list = (items) => `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  el.innerHTML = `<div class="hint">Bericht zu ${esc(dateDe(r.trading_day))}</div>
    <h3>${esc(r.headline)}</h3>
    <div class="big ${dir(r.change_pct)}">Schluss ${usd(r.close)} · ${pct(r.change_pct)}</div>
    ${(r.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('')}
    ${r.drivers?.length ? `<h4>Die wichtigsten Gründe</h4>${list(r.drivers)}` : ''}
    ${r.outlook ? `<h4>Worauf es heute ankommt</h4><p>${esc(r.outlook)}</p>` : ''}
    ${r.sources?.length ? `<h4>Quellen</h4><ul class="sources">${r.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>` : ''}
    <p class="hint">Automatisch von Claude erstellt. Keine Anlageberatung.</p>`;
}

let reportDayShown = null; // null = neuester Bericht
async function loadReport(day) {
  reportDayShown = day || null;
  try {
    const res = await fetch(`reports/${day || 'latest'}.json`, { cache: 'no-cache' });
    renderReport(res.ok ? await res.json() : null);
  } catch { renderReport(null); }
  try {
    const days = await (await fetch('reports/index.json', { cache: 'no-cache' })).json();
    $('#report-archive-title').hidden = days.length < 2;
    $('#report-archive').innerHTML = days.slice(0, 30).map((d) => `<li data-day="${esc(d.trading_day)}">
      <div class="left"><div class="sym">${esc(dateDe(d.trading_day))}</div><div class="name">${esc(d.headline || '')}</div></div>
      <div class="right chg ${dir(d.change_pct)}">${d.change_pct != null ? pct(d.change_pct) : ''}</div></li>`).join('');
  } catch {}
}
$('#report-archive').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-day]');
  if (li) { loadReport(li.dataset.day); window.scrollTo(0, 0); }
});

// Tageskerzen der letzten drei Wochen (15 Handelstage) mit 20- und 50-Tage-Schnitt.
let dailyCandles = [], chartLoadedAt = 0;
async function loadChart() {
  try {
    const sym = sel;
    const candles = await api.candles(sym);
    if (sym !== sel) return; // inzwischen anderen Wert gewählt
    dailyCandles = candles;
    chartLoadedAt = Date.now();
    const t = trend(dailyCandles), n = 15;
    const lines = t ? [{ cls: 'ma20', label: 'Ø20', values: t.shortLine.slice(-n) }, { cls: 'ma50', label: 'Ø50', values: t.longLine.slice(-n) },
      { cls: 'rsi', label: 'RSI', values: t.rsiLine.slice(-n), digits: 0, draw: false }] : [];
    renderCandles($('#chart'), $('#chart-info'), dailyCandles.slice(-n), lines);
    $('#rsi-chart').hidden = !t;
    if (t) renderRsi($('#rsi-chart'), t.rsiLine.slice(-n));
    renderTrend();
  } catch { $('#chart-info').textContent = 'Chart gerade nicht verfügbar.'; }
}

// Trend-Ampel: aktueller Kurs gegen 20- und 50-Tage-Schnitt.
const TREND_TITLE = { up: 'Aufwärtstrend', down: 'Abwärtstrend', mixed: 'Kein klarer Trend' };
function renderTrend() {
  // Während des Handels zählt der aktuelle Kurs als heutiger Schluss, so sind Ampel und RSI
  // immer auf dem Stand des letzten Kursabrufs (jede Minute) statt des letzten Chart-Abrufs.
  const v = isMain() ? view(MAIN_SYMBOL) : yview(sel), last = dailyCandles.at(-1);
  const cur = isMain() ? 'USD' : v?.q.currency || 'USD';
  const timeZone = isMain() ? 'America/New_York' : v?.q.timezone || 'Europe/Berlin';
  const exDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone });
  const open = isMain() ? marketSession() === 'open' : v?.q.session === 'open';
  const live = open && v?.price && last && exDay(last.t) === exDay(Date.now());
  const candles = live ? [...dailyCandles.slice(0, -1), { ...last, c: v.price }] : dailyCandles;
  const t = candles.length && trend(candles, v?.price);
  $('#rsi-time').textContent = `Stand ${timeDe(live ? (v.time || Date.now()) : chartLoadedAt)} Uhr`;
  const box = $('#trend');
  box.hidden = !t;
  if (!t) return;
  box.className = 'card trend ' + t.state;
  $('#trend-title').textContent = (t.state === 'mixed' ? '' : 'Achtung: ') + TREND_TITLE[t.state];
  const rel = (avg) => `${t.price >= avg ? 'über' : 'unter'} dem ${avg === t.short ? '20' : '50'}-Tage-Schnitt (${money$(avg, cur)})`;
  let text = `Der Kurs (${money$(t.price, cur)}) liegt ${rel(t.short)} und ${rel(t.long)}.`;
  if (t.cross) text += ` Letzte Trendwende am ${new Date(t.cross.t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, da hat der 20-Tage-Schnitt den 50-Tage-Schnitt nach ${t.cross.dir === 'up' ? 'oben' : 'unten'} gekreuzt.`;
  $('#trend-text').textContent = text;

  // RSI: zeigt, wie stark und einseitig sich der Kurs zuletzt bewegt hat.
  $('#trend-rsi').hidden = t.rsi == null;
  if (t.rsi == null) return;
  const zone = rsiZone(t.rsi), r = Math.round(t.rsi);
  $('#rsi-value').textContent = `${r} · ${{ over: 'überkauft', under: 'überverkauft', neutral: 'neutral' }[zone]}`;
  $('#rsi-value').className = zone;
  $('#rsi-dot').style.left = `${Math.min(100, Math.max(0, t.rsi))}%`;
  const both = {
    'up-over': 'Aufwärtstrend, aber der RSI ist über 70: Der Kurs ist zuletzt sehr schnell gestiegen. Danach kommt es oft zu einer Verschnaufpause oder einem Rücksetzer.',
    'up-under': 'Aufwärtstrend, aber der RSI ist unter 30: Der Kurs ist zuletzt stark gefallen, obwohl der Trend noch nach oben zeigt.',
    'down-under': 'Abwärtstrend, und der RSI ist unter 30: Der Kurs ist zuletzt sehr stark gefallen. Danach kommt es oft zu einer Gegenbewegung nach oben, der Trend bleibt aber abwärts.',
    'down-over': 'Abwärtstrend, aber der RSI ist über 70: Der Kurs hat sich zuletzt kräftig erholt. Ob daraus eine Trendwende wird, zeigen die Schnitte.',
  }[`${t.state}-${zone}`];
  $('#rsi-text').textContent = both || (zone === 'over' ? 'Über 70: Der Kurs ist zuletzt sehr schnell gestiegen (überkauft).'
    : zone === 'under' ? 'Unter 30: Der Kurs ist zuletzt sehr stark gefallen (überverkauft).'
    : 'Zwischen 30 und 70: Der Kurs ist weder überkauft noch überverkauft.');
}

// Vor-/Nachbörsenkurse, nur außerhalb der regulären Handelszeit.
async function loadExtended() {
  if (!api.extended || marketSession() === 'open') return;
  const results = await Promise.allSettled(SYMBOLS.map((s) => api.extended(s)));
  results.forEach((r, i) => { if (r.status === 'fulfilled' && r.value.price) state.ext[SYMBOLS[i]] = r.value; });
  renderMain(); renderHoldings();
}

// Kurse der weiteren Werte (Chips) und, falls ausgewählt, ihrer Top 10.
async function loadOther() {
  if (!api?.yquote) return;
  const syms = new Set([...watch.map((w) => w.symbol), ...getPositions().map((p) => p.symbol)]);
  if (!isMain()) EXTRA_HOLDINGS[sel]?.list.forEach((h) => syms.add(h.symbol));
  const list = [...syms];
  const res = await Promise.allSettled(list.map((s) => api.yquote(s)));
  res.forEach((r, i) => { if (r.status === 'fulfilled') state.yq[list[i]] = r.value; });
  renderMain(); renderHoldings(); renderSession(); renderPortfolio();
}

async function loadNews() {
  try { renderNews(await api.news(NEWS_SYMBOLS)); }
  catch (e) { $('#news').innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
}

let eventsShown = false;
async function loadEarnings() {
  if (!eventsShown) { renderEvents([]); eventsShown = true; } // feste Termine sofort zeigen, Quartalszahlen kommen dazu
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
  loadQuotes(); loadExtended(); loadEarnings(); loadChart(); loadOther();
  stopLive = api.live(SYMBOLS, onTrade, (s) => { state.live = s; renderSession(); });
  // Zusätzlich regelmäßig abfragen: liefert Tageshoch/-tief und überbrückt Live-Ausfälle.
  pollTimer = setInterval(() => { if (!document.hidden) { loadQuotes(); loadExtended(); loadOther(); } renderSession(); }, key ? POLL_MS : 20_000);
  // Alles andere einmal pro Minute: Chart mit Trend und RSI, News, Termine, Euro-Kurs, Top 10, Bericht.
  newsTimer = setInterval(() => {
    if (document.hidden) return;
    loadNews(); loadChart(); loadEarnings(); loadFx(); loadHoldings();
    if ($('#view-bericht').classList.contains('active') && !reportDayShown) loadReport();
  }, NEWS_POLL_MS);
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
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => { show(b.dataset.view); if (b.dataset.view === 'portfolio') fillPortfolioForm(); if (b.dataset.view === 'bericht') loadReport(); }));
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
    const prefs = await getPrefs();
    $('#pref-trend').checked = prefs.trend; $('#pref-rsi').checked = prefs.rsi !== false; $('#pref-report').checked = prefs.report;
  } catch (e) { $('#alarm-status').textContent = 'Server nicht erreichbar: ' + e.message; }
}

// Schalter für Trendwende-Warnung, RSI-Warnung und Tagesbericht.
const PREF_NAME = { trend: 'Trendwende-Warnung', rsi: 'RSI-Warnung', report: 'Nachricht zum Tagesbericht' };
for (const key of ['trend', 'rsi', 'report']) {
  $(`#pref-${key}`).addEventListener('change', async (e) => {
    const on = e.target.checked;
    try { await setPrefs({ [key]: on }); $('#alarm-status').textContent = `${PREF_NAME[key]} ${on ? 'eingeschaltet' : 'ausgeschaltet'}.`; }
    catch (err) { e.target.checked = !on; $('#alarm-status').textContent = 'Nicht gespeichert: ' + err.message; }
  });
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadQuotes(); loadExtended(); loadOther(); renderSession(); if (Date.now() - chartLoadedAt > NEWS_POLL_MS) { loadChart(); loadNews(); } } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Automatische Updates: regelmäßig nachsehen, ob es eine neuere App-Version gibt, und dann
// neu laden (nicht, solange gerade etwas eingetippt wird).
async function checkForUpdate() {
  try {
    const src = await (await fetch(`js/app.js?v=${Date.now()}`, { cache: 'no-store' })).text();
    const latest = src.match(/const VERSION = '([^']+)'/)?.[1];
    if (!latest || latest === VERSION) return;
    let tried = null;
    try { tried = sessionStorage.getItem('updateTried'); } catch {}
    if (tried === latest) return; // schon einmal versucht, nicht endlos neu laden
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (typing || document.hidden) return;
    try { sessionStorage.setItem('updateTried', latest); } catch {}
    location.reload();
  } catch { /* offline: später wieder */ }
}
setTimeout(checkForUpdate, 5000);
setInterval(() => { if (!document.hidden) checkForUpdate(); }, NEWS_POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

renderSession();
renderHoldings();
restoreApiKey().then(start);
// Aus einer Nachricht zum Tagesbericht geöffnet: gleich den Bericht zeigen.
const openFromHash = () => { if (location.hash === '#bericht') { show('bericht'); loadReport(); history.replaceState(null, '', location.pathname); } };
openFromHash();
window.addEventListener('hashchange', () => { if (/key=/.test(location.hash)) restoreApiKey().then(start); else openFromHash(); });
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.open === 'bericht') { show('bericht'); loadReport(); } });
