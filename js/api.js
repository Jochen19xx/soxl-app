// Datenzugriff. Finnhub liefert Kurse, Live-Trades und News, Frankfurter (EZB) den Euro-Kurs.
// Später soll ein kleiner eigener Server dazwischen, damit Schlüssel, Tagesbericht und
// Push-Alarme nicht im Browser liegen müssen. Die App spricht nur mit diesen Funktionen,
// daher muss beim Umstieg nur diese Datei geändert werden.

const FINNHUB = 'https://finnhub.io/api/v1';
const FINNHUB_WS = 'wss://ws.finnhub.io';
const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR';

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) throw new ApiError('Schlüssel ungültig oder Funktion nicht im kostenlosen Tarif', res.status);
  if (res.status === 429) throw new ApiError('Zu viele Abfragen, kurz warten', res.status);
  if (!res.ok) throw new ApiError(`Fehler ${res.status}`, res.status);
  return res.json();
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const isoDate = (d) => d.toISOString().slice(0, 10);

export function createFinnhub(token) {
  const q = (path, params = {}) => {
    const qs = new URLSearchParams({ ...params, token });
    return getJson(`${FINNHUB}${path}?${qs}`);
  };

  return {
    // { price, change, changePct, high, low, open, prevClose, time }
    async quote(symbol) {
      const r = await q('/quote', { symbol });
      if (!r || (r.c === 0 && r.pc === 0)) throw new ApiError(`Kein Kurs für ${symbol}`);
      return {
        symbol, price: r.c, change: r.d, changePct: r.dp,
        high: r.h, low: r.l, open: r.o, prevClose: r.pc,
        time: r.t ? r.t * 1000 : Date.now(),
      };
    },

    async news(symbols, days = 3) {
      const to = new Date();
      const from = new Date(Date.now() - days * 864e5);
      const lists = await Promise.allSettled(
        symbols.map((symbol) => q('/company-news', { symbol, from: isoDate(from), to: isoDate(to) })
          .then((items) => items.map((n) => ({ ...n, symbol }))))
      );
      const seen = new Set();
      return lists
        .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        .filter((n) => n.headline && !seen.has(n.url) && seen.add(n.url))
        .map((n) => ({
          title: n.headline, url: n.url, source: n.source,
          time: n.datetime * 1000, symbol: n.symbol, summary: n.summary,
        }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 50);
    },

    // Quartalszahlen-Termine der nächsten Tage (für die Termin-Vorschau), je Firma abgefragt.
    async earnings(symbols, days = 28) {
      const from = isoDate(new Date());
      const to = isoDate(new Date(Date.now() + days * 864e5));
      const lists = await Promise.allSettled(symbols.map((symbol) => q('/calendar/earnings', { from, to, symbol })));
      const seen = new Set();
      return lists
        .flatMap((r) => (r.status === 'fulfilled' ? r.value.earningsCalendar || [] : []))
        .filter((e) => symbols.includes(e.symbol) && !seen.has(e.symbol + e.date) && seen.add(e.symbol + e.date))
        .map((e) => ({ date: e.date, symbol: e.symbol, hour: e.hour }));
    },

    // Live-Trades per WebSocket. onTrade(symbol, price, timeMs). Verbindet sich bei Abbruch neu.
    live(symbols, onTrade, onState = () => {}) {
      let ws, closed = false, retry = 1000, watchdog;
      const resetWatchdog = () => {
        clearTimeout(watchdog);
        // Finnhub trennt manchmal still; ohne Daten für 2 Minuten neu verbinden.
        watchdog = setTimeout(() => ws && ws.close(), 120_000);
      };
      const connect = () => {
        ws = new WebSocket(`${FINNHUB_WS}?token=${encodeURIComponent(token)}`);
        ws.onopen = () => {
          retry = 1000; onState('live'); resetWatchdog();
          symbols.forEach((s) => ws.send(JSON.stringify({ type: 'subscribe', symbol: s })));
        };
        ws.onmessage = (ev) => {
          resetWatchdog();
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;
          // Pro Symbol nur den letzten Trade der Nachricht verwenden.
          const last = {};
          for (const t of msg.data) if (!last[t.s] || t.t >= last[t.s].t) last[t.s] = t;
          Object.values(last).forEach((t) => onTrade(t.s, t.p, t.t));
        };
        ws.onclose = () => {
          clearTimeout(watchdog);
          onState('offline');
          if (!closed) { setTimeout(connect, retry); retry = Math.min(retry * 2, 60_000); }
        };
        ws.onerror = () => ws.close();
      };
      connect();
      return () => { closed = true; clearTimeout(watchdog); ws && ws.close(); };
    },
  };
}

// USD -> EUR (EZB-Referenzkurs, einmal pro Werktag aktualisiert, kein Schlüssel nötig).
export async function usdToEur() {
  const r = await getJson(FX_URL);
  return { rate: r.rates.EUR, date: r.date };
}
