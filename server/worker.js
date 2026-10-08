// Eigener Mini-Server für die App (Cloudflare Worker, kostenloser Tarif).
// Hält den Finnhub-Schlüssel geheim: Die App fragt hier, der Server hängt den Schlüssel an.
// Später kommen hier Tagesbericht und Push-Alarme dazu.
//
// Geheimnis im Worker: FINNHUB_KEY (wird per GitHub Actions oder im Cloudflare-Dashboard gesetzt).

const FINNHUB = 'https://finnhub.io/api/v1';
const ALLOWED_PATHS = new Set(['/quote', '/company-news', '/calendar/earnings']);
const ALLOWED_ORIGINS = ['https://jochen19xx.github.io', 'http://localhost'];
// Wie lange Antworten zwischengespeichert werden (Sekunden), damit mehrere Geräte
// das kostenlose Finnhub-Limit nicht sprengen.
const CACHE_SECONDS = { '/quote': 10, '/company-news': 300, '/calendar/earnings': 3600 };

function cors(origin) {
  const ok = ALLOWED_ORIGINS.some((o) => origin === o || origin?.startsWith(o + ':'));
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

// Live-Kurse: Verbindung der App wird an Finnhubs WebSocket durchgereicht.
async function proxyWebSocket(env) {
  const upstreamRes = await fetch(`https://ws.finnhub.io/?token=${env.FINNHUB_KEY}`, { headers: { Upgrade: 'websocket' } });
  const upstream = upstreamRes.webSocket;
  if (!upstream) return new Response('Upstream failed', { status: 502 });
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
    if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') return proxyWebSocket(env);
    return new Response('Werk 2 Aktiengurus Server läuft.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
