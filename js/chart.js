// Kerzenchart (Tageskerzen) als SVG, ohne Bibliothek.
const W = 360, H = 210, RIGHT = 46, BOTTOM = 20, TOP = 8;

const num = (n, d = 2) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const dayLong = (t) => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

function niceStep(range, count) {
  const raw = range / count, pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

// lines: optionale Linien über den Kerzen, z. B. [{ cls: 'ma20', values: [...] }] (je Kerze ein Wert oder null).
export function renderCandles(svg, info, candles, lines = []) {
  if (!candles.length) { svg.innerHTML = ''; return; }
  const plotW = W - RIGHT, plotH = H - BOTTOM - TOP;
  const extra = lines.flatMap((ln) => ln.values.filter((v) => v != null));
  const lo = Math.min(...candles.map((k) => k.l), ...extra), hi = Math.max(...candles.map((k) => k.h), ...extra);
  const pad = (hi - lo) * 0.06 || 1;
  const min = lo - pad, max = hi + pad;
  const y = (v) => TOP + (max - v) / (max - min) * plotH;
  const slot = plotW / candles.length, bodyW = Math.max(3, slot * 0.62);
  const x = (i) => slot * i + slot / 2;

  let out = '';
  const step = niceStep(max - min, 4);
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    out += `<line class="grid" x1="0" x2="${plotW}" y1="${y(v)}" y2="${y(v)}"/>`;
    out += `<text class="axis" x="${plotW + 6}" y="${y(v) + 4}">${num(v, step < 1 ? 2 : 0)}</text>`;
  }
  candles.forEach((k, i) => {
    const lastI = candles.length - 1;
    if (i % 5 === 0 || i === lastI) {
      const anchor = i === 0 ? 'start' : i === lastI ? 'end' : 'middle';
      const xx = i === 0 ? x(i) - slot / 2 : i === lastI ? x(i) + slot / 2 : x(i);
      out += `<text class="axis" x="${xx}" y="${H - 5}" text-anchor="${anchor}">${day(k.t)}</text>`;
    }
  });
  candles.forEach((k, i) => {
    const up = k.c >= k.o, top = y(Math.max(k.o, k.c)), h = Math.max(1, Math.abs(y(k.o) - y(k.c)));
    out += `<g class="candle ${up ? 'up' : 'down'}" data-i="${i}">
      <rect class="hit" x="${slot * i}" y="0" width="${slot}" height="${H - BOTTOM}"/>
      <line x1="${x(i)}" x2="${x(i)}" y1="${y(k.h)}" y2="${y(k.l)}"/>
      <rect x="${x(i) - bodyW / 2}" y="${top}" width="${bodyW}" height="${h}" rx="1"/></g>`;
  });
  for (const ln of lines) {
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
    info.innerHTML = `<b>${dayLong(k.t)}</b> · Eröffnung ${num(k.o)} · Hoch ${num(k.h)} · Tief ${num(k.l)} · Schluss <b>${num(k.c)}</b>`
      + (chg != null ? ` <span class="${chg >= 0 ? 'up' : 'down'}">(${chg > 0 ? '+' : ''}${num(chg, 1)} %)</span>` : '')
      + lines.filter((ln) => ln.values[i] != null).map((ln) => ` · <span class="${ln.cls}">${ln.label} ${num(ln.values[i])}</span>`).join('');
    svg.querySelectorAll('.candle').forEach((g) => g.classList.toggle('sel', +g.dataset.i === i));
  };
  svg.onclick = (e) => { const g = e.target.closest('.candle'); if (g) showInfo(+g.dataset.i); };
  showInfo(candles.length - 1);
}
