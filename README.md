# Werk 2 Aktiengurus

Web-App (PWA) für iPhone und Android: SOXL-Kurs in Echtzeit, Top-10-Positionen, News.
Vorgesehen, aber noch nicht gebaut: Portfolio mit Einstandskurs und Gewinn, Preisalarme, Termin-Vorschau (Fed, Inflation), täglicher Bericht.

## Starten (zum Ausprobieren am Rechner)

```
python3 -m http.server 8000
```
Dann http://localhost:8000 öffnen. Ohne Schlüssel zeigt die App Beispieldaten.

## Aufs Handy

Die App muss dafür im Internet liegen (kommt im nächsten Schritt, z. B. kostenlos über GitHub Pages). Dann:
- **iPhone:** Seite in Safari öffnen, Teilen-Symbol, „Zum Home-Bildschirm“.
- **Android:** Seite in Chrome öffnen, Menü, „App installieren“.

## Aufbau

- `index.html` – Oberfläche mit Reitern Markt, News, Portfolio, Termine, Bericht
- `js/config.js` – Top-10-Liste, Einstellungen, Speicherung auf dem Gerät
- `js/api.js` – Datenabruf (Finnhub, Euro-Kurs)
- `js/demo.js` – Beispieldaten ohne Schlüssel
- `sw.js` – macht die App installierbar und offline startfähig
- `docs/datenquellen.md` – Anbietervergleich und Empfehlung
