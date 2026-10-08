// Kerzenchart (Tages-, Wochen- oder Monatskerzen) als SVG, ohne Bibliothek.
const W = 360, H = 210, RIGHT = 46, BOTTOM = 20, TOP = 8;

const num = (n, d = 2) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const dayLong = (t) => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
// Beschriftung je Kerzenart: unten an der Achse und oben in der Info-Zeile.
const AXIS = {
  '1d': (t) => day(t),
  '1wk': (t) => new Date(t).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }),
  '1mo': (t) => String(new Date(t).getFullYear()),
};
const INFO = {
  '1d': dayLong,
  '1wk': (t) => 'Woche ab ' + new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }),
  '1mo': (t) => new Date(t).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
};

function niceStep(range, count) {
  const raw = range / count, pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

// lines: optionale Linien über den Kerzen, z. B. [{ cls: 'ma20', values: [...] }] (je Kerze ein Wert oder null).
export function renderCandles(svg, info, candles, lines = [], interval = '1d') {
  if (!candles.length) { svg.innerHTML = ''; return; }
  const plotW = W - RIGHT, plotH = H - BOTTOM - TOP;
  const drawn = lines.filter((ln) => ln.draw !== false); // draw: false = nur in der Info-Zeile
  const extra = drawn.flatMap((ln) => ln.values.filter((v) => v != null));
  const lo = Math.min(...candles.map((k) => k.l), ...extra), hi = Math.max(...candles.map((k) => k.h), ...extra);
  const pad = (hi - lo) * 0.06 || 1;
  const min = lo - pad, max = hi + pad;
  const y = (v) => TOP + (max - v) / (max - min) * plotH;
  const slot = plotW / candles.length, bodyW = Math.max(1, slot * 0.62);
  const asLine = candles.length > 120; // zu viele Kerzen: als Linie zeichnen
  const x = (i) => slot * i + slot / 2;

  let out = '';
  const step = niceStep(max - min, 4);
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    out += `<line class="grid" x1="0" x2="${plotW}" y1="${y(v)}" y2="${y(v)}"/>`;
    out += `<text class="axis" x="${plotW + 6}" y="${y(v) + 4}">${num(v, step < 1 ? 2 : 0)}</text>`;
  }
  // Etwa vier bis fünf Datumsangaben, gleichmäßig verteilt.
  const lastI = candles.length - 1, every = Math.max(1, Math.ceil(lastI / 4));
  const label = AXIS[interval] || day;
  candles.forEach((k, i) => {
    if ((i % every === 0 && lastI - i >= every / 2) || i === lastI) {
      const anchor = i === 0 ? 'start' : i === lastI ? 'end' : 'middle';
      const xx = i === 0 ? x(i) - slot / 2 : i === lastI ? x(i) + slot / 2 : x(i);
      out += `<text class="axis" x="${xx}" y="${H - 5}" text-anchor="${anchor}">${label(k.t)}</text>`;
    }
  });
  if (asLine) out += `<polyline class="closeline" points="${candles.map((k, i) => `${x(i).toFixed(1)},${y(k.c).toFixed(1)}`).join(' ')}"/>`;
  candles.forEach((k, i) => {
    const up = k.c >= k.o, top = y(Math.max(k.o, k.c)), h = Math.max(1, Math.abs(y(k.o) - y(k.c)));
    out += `<g class="candle ${up ? 'up' : 'down'}" data-i="${i}">
      <rect class="hit" x="${slot * i}" y="0" width="${slot}" height="${H - BOTTOM}"/>`
      + (asLine ? '' : `<line x1="${x(i)}" x2="${x(i)}" y1="${y(k.h)}" y2="${y(k.l)}"/>
      <rect x="${x(i) - bodyW / 2}" y="${top}" width="${bodyW}" height="${h}" rx="${bodyW > 3 ? 1 : 0}"/>`) + '</g>';
  });
  for (const ln of drawn) {
    const pts = ln.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
    if (pts.length > 1) out += `<polyline class="maline ${ln.cls}" points="${pts.join(' ')}"/>`;
  }
  const last = candles.at(-1);
  out += `<line class="lastline" x1="0" x2="${plotW}" y1="${y(last.c)}" y2="${y(last.c)}"/>`;
  out += `<rect class="lastbox" x="${plotW + 1}" y="${y(last.c) - 9}" width="${RIGHT - 2}" height="18" rx="4"/>`;
  out += `<text class="lastlabel" x="${plotW + RIGHT / 2}" y="${y(last.c) + 4}" text-anchor="middle">${num(last.c)}</text>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = out;

  const showInfo = (i) => {
    const k = candles[i], prev = candles[i - 1];
    const chg = prev ? (k.c / prev.c - 1) * 100 : null;
    info.innerHTML = `<b>${(INFO[interval] || dayLong)(k.t)}</b> · Eröffnung ${num(k.o)} · Hoch ${num(k.h)} · Tief ${num(k.l)} · Schluss <b>${num(k.c)}</b>`
      + (chg != null ? ` <span class="${chg >= 0 ? 'up' : 'down'}">(${chg > 0 ? '+' : ''}${num(chg, 1)} %)</span>` : '')
      + lines.filter((ln) => ln.values[i] != null).map((ln) => ` · <span class="${ln.cls}">${ln.label} ${num(ln.values[i], ln.digits ?? 2)}</span>`).join('');
    svg.querySelectorAll('.candle').forEach((g) => g.classList.toggle('sel', +g.dataset.i === i));
  };
  svg.onclick = (e) => { const g = e.target.closest('.candle'); if (g) showInfo(+g.dataset.i); };
  showInfo(candles.length - 1);
}

// RSI unter dem Chart, gleiche Breite und Kerzenraster wie oben.
export function renderRsi(svg, values) {
  const h = 74, top = 6, bottom = 6, plotW = W - RIGHT, plotH = h - top - bottom;
  const y = (v) => top + (100 - v) / 100 * plotH;
  const slot = plotW / values.length, x = (i) => slot * i + slot / 2;
  let out = `<rect class="rsizone" x="0" y="${y(70)}" width="${plotW}" height="${y(30) - y(70)}"/>`;
  for (const lv of [30, 70]) {
    out += `<line class="rsilevel" x1="0" x2="${plotW}" y1="${y(lv)}" y2="${y(lv)}"/>`;
    out += `<text class="axis" x="${plotW + 6}" y="${y(lv) + 4}">${lv}</text>`;
  }
  const pts = values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
  if (pts.length > 1) out += `<polyline class="rsiline" points="${pts.join(' ')}"/>`;
  out += `<text class="axis rsi-label" x="${plotW + 6}" y="${top + 8}">RSI</text>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
  svg.innerHTML = out;
}
