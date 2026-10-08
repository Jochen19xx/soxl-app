# Datenquellen für die SOXL-App

Stand: 08.10.2026

## Empfehlung: Finnhub (kostenloser Tarif)

| Was die App braucht | Quelle | Kostenlos? |
|---|---|---|
| SOXL-Kurs in Echtzeit | Finnhub (Kursabfrage + Live-Verbindung) | Ja |
| Kurse der Top-10-Aktien | Finnhub | Ja |
| Vorbörse / Nachbörse | Finnhub Live-Verbindung | Ja, laut Erfahrungsberichten aber lückenhaft. Wird mit echtem Schlüssel geprüft. |
| News | Finnhub Firmen-News (SOXL, NVDA, AMD, AVGO, MU, TSM) | Ja |
| Quartalszahlen-Termine | Finnhub Earnings-Kalender | Ja |
| Fed- und Inflationstermine | Offizielle Terminpläne von Fed und US-Statistikamt (BLS), fest hinterlegt | Ja (Finnhubs Wirtschaftskalender kostet Geld) |
| Euro-Kurs | Frankfurter (EZB-Referenzkurs), kein Schlüssel nötig | Ja |
| Top-10-Liste mit Gewichten | Direxion veröffentlicht sie täglich; vorerst fest in der App | Ja |

Kostenloses Limit bei Finnhub: 60 Abfragen pro Minute. Die App braucht beim Start etwa 18 und danach rund 11 pro Minute.

## Warum nicht die anderen?

- **Alpha Vantage:** nur noch 25 Abfragen pro Tag. Reicht nicht einmal für einen Ladevorgang.
- **Polygon (jetzt Massive):** kostenlos nur 15 Minuten verzögert und 5 Abfragen pro Minute.
- **Twelve Data:** kostenlos 8 Abfragen pro Minute, Vor-/Nachbörse nur im Bezahltarif.
- **Yahoo Finance (inoffiziell):** keine offizielle Schnittstelle, bricht regelmäßig.

## Was du besorgen musst

1. Auf https://finnhub.io/register kostenlos registrieren (E-Mail genügt).
2. Im Dashboard den **API Key** kopieren.
3. In der App auf das Zahnrad tippen, Schlüssel einfügen, Speichern.

Der Schlüssel bleibt nur auf deinem Gerät und steht nirgends im Code.

## Später

Für Tagesbericht und Push-Alarme braucht die App einen kleinen eigenen Server, der auch läuft, wenn das Handy aus ist. Dann wandert der Schlüssel dorthin. In der App muss dafür nur `js/api.js` angepasst werden.
