// Beispieldaten, solange kein Finnhub-Schlüssel eingetragen ist.
// Die Zahlen sind erfunden und nur zur Ansicht.
import { HOLDINGS, MAIN_SYMBOL } from './config.js';

const base = { SOXL: 42.15, AMD: 168.4, NVDA: 182.9, MU: 141.2, AVGO: 338.5, INTC: 36.8,
  MRVL: 88.1, TSM: 291.7, AMAT: 214.3, LRCX: 142.6, KLAC: 1012.4 };

function fakeQuote(symbol, i) {
  const pc = base[symbol] ?? 100;
  const pct = Math.sin(i * 1.7 + 0.4) * (symbol === MAIN_SYMBOL ? 4.2 : 1.6);
  const price = +(pc * (1 + pct / 100)).toFixed(2);
  return { symbol, price, change: +(price - pc).toFixed(2), changePct: +pct.toFixed(2),
    high: +(Math.max(price, pc) * 1.01).toFixed(2), low: +(Math.min(price, pc) * 0.99).toFixed(2),
    open: pc, prevClose: pc, time: Date.now() };
}

export const demo = {
  async quote(symbol) {
    const i = [MAIN_SYMBOL, ...HOLDINGS.map((h) => h.symbol)].indexOf(symbol);
    return fakeQuote(symbol, i);
  },
  async news() {
    const now = Date.now();
    return [
      { title: 'Beispiel: Chipwerte legen nach starken Zahlen zu', summary: 'Beispieltext: Halbleiteraktien stiegen am Dienstag deutlich, nachdem mehrere Hersteller ihre Prognosen angehoben hatten.', source: 'Beispiel', symbol: 'NVDA', time: now - 36e5, url: '#' },
      { title: 'Beispiel: Halbleiter-Index schwankt vor Inflationsdaten', source: 'Beispiel', symbol: 'SOXL', time: now - 3 * 36e5, url: '#' },
      { title: 'Beispiel: TSMC meldet höheren Monatsumsatz', source: 'Beispiel', symbol: 'TSM', time: now - 8 * 36e5, url: '#' },
    ];
  },
  async earnings() {
    const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    return [{ date: d(6), symbol: 'TSM', hour: 'bmo' }, { date: d(13), symbol: 'AMD', hour: 'amc' }];
  },
  async holdings() { throw new Error('Beispieldaten'); },
  async candles() {
    let c = 40; const out = [];
    for (let i = 20; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5); if (d.getDay() === 0 || d.getDay() === 6) continue;
      const o = c, ch = Math.sin(i * 1.3) * 2.2; c = +(o + ch).toFixed(2);
      out.push({ t: d.getTime(), o, c, h: Math.max(o, c) + 0.8, l: Math.min(o, c) - 0.8 });
    }
    return out;
  },
  live() { return () => {}; },
};
