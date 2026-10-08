// Preisalarme: Geräte melden sich mit ihrem Push-Abo an und legen Alarme an. Ein Durable
// Object speichert alles; jede Minute (Cron) werden die Alarme gegen den aktuellen Kurs
// geprüft und bei Treffern Push-Nachrichten verschickt.
//
// Die Push-Nachrichten sind leer; der Service Worker der App holt den Text danach über
// /push/inbox ab. So entfällt die Verschlüsselung des Inhalts.

import { crossToday } from '../js/trend.js';

const FINNHUB = 'https://finnhub.io/api/v1';
const REPORT_URL = 'https://jochen19xx.github.io/soxl-app/reports/latest.json';
const SUBJECT = 'https://jochen19xx.github.io/soxl-app/';
const QUIET_FROM = 23, QUIET_TO = 7; // Ruhezeit (deutsche Zeit)

// ---------- kleine Helfer ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (s) => new TextEncoder().encode(s);
const fmtUsd = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
const fmtEur = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
const fmtPct = (n) => (n > 0 ? '+' : '') + n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';

function zoned(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, date: `${parts.year}-${parts.month}-${parts.day}`, minutes: +parts.hour * 60 + +parts.minute, hour: +parts.hour };
}

export function usSession(now = new Date()) {
  const ny = zoned(now, 'America/New_York');
  if (ny.weekday === 'Sat' || ny.weekday === 'Sun') return { session: 'closed', day: ny.date };
  const m = ny.minutes;
  const session = m >= 240 && m < 570 ? 'pre' : m >= 570 && m < 960 ? 'regular' : m >= 960 && m < 1200 ? 'post' : 'closed';
  return { session, day: ny.date };
}

export function isQuiet(now = new Date()) {
  const h = zoned(now, 'Europe/Berlin').hour;
  return h >= QUIET_FROM || h < QUIET_TO;
}

// ---------- Web Push (VAPID) ----------
async function vapidKeys(storage) {
  let keys = await storage.get('vapid');
  if (!keys) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    keys = {
      privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
      publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    };
    await storage.put('vapid', keys);
  }
  return keys;
}

export async function vapidHeader(keys, endpoint, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function sendPush(keys, subscription) {
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(keys, subscription.endpoint), TTL: '3600', Urgency: 'high', 'Content-Length': '0' },
  });
  return res.status;
}

// ---------- Kurs für die Prüfung ----------
async function soxlPrice(env, session) {
  // Finnhub: regulärer Kurs und Vortagesschluss.
  const q = await (await fetch(`${FINNHUB}/quote?symbol=SOXL&token=${env.FINNHUB_KEY}`)).json();
  if (session === 'regular') return { price: q.c, base: q.pc, label: '' };
  // Außerhalb der Handelszeit: Yahoo mit Vor-/Nachbörse.
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SOXL?interval=1m&range=1d&includePrePost=true',
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  const res0 = (await r.json()).chart?.result?.[0];
  const closes = res0?.indicators?.quote?.[0]?.close || [];
  let i = closes.length - 1;
  while (i >= 0 && closes[i] == null) i--;
  const price = i >= 0 ? closes[i] : q.c;
  // Vorbörse: Vergleich mit dem letzten Schluss; Nachbörse: mit dem Schluss vom Vortag.
  const base = session === 'pre' ? (res0?.meta?.regularMarketPrice ?? q.c) : q.pc;
  return { price, base, label: session === 'pre' ? ' (Vorbörse)' : ' (Nachbörse)' };
}

async function eurRate(storage) {
  const cached = await storage.get('fx');
  if (cached && Date.now() - cached.time < 6 * 3600e3) return cached.rate;
  try {
    const r = await (await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR')).json();
    await storage.put('fx', { rate: r.rates.EUR, time: Date.now() });
    return r.rates.EUR;
  } catch { return cached?.rate ?? null; }
}

// Tageskerzen der letzten Monate (Yahoo), für die Trendwende.
export async function dailyCandles(symbol, range = '6mo') {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  const res0 = (await r.json()).chart?.result?.[0];
  const q = res0?.indicators?.quote?.[0] || {};
  return (res0?.timestamp || []).map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] }))
    .filter((k) => k.o != null && k.c != null && k.h != null && k.l != null);
}

// ---------- Alarmlogik (rein, gut testbar) ----------
// Gibt die Nachrichten zurück und verändert die Alarme (löschen bzw. Zustand fortschreiben).
export function evaluate(alarms, { price, base, label, day, rate }) {
  const messages = [];
  const keep = [];
  const pct = base ? (price / base - 1) * 100 : 0;
  const now = `jetzt ${fmtUsd(price)}${label}`;
  for (const a of alarms) {
    let fired = null, remove = false;
    if (a.type === 'above' && price >= a.value) { fired = `SOXL über ${fmtUsd(a.value)}: ${now}`; remove = true; }
    else if (a.type === 'below' && price <= a.value) { fired = `SOXL unter ${fmtUsd(a.value)}: ${now}`; remove = true; }
    else if (a.type === 'move' && base) {
      if (a.day !== day) { a.day = day; a.up = 0; a.down = 0; }
      const up = Math.floor(pct / a.value), down = Math.floor(-pct / a.value);
      if (up > (a.up || 0)) { a.up = up; fired = `SOXL ${fmtPct(pct)} zum Vortag · ${fmtUsd(price)}${label}`; }
      else if (down > (a.down || 0)) { a.down = down; fired = `SOXL ${fmtPct(pct)} zum Vortag · ${fmtUsd(price)}${label}`; }
    } else if ((a.type === 'depotBelow' || a.type === 'depotAbove') && rate && a.shares) {
      const value = a.shares * price * rate;
      if (a.type === 'depotBelow' && value <= a.value) { fired = `Dein Depot ist unter ${fmtEur(a.value)} gefallen: ${fmtEur(value)}${label}`; remove = true; }
      if (a.type === 'depotAbove' && value >= a.value) { fired = `Dein Depot ist über ${fmtEur(a.value)} gestiegen: ${fmtEur(value)}${label}`; remove = true; }
    }
    if (fired) messages.push({ alarmId: a.id, title: 'SOXL-Alarm', body: fired, time: Date.now() });
    if (!remove) keep.push(a);
  }
  return { messages, alarms: keep };
}

// ---------- Durable Object ----------
const TYPES = new Set(['above', 'below', 'move', 'depotBelow', 'depotAbove']);
// Weitere Nachrichten, pro Gerät abschaltbar; neue Geräte haben beide an.
const DEFAULT_PREFS = { trend: true, report: true };
const prefsOf = (dev) => ({ ...DEFAULT_PREFS, ...(dev.prefs || {}) });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export class AlarmStore {
  constructor(ctx, env) { this.storage = ctx.storage; this.env = env; }

  async device(id) { return id && /^[A-Za-z0-9-]{16,64}$/.test(id) ? this.storage.get('dev:' + id) : null; }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const id = body.id || url.searchParams.get('id');

    if (path === '/push/key') return json({ publicKey: (await vapidKeys(this.storage)).publicKey });

    if (path === '/push/device' && request.method === 'POST') {
      if (!/^[A-Za-z0-9-]{16,64}$/.test(id || '') || !body.subscription?.endpoint?.startsWith('https://')) return json({ error: 'Ungültig' }, 400);
      // Neues Gerät: automatischer Alarm bei ±10 % zum Vortag (Jochens Wunsch).
      const dev = (await this.device(id)) || { alarms: [{ id: 'auto10', type: 'move', value: 10, created: Date.now() }], inbox: [] };
      dev.subscription = { endpoint: body.subscription.endpoint };
      await this.storage.put('dev:' + id, dev);
      await this.storage.put('ep:' + body.subscription.endpoint, id);
      return json({ ok: true });
    }

    if (path === '/push/inbox') {
      // Vom Service Worker: Nachrichten zum Push-Abo abholen (und leeren).
      const ep = url.searchParams.get('endpoint');
      const devId = ep ? await this.storage.get('ep:' + ep) : id;
      const dev = await this.device(devId);
      if (!dev) return json({ messages: [] });
      const messages = dev.inbox || [];
      dev.inbox = [];
      await this.storage.put('dev:' + devId, dev);
      return json({ messages });
    }

    const dev = await this.device(id);
    if (!dev) return json({ error: 'Gerät unbekannt' }, 404);

    if (path === '/push/alarms' && request.method === 'GET') return json({ alarms: dev.alarms });

    if (path === '/push/prefs' && request.method === 'GET') return json({ prefs: prefsOf(dev) });

    if (path === '/push/prefs' && request.method === 'POST') {
      const p = prefsOf(dev);
      for (const k of Object.keys(DEFAULT_PREFS)) if (typeof body.prefs?.[k] === 'boolean') p[k] = body.prefs[k];
      dev.prefs = p;
      await this.storage.put('dev:' + id, dev);
      return json({ prefs: p });
    }

    if (path === '/push/alarms' && request.method === 'POST') {
      const a = body.alarm || {};
      const value = Number(a.value);
      if (!TYPES.has(a.type) || !(value > 0) || dev.alarms.length >= 30) return json({ error: 'Ungültiger Alarm' }, 400);
      const alarm = { id: crypto.randomUUID().slice(0, 8), type: a.type, value, created: Date.now() };
      if (a.type.startsWith('depot')) { alarm.shares = Number(a.shares); if (!(alarm.shares > 0)) return json({ error: 'Stückzahl fehlt' }, 400); }
      dev.alarms.push(alarm);
      await this.storage.put('dev:' + id, dev);
      return json({ alarm });
    }

    if (path === '/push/alarms' && request.method === 'DELETE') {
      dev.alarms = dev.alarms.filter((a) => a.id !== url.searchParams.get('alarmId'));
      await this.storage.put('dev:' + id, dev);
      return json({ ok: true });
    }

    if (path === '/push/test' && request.method === 'POST') {
      dev.inbox = [...(dev.inbox || []), { title: 'SOXL-Alarm', body: 'Testnachricht: Deine Alarme sind eingerichtet.', time: Date.now() }].slice(-10);
      await this.storage.put('dev:' + id, dev);
      const status = await sendPush(await vapidKeys(this.storage), dev.subscription);
      return json({ status }, status < 300 ? 200 : 502);
    }

    if (path === '/cron') return json(await this.check());

    return json({ error: 'Nicht gefunden' }, 404);
  }

  async check(now = new Date()) {
    if (isQuiet(now)) return { skipped: 'Ruhezeit' };
    const extra = {};
    try { extra.report = await this.checkReport(now); } catch (e) { extra.report = { error: e.message }; }
    try { extra.trend = await this.checkTrend(now); } catch (e) { extra.trend = { error: e.message }; }
    return { ...extra, ...(await this.checkPrices(now)) };
  }

  // Nachricht an alle Geräte, die diese Art Nachricht wollen (pref: 'trend' | 'report').
  async broadcast(pref, message) {
    const keys = await vapidKeys(this.storage);
    let sent = 0;
    for (const [key, dev] of await this.storage.list({ prefix: 'dev:' })) {
      if (!dev.subscription || !prefsOf(dev)[pref]) continue;
      dev.inbox = [...(dev.inbox || []), { ...message, time: Date.now() }].slice(-10);
      const status = await sendPush(keys, dev.subscription);
      if (status === 404 || status === 410) { await this.storage.delete(key); await this.storage.delete('ep:' + dev.subscription.endpoint); continue; }
      await this.storage.put(key, dev);
      sent++;
    }
    return sent;
  }

  // Neuer Tagesbericht: morgens alle 5 Minuten nachsehen, ob latest.json einen neuen Tag hat.
  async checkReport(now) {
    const h = zoned(now, 'Europe/Berlin').hour;
    if (h < 7 || h >= 12 || now.getUTCMinutes() % 5) return { skipped: true };
    const r = await fetch(`${REPORT_URL}?t=${now.getTime()}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return { status: r.status };
    const rep = await r.json();
    const known = await this.storage.get('reportDay');
    if (!rep.trading_day || rep.trading_day === known) return { day: known };
    await this.storage.put('reportDay', rep.trading_day);
    if (!known) return { day: rep.trading_day, first: true }; // erster Lauf: nur merken
    const pct = typeof rep.change_pct === 'number' ? ` (${fmtPct(rep.change_pct)})` : '';
    const sent = await this.broadcast('report', { title: 'Neuer Tagesbericht', body: `${rep.headline}${pct}`, url: './#bericht' });
    return { day: rep.trading_day, sent };
  }

  // Trendwende: einmal pro Handelstag nach US-Börsenschluss (16:15 New Yorker Zeit) prüfen,
  // ob der 20-Tage-Schnitt den 50-Tage-Schnitt gekreuzt hat.
  async checkTrend(now) {
    const ny = zoned(now, 'America/New_York');
    if (ny.weekday === 'Sat' || ny.weekday === 'Sun' || ny.minutes < 975) return { skipped: true };
    if ((await this.storage.get('trendDay')) === ny.date) return { done: ny.date };
    const daily = await dailyCandles('SOXL');
    await this.storage.put('trendDay', ny.date);
    const last = daily.at(-1);
    if (!last || zoned(new Date(last.t), 'America/New_York').date !== ny.date) return { holiday: ny.date };
    const dir = crossToday(daily.map((k) => k.c));
    if (!dir) return { day: ny.date, cross: null };
    const body = dir === 'up'
      ? `Trendwende nach oben: Der 20-Tage-Schnitt hat den 50-Tage-Schnitt von unten gekreuzt. Schluss ${fmtUsd(last.c)}.`
      : `Trendwende nach unten: Der 20-Tage-Schnitt hat den 50-Tage-Schnitt von oben gekreuzt. Schluss ${fmtUsd(last.c)}.`;
    const sent = await this.broadcast('trend', { title: dir === 'up' ? 'SOXL: Aufwärtstrend' : 'SOXL: Abwärtstrend', body });
    return { day: ny.date, cross: dir, sent };
  }

  async checkPrices(now) {
    const { session, day } = usSession(now);
    if (session === 'closed') return { skipped: 'Börse zu' };
    const devices = await this.storage.list({ prefix: 'dev:' });
    const active = [...devices].filter(([, d]) => d.alarms?.length);
    if (!active.length) return { skipped: 'Keine Alarme' };

    const quote = await soxlPrice(this.env, session);
    if (!quote.price) return { skipped: 'Kein Kurs' };
    const rate = await eurRate(this.storage);
    const keys = await vapidKeys(this.storage);
    let sent = 0;
    for (const [key, dev] of active) {
      const { messages, alarms } = evaluate(dev.alarms, { ...quote, day, rate });
      dev.alarms = alarms;
      if (messages.length) {
        dev.inbox = [...(dev.inbox || []), ...messages].slice(-10);
        const status = await sendPush(keys, dev.subscription);
        if (status === 404 || status === 410) { await this.storage.delete(key); await this.storage.delete('ep:' + dev.subscription.endpoint); continue; }
        sent += messages.length;
      }
      await this.storage.put(key, dev);
    }
    return { session, price: quote.price, sent };
  }
}
