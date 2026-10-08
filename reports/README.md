# Tagesberichte

- `latest.json`: der neueste Bericht (zeigt die App im Reiter „Bericht“)
- `JJJJ-MM-TT.json`: Archiv, ein Bericht pro Handelstag
- `index.json`: Liste aller Berichte, neueste zuerst
- `data/market.json`: Marktdaten des letzten Handelstags (von der GitHub Action „Marktdaten für Tagesbericht“)

Format eines Berichts:

```json
{
  "trading_day": "2026-10-07",
  "created": "2026-10-08T05:02:00Z",
  "headline": "SOXL fällt 3,3 % – Chipwerte unter Druck",
  "close": 158.91,
  "change_pct": -3.26,
  "paragraphs": ["…", "…"],
  "drivers": ["…", "…", "…"],
  "outlook": "…",
  "sources": [{ "title": "…", "url": "https://…" }]
}
```
