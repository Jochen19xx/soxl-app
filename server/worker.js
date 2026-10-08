// Eigener Mini-Server für die App (Cloudflare Worker, kostenloser Tarif).
// Hält den Finnhub-Schlüssel geheim: Die App fragt hier, der Server hängt den Schlüssel an.
// Außerdem: Preisalarme mit Push-Nachrichten (alarms.js). Später kommt der Tagesbericht dazu.
//
// Geheimnis im Worker: FINNHUB_KEY (wird per GitHub Actions oder im Cloudflare-Dashboard gesetzt).

import { AlarmStore, dailyCandles } from './alarms.js';
export { AlarmStore };

const FINNHUB = 'https://finnhub.io/api/v1';
const ALLOWED_PATHS = new Set(['/quote', '/company-news', '/calendar/earnings']);
const ALLOWED_ORIGINS = ['https://jochen19xx.github.io', 'http://localhost'];
// Wie lange Antworten zwischengespeichert werden (Sekunden), damit mehrere Geräte
// das kostenlose Finnhub-Limit nicht sprengen.
// Börsenkürzel wie SOXL, VVSM.DE, 000660.KS, BRK-B
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;
const CACHE_SECONDS = { '/quote': 10, '/company-news': 60, '/calendar/earnings': 3600 };

function cors(origin) {
  const ok = ALLOWED_ORIGINS.some((o) => origin === o || origin?.startsWith(o + ':'));
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

async function proxyFinnhub(request, env, url) {
  const path = url.pathname.replace(/^\/finnhub/, '');
  const origin = request.headers.get('Origin');
  if (!ALLOWED_PATHS.has(path)) return new Response('Not allowed', { status: 404, headers: cors(origin) });

  const params = new URLSearchParams(url.search);
  params.delete('token');
  const cacheKey = new Request(`https://cache.local${path}?${params}`);
  const cache = caches.default;
  let res = await cache.match(cacheKey);
  if (!res) {
    params.set('token', env.FINNHUB_KEY);
    const upstream = await fetch(`${FINNHUB}${path}?${params}`);
    res = new Response(upstream.body, upstream);
    res.headers.set('Cache-Control', `max-age=${CACHE_SECONDS[path] || 10}`);
    if (upstream.ok) await cache.put(cacheKey, res.clone());
  }
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors(origin))) res.headers.set(k, v);
  return res;
}

// Aktuelle Top-10-Positionen aus Direxions täglicher Bestandsliste (CSV).
const HOLDINGS_CSV = 'https://www.direxion.com/holdings/SOXL.csv';
const NOT_A_STOCK = /SWAP|CASH|TREAS|MONEY MARKET|GOVT|FUND|BILL|COLLATERAL/i;

function parseCsvLine(line) {
  const out = []; let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export function parseHoldings(csv) {
  const lines = csv.split(/\r?\n/);
  const h = lines.findIndex((l) => l.includes('StockTicker'));
  if (h < 0) throw new Error('Unbekanntes Format');
  const cols = parseCsvLine(lines[h]);
  const idx = (name) => cols.indexOf(name);
  const [iDate, iTicker, iDesc, iPct, iShares] = ['TradeDate', 'StockTicker', 'SecurityDescription', 'HoldingsPercent', 'Shares'].map(idx);
  const rows = lines.slice(h + 1).filter((l) => l.trim()).map(parseCsvLine);
  const stocks = rows
    .filter((r) => r[iTicker] && /^[A-Z.]{1,6}$/.test(r[iTicker].split(' ')[0]) && !NOT_A_STOCK.test(r[iDesc]) && Number(r[iShares]) > 0)
    .map((r) => ({ symbol: r[iTicker].split(' ')[0], name: r[iDesc], weight: Math.round(parseFloat(r[iPct]) * 10) / 10 }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);
  if (stocks.length < 5) throw new Error('Zu wenige Positionen erkannt');
  return { asOf: rows[0]?.[iDate] || '', holdings: stocks };
}

async function holdings(request) {
  const origin = request.headers.get('Origin');
  const cacheKey = new Request('https://cache.local/holdings');
  let res = await caches.default.match(cacheKey);
  if (!res) {
    try {
      const csv = await (await fetch(HOLDINGS_CSV, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
      res = new Response(JSON.stringify(parseHoldings(csv)), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' },
      });
      await caches.default.put(cacheKey, res.clone());
    } catch (e) {
      res = new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
  }
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors(origin))) res.headers.set(k, v);
  return res;
}

// Kurs inklusive Vor- und Nachbörse (Yahoo Finance, ohne Schlüssel). Finnhubs kostenloser
// Tarif liefert außerhalb der Handelszeit nur den Schlusskurs.
async function extendedQuote(request, url) {
  const origin = request.headers.get('Origin');
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return new Response('Bad symbol', { status: 400, headers: cors(origin) });
  const cacheKey = new Request(`https://cache.local/ext/${symbol}`);
  let res = await caches.default.match(cacheKey);
  if (!res) {
    let body, status = 200;
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d&includePrePost=true`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      const j = await r.json();
      const res0 = j.chart?.result?.[0];
      const ts = res0?.timestamp || [];
      const closes = res0?.indicators?.quote?.[0]?.close || [];
      let i = closes.length - 1;
      while (i >= 0 && closes[i] == null) i--;
      if (i < 0) throw new Error('Keine Daten');
      const m = res0.meta;
      const t = ts[i] * 1000;
      const p = m.currentTradingPeriod || {};
      const session = t < p.regular?.start * 1000 ? 'pre' : t >= p.regular?.end * 1000 ? 'post' : 'regular';
      body = { symbol, price: closes[i], time: t, session, regularPrice: m.regularMarketPrice, prevClose: m.chartPreviousClose ?? m.previousClose };
    } catch (e) { body = { error: e.message }; status = 502; }
    res = new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=15' } });
    if (status === 200) await caches.default.put(cacheKey, res.clone());
  }
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors(origin))) res.headers.set(k, v);
  return res;
}

// Tageskerzen der letzten Wochen (Yahoo Finance; Finnhubs Kerzen kosten Geld).
async function candles(request, url) {
  const origin = request.headers.get('Origin');
  const symbol = (url.searchParams.get('symbol') || 'SOXL').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return new Response('Bad symbol', { status: 400, headers: cors(origin) });
  // Zeiträume: 6 Monate Tageskerzen (Standard), 1 Jahr Wochenkerzen, gesamt Monatskerzen.
  const [range, interval] = { '1y': ['1y', '1wk'], max: ['max', '1mo'] }[url.searchParams.get('range')] || ['6mo', '1d'];
  const cacheKey = new Request(`https://cache.local/candles6/${symbol}/${range}`);
  let res = await caches.default.match(cacheKey);
  if (!res) {
    let body, status = 200;
    try {
      const list = await dailyCandles(symbol, range, interval); // 6 Monate Tageskerzen reichen für den 50-Tage-Schnitt
      if (!list.length) throw new Error('Keine Daten');
      body = { symbol, range, interval, candles: list };
    } catch (e) { body = { error: e.message }; status = 502; }
    res = new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${range === '6mo' ? 60 : 600}` } });
    if (status === 200) await caches.default.put(cacheKey, res.clone());
  }
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors(origin))) res.headers.set(k, v);
  return res;
}

// Antwort mit CORS und kurzem Zwischenspeicher (für die Yahoo-Endpunkte).
async function cachedJson(request, key, seconds, make) {
  const origin = request.headers.get('Origin');
  const cacheKey = new Request(`https://cache.local/${key}`);
  let res = await caches.default.match(cacheKey);
  if (!res) {
    let body, status = 200;
    try { body = await make(); } catch (e) { body = { error: e.message }; status = 502; }
    res = new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${seconds}` } });
    if (status === 200) await caches.default.put(cacheKey, res.clone());
  }
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors(origin))) res.headers.set(k, v);
  return res;
}

// Kurs eines beliebigen Werts über Yahoo (z. B. VVSM.DE an Xetra, in Euro).
async function yahooQuote(request, url) {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return new Response('Bad symbol', { status: 400, headers: cors(request.headers.get('Origin')) });
  return cachedJson(request, `yq/${symbol}`, 15, async () => {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    const res0 = (await r.json()).chart?.result?.[0];
    const m = res0?.meta;
    if (!m?.regularMarketPrice) throw new Error('Kein Kurs');
    const closes = res0.indicators?.quote?.[0]?.close || [];
    let i = closes.length - 1;
    while (i >= 0 && closes[i] == null) i--;
    const now = Date.now() / 1000, p = m.currentTradingPeriod || {};
    const within = (x) => x && now >= x.start && now < x.end;
    const session = within(p.regular) ? 'open' : within(p.pre) ? 'pre' : within(p.post) ? 'post' : 'closed';
    return {
      symbol, price: i >= 0 ? closes[i] : m.regularMarketPrice, prevClose: m.chartPreviousClose ?? m.previousClose,
      high: m.regularMarketDayHigh, low: m.regularMarketDayLow, time: (i >= 0 ? res0.timestamp[i] : m.regularMarketTime) * 1000,
      currency: m.currency, name: m.longName || m.shortName, exchange: m.fullExchangeName, timezone: m.exchangeTimezoneName, session,
    };
  });
}

// Suche nach Name, Kürzel oder ISIN (Yahoo).
async function search(request, url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  if (q.length < 2) return new Response('[]', { headers: { 'Content-Type': 'application/json', ...cors(request.headers.get('Origin')) } });
  return cachedJson(request, `search/${encodeURIComponent(q.toLowerCase())}`, 3600, async () => {
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    return ((await r.json()).quotes || [])
      .filter((x) => x.symbol && ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(x.quoteType))
      .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange, type: x.typeDisp || x.quoteType }));
  });
}

// Live-Kurse: Verbindung der App wird an Finnhubs WebSocket durchgereicht.
async function proxyWebSocket(env) {
  const upstreamRes = await fetch(`https://ws.finnhub.io/?token=${env.FINNHUB_KEY}`, { headers: { Upgrade: 'websocket' } });
  const upstream = upstreamRes.webSocket;
  if (!upstream) return new Response(`Upstream ${upstreamRes.status}: ${(await upstreamRes.text()).slice(0, 200)}`, { status: 502 });
  upstream.accept();
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.addEventListener('message', (e) => { try { upstream.send(e.data); } catch {} });
  upstream.addEventListener('message', (e) => { try { server.send(e.data); } catch {} });
  const closeBoth = () => { try { server.close(); } catch {} try { upstream.close(); } catch {} };
  server.addEventListener('close', closeBoth);
  upstream.addEventListener('close', closeBoth);
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request.headers.get('Origin')) });
    if (url.pathname.startsWith('/finnhub/')) return proxyFinnhub(request, env, url);
    if (url.pathname === '/holdings') return holdings(request);
    if (url.pathname === '/extended') return extendedQuote(request, url);
    if (url.pathname === '/candles') return candles(request, url);
    if (url.pathname === '/yquote') return yahooQuote(request, url);
    if (url.pathname === '/search') return search(request, url);
    if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') return proxyWebSocket(env);
    if (url.pathname.startsWith('/push/')) {
      const store = env.ALARMS.get(env.ALARMS.idFromName('main'));
      const res = await store.fetch(request);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors(request.headers.get('Origin')))) out.headers.set(k, v);
      return out;
    }
    return new Response('Werk 2 Aktiengurus Server läuft.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },

  // Jede Minute: Preisalarme prüfen.
  async scheduled(event, env, ctx) {
    const store = env.ALARMS.get(env.ALARMS.idFromName('main'));
    ctx.waitUntil(store.fetch('https://store/cron'));
  },
};
