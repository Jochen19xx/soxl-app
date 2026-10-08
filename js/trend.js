// Trend aus gleitenden Durchschnitten (20 und 50 Handelstage).
// Wird von der App und vom Server (Trendwende-Warnung) benutzt.

export const SHORT = 20, LONG = 50;

// Gleitender Durchschnitt; null, solange zu wenige Werte da sind.
export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  });
  return out;
}

// Ampel: 'up' (Kurs über beiden Schnitten), 'down' (unter beiden), 'mixed' (dazwischen).
// candles: [{t, c}] aufsteigend; price: aktueller Kurs (sonst letzter Schluss).
export function trend(candles, price) {
  const closes = candles.map((k) => k.c);
  const s = sma(closes, SHORT), l = sma(closes, LONG);
  const last = closes.length - 1;
  if (last < LONG - 1) return null;
  const p = price ?? closes[last];
  const short = s[last], long = l[last];
  const state = p > short && p > long ? 'up' : p < short && p < long ? 'down' : 'mixed';
  // Letztes Kreuzen der beiden Schnitte suchen.
  let cross = null;
  for (let i = last; i > LONG - 1; i--) {
    const now = Math.sign(s[i] - l[i]), before = Math.sign(s[i - 1] - l[i - 1]);
    if (now && before && now !== before) { cross = { t: candles[i].t, dir: now > 0 ? 'up' : 'down' }; break; }
  }
  return { state, price: p, short, long, cross, shortLine: s, longLine: l };
}

// Hat der 20-Tage-Schnitt am letzten Tag den 50-Tage-Schnitt gekreuzt? 'up' | 'down' | null
export function crossToday(closes) {
  const s = sma(closes, SHORT), l = sma(closes, LONG), i = closes.length - 1;
  if (i < LONG) return null;
  const now = Math.sign(s[i] - l[i]), before = Math.sign(s[i - 1] - l[i - 1]);
  return now && before && now !== before ? (now > 0 ? 'up' : 'down') : null;
}
