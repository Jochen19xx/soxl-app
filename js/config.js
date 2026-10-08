// Feste Einstellungen der App. Hier stehen KEINE Schlüssel:
// der Finnhub-Schlüssel wird vom Nutzer in den Einstellungen eingegeben
// und nur auf dem Gerät gespeichert (localStorage).

export const MAIN_SYMBOL = 'SOXL';

// Top-10-Positionen des SOXL (geschätzte Gewichte, Stand 06.10.2026, Quelle: chartrow.com
// auf Basis der N-PORT-Meldung vom 31.07.2026). Direxion veröffentlicht die genaue Liste
// täglich; ein automatisches Update kommt mit dem Server-Teil.
export const HOLDINGS_ASOF = '06.10.2026';
export const HOLDINGS = [
  { symbol: 'AMD',  name: 'Advanced Micro Devices',  weight: 9.8 },
  { symbol: 'NVDA', name: 'NVIDIA',                  weight: 8.8 },
  { symbol: 'MU',   name: 'Micron Technology',       weight: 8.4 },
  { symbol: 'AVGO', name: 'Broadcom',                weight: 6.6 },
  { symbol: 'INTC', name: 'Intel',                   weight: 5.5 },
  { symbol: 'MRVL', name: 'Marvell Technology',      weight: 5.5 },
  { symbol: 'TSM',  name: 'Taiwan Semiconductor',    weight: 4.7 },
  { symbol: 'AMAT', name: 'Applied Materials',       weight: 4.6 },
  { symbol: 'LRCX', name: 'Lam Research',            weight: 4.1 },
  { symbol: 'KLAC', name: 'KLA',                     weight: 4.0 },
];

// Für diese Werte werden Firmen-News geladen (zusätzlich zu SOXL selbst).
export const NEWS_SYMBOLS = ['SOXL', 'NVDA', 'AMD', 'AVGO', 'MU', 'TSM'];

// Wie oft Kurse ohne Live-Verbindung neu geladen werden (ms).
export const POLL_MS = 60_000;
export const NEWS_POLL_MS = 10 * 60_000;

const KEY_STORAGE = 'soxl.finnhubKey';
export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
export function setApiKey(key) {
  try { key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE); } catch {}
}

// Platz für spätere Funktionen (Portfolio, Alarme). Alles bleibt lokal auf dem Gerät.
const STATE_STORAGE = 'soxl.state';
export function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_STORAGE)) || {}; } catch { return {}; }
}
export function saveState(state) {
  try { localStorage.setItem(STATE_STORAGE, JSON.stringify(state)); } catch {}
}
