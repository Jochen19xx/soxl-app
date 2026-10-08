// Feste Einstellungen der App. Hier stehen KEINE Schlüssel:
// der Finnhub-Schlüssel wird vom Nutzer in den Einstellungen eingegeben
// und nur auf dem Gerät gespeichert (localStorage).

export const MAIN_SYMBOL = 'SOXL';

// Adresse des eigenen Servers (Cloudflare Worker, siehe server/). Ist sie gesetzt, braucht
// die App keinen Schlüssel mehr; ein auf dem Gerät eingetragener Schlüssel hat Vorrang.
export const SERVER_URL = 'https://aktiengurus.veith-jochen.workers.dev';

// Rückfall-Liste der Top-10, falls der Server die aktuelle Liste von Direxion nicht liefern
// kann (Stand 07.10.2026, Anteil am Fondsvermögen laut Direxion).
export const HOLDINGS_ASOF = '07.10.2026';
export const HOLDINGS = [
  { symbol: 'AMD',  name: 'Advanced Micro Devices', weight: 6.5 },
  { symbol: 'INTC', name: 'Intel',                  weight: 5.9 },
  { symbol: 'MU',   name: 'Micron Technology',      weight: 5.2 },
  { symbol: 'NVDA', name: 'NVIDIA',                 weight: 5.1 },
  { symbol: 'AVGO', name: 'Broadcom',               weight: 4.8 },
  { symbol: 'MRVL', name: 'Marvell Technology',     weight: 3.2 },
  { symbol: 'ADI',  name: 'Analog Devices',         weight: 2.7 },
  { symbol: 'AMAT', name: 'Applied Materials',      weight: 2.7 },
  { symbol: 'KLAC', name: 'KLA',                    weight: 2.7 },
  { symbol: 'TXN',  name: 'Texas Instruments',      weight: 2.7 },
];

// Weitere Werte im Reiter „Markt“ (oben auswählbar, mit + erweiterbar). Kurse kommen über
// den eigenen Server von Yahoo. VVSM: VanEck Semiconductor UCITS ETF an Xetra, in Euro.
export const DEFAULT_WATCH = [
  { symbol: 'VVSM.DE', label: 'VVSM', name: 'VanEck Semiconductor UCITS ETF', isin: 'IE00BMC38736' },
];

// Top 10 des VVSM laut Factsheet von VanEck (Stand 30.09.2026). Yahoo-Kürzel für die Kurse.
export const EXTRA_HOLDINGS = {
  'VVSM.DE': {
    asOf: '30.09.2026', source: 'VanEck-Factsheet',
    list: [
      { symbol: 'AMD',       label: 'AMD',  name: 'Advanced Micro Devices', weight: 10.99 },
      { symbol: 'TSM',       label: 'TSM',  name: 'Taiwan Semiconductor',   weight: 9.98 },
      { symbol: 'MU',        label: 'MU',   name: 'Micron Technology',      weight: 9.88 },
      { symbol: 'NVDA',      label: 'NVDA', name: 'NVIDIA',                 weight: 9.73 },
      { symbol: 'AVGO',      label: 'AVGO', name: 'Broadcom',               weight: 9.18 },
      { symbol: '000660.KS', label: 'SK Hynix', name: 'SK Hynix (Seoul)',   weight: 8.83 },
      { symbol: 'ASML',      label: 'ASML', name: 'ASML',                   weight: 8.41 },
      { symbol: 'INTC',      label: 'INTC', name: 'Intel',                  weight: 6.74 },
      { symbol: 'LRCX',      label: 'LRCX', name: 'Lam Research',           weight: 4.41 },
      { symbol: 'AMAT',      label: 'AMAT', name: 'Applied Materials',      weight: 4.41 },
    ],
  },
};

// Weitere Chipfirmen, deren Quartalszahlen den ganzen Sektor bewegen (nur für die Termine).
export const EARNINGS_EXTRA = [
  { symbol: 'TSM',  name: 'Taiwan Semiconductor' },
  { symbol: 'ASML', name: 'ASML' },
  { symbol: 'QCOM', name: 'Qualcomm' },
  { symbol: 'TXN',  name: 'Texas Instruments' },
  { symbol: 'ARM',  name: 'Arm Holdings' },
];

// Für diese Werte werden Firmen-News geladen (zusätzlich zu SOXL selbst).
export const NEWS_SYMBOLS = ['SOXL', 'NVDA', 'AMD', 'AVGO', 'MU', 'TSM'];

// Wie oft Kurse ohne Live-Verbindung neu geladen werden (ms).
export const POLL_MS = 60_000;
export const NEWS_POLL_MS = 60_000; // Chart, RSI, News usw. jede Minute neu

// Der Schlüssel wird dreifach gespeichert (localStorage, IndexedDB, Cookie), weil Browser
// einzelne Speicher gelegentlich leeren. Fehlt er an einer Stelle, wird er aus den anderen
// wiederhergestellt.
const KEY_STORAGE = 'soxl.finnhubKey';
const COOKIE = 'soxl_key';

function readCookie() {
  const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function writeCookie(key) {
  const age = key ? 60 * 60 * 24 * 400 : 0;
  document.cookie = `${COOKIE}=${encodeURIComponent(key)}; max-age=${age}; path=/; SameSite=Strict; Secure`;
}

function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('soxl', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve('');
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req.result || '');
        tx.onerror = () => resolve('');
      };
    } catch { resolve(''); }
  });
}

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || readCookie(); } catch { return readCookie(); }
}

export function setApiKey(key) {
  try { key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE); } catch {}
  try { writeCookie(key); } catch {}
  idb('readwrite', (st) => (key ? st.put(key, KEY_STORAGE) : st.delete(KEY_STORAGE)));
}

// Beim Start: Schlüssel aus einem Link übernehmen (…/#key=ABC) oder aus IndexedDB
// zurückholen, falls localStorage geleert wurde. Danach den Browser bitten, nichts zu löschen.
export async function restoreApiKey() {
  const m = location.hash.match(/key=([^&]+)/);
  if (m) {
    setApiKey(decodeURIComponent(m[1]).trim());
    history.replaceState(null, '', location.pathname + location.search);
  }
  let key = getApiKey();
  if (!key) key = await idb('readonly', (st) => st.get(KEY_STORAGE));
  if (key) setApiKey(key); // in allen drei Speichern auffrischen
  try { await navigator.storage?.persist?.(); } catch {}
  return key;
}

// Platz für spätere Funktionen (Portfolio, Alarme). Alles bleibt lokal auf dem Gerät.
const STATE_STORAGE = 'soxl.state';
export function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_STORAGE)) || {}; } catch { return {}; }
}
export function saveState(state) {
  try { localStorage.setItem(STATE_STORAGE, JSON.stringify(state)); } catch {}
}
