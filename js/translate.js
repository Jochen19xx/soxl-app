// Übersetzung ins Deutsche ohne Schlüssel. Zuerst der Google-Übersetzer-Dienst, den auch
// Browser-Erweiterungen nutzen; fällt der aus, MyMemory (kostenlos, begrenzte Menge pro Tag).
// Fertige Übersetzungen werden auf dem Gerät gespeichert, damit nichts doppelt übersetzt wird.

const STORE = 'soxl.translations';
const MAX_CACHED = 400;
let cache;
try { cache = new Map(JSON.parse(localStorage.getItem(STORE)) || []); } catch { cache = new Map(); }

function persist() {
  try { localStorage.setItem(STORE, JSON.stringify([...cache].slice(-MAX_CACHED))); } catch {}
}

async function google(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=de&dt=t&q=' + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error('google ' + res.status);
  const data = await res.json();
  return data[0].map((seg) => seg[0]).join('');
}

async function myMemory(text) {
  const url = 'https://api.mymemory.translated.net/get?langpair=en|de&q=' + encodeURIComponent(text.slice(0, 500));
  const res = await fetch(url);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error('mymemory');
  return data.responseData.translatedText;
}

async function translateOne(text) {
  try { return await google(text); } catch { return myMemory(text); }
}

// Übersetzt mehrere Texte. Was nicht klappt, bleibt im Original.
export async function toGerman(texts) {
  const todo = [...new Set(texts.filter((t) => t && !cache.has(t)))];
  // Mehrere Überschriften in einer Anfrage, durch Zeilenumbrüche getrennt.
  const batches = [];
  let cur = [];
  for (const t of todo) {
    if (cur.length && (cur.join('\n').length + t.length > 1500)) { batches.push(cur); cur = []; }
    cur.push(t.replace(/\s*\n\s*/g, ' '));
  }
  if (cur.length) batches.push(cur);

  await Promise.allSettled(batches.map(async (batch) => {
    try {
      const out = (await google(batch.join('\n'))).split('\n');
      if (out.length !== batch.length) throw new Error('mismatch');
      batch.forEach((t, i) => cache.set(t, out[i].trim()));
    } catch {
      for (const t of batch) { try { cache.set(t, await translateOne(t)); } catch {} }
    }
  }));
  persist();
  return texts.map((t) => cache.get(t) || t);
}

export function cachedGerman(text) { return cache.get(text) || null; }
