// Einmalige Prüfung von Datenquellen (wird danach wieder entfernt).
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', Accept: '*/*' };
const show = async (label, url, n = 1500, headers = UA) => {
  try { const r = await fetch(url, { headers }); const t = await r.text(); console.log(`\n### ${label} ${r.status} ${r.headers.get('content-type')}\n${t.slice(0, n)}`); return t; }
  catch (e) { console.log(`\n### ${label} FEHLER ${e.message}`); return ''; }
};
await show('Yahoo search ISIN', 'https://query2.finance.yahoo.com/v1/finance/search?q=IE00BMC38736&quotesCount=6&newsCount=0', 2500);
await show('Yahoo search VVSM', 'https://query2.finance.yahoo.com/v1/finance/search?q=VVSM&quotesCount=6&newsCount=0', 2500);
const c = await show('Yahoo chart VVSM.DE 1d/5d', 'https://query1.finance.yahoo.com/v8/finance/chart/VVSM.DE?interval=1d&range=5d', 400);
try { console.log('META', JSON.stringify(JSON.parse(c).chart.result[0].meta)); } catch {}
const m = await show('Yahoo chart VVSM.DE 1m', 'https://query1.finance.yahoo.com/v8/finance/chart/VVSM.DE?interval=1m&range=1d', 200);
try { const r = JSON.parse(m).chart.result[0]; console.log('1m points', r.timestamp?.length, 'last', r.indicators.quote[0].close.filter(Boolean).at(-1)); } catch {}
const html = await show('VanEck SMH page', 'https://www.vaneck.com/de/de/investments/semiconductor-etf/overview/', 300);
for (const re of [/[^"'\s]*[Hh]olding[^"'\s]*/g, /blockid[^"'&\s]*[=:]\s*["']?\d+/gi, /data-[a-z-]*url="[^"]+"/g, /\/Main\/[^"'\s]+/g]) console.log(re, [...new Set(html.match(re) || [])].slice(0, 30));
const html2 = await show('VanEck SMH holdings page', 'https://www.vaneck.com/de/de/investments/semiconductor-etf/holdings/', 300);
for (const re of [/[^"'\s]*[Hh]olding[^"'\s]*/g, /blockid[^"'&\s]*[=:]\s*["']?\d+/gi, /data-[a-z-]*url="[^"]+"/g, /\/Main\/[^"'\s]+/g, /\.xlsx[^"'\s]*/g]) console.log(re, [...new Set(html2.match(re) || [])].slice(0, 30));
await show('GroMiKV csv', 'https://www.vaneck.com/ucits/equity-etf/smh-gromikv-csv/', 700);
await show('Server finnhub VVSM.DE', 'https://aktiengurus.veith-jochen.workers.dev/finnhub/quote?symbol=VVSM.DE', 300, { Origin: 'https://jochen19xx.github.io' });
await show('Server candles VVSM.DE', 'https://aktiengurus.veith-jochen.workers.dev/candles?symbol=VVSM.DE', 300, { Origin: 'https://jochen19xx.github.io' });
