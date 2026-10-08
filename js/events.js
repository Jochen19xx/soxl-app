// Termine für die Vorschau (4 Wochen). Feste Termine stammen aus den offiziellen Kalendern:
//   Fed:     federalreserve.gov/monetarypolicy/fomccalendars.htm
//   BLS:     bls.gov/schedule (Inflation CPI, Erzeugerpreise PPI, Arbeitsmarktbericht)
//   BEA:     bea.gov/news/schedule (PCE-Inflation, BIP)
//   NYSE:    nyse.com/markets/hours-calendars (Feiertage, verkürzter Handel)
// Stand 08.10.2026. BLS und BEA haben die Termine für 2027 noch nicht veröffentlicht,
// diese müssen Ende 2026 nachgetragen werden.
// Zeiten sind New Yorker Zeit; die App rechnet sie in deutsche Zeit um.

const FOMC = [ // [Datum der Entscheidung (2. Sitzungstag), mit Zinsprognosen?]
  ['2026-10-28', false], ['2026-12-09', true],
  ['2027-01-27', false], ['2027-03-17', true], ['2027-04-28', false], ['2027-06-09', true],
  ['2027-07-28', false], ['2027-09-15', true], ['2027-10-27', false], ['2027-12-08', true],
];
const CPI = [['2026-10-14', 'September'], ['2026-11-10', 'Oktober'], ['2026-12-10', 'November']];
const PPI = [['2026-10-15', 'September'], ['2026-11-13', 'Oktober'], ['2026-12-15', 'November']];
const JOBS = [['2026-11-06', 'Oktober'], ['2026-12-04', 'November']];
const PCE = [['2026-10-29', 'September'], ['2026-11-25', 'Oktober'], ['2026-12-23', 'November']];
const GDP = [['2026-10-29', '3. Quartal, erste Schätzung'], ['2026-11-25', '3. Quartal, zweite Schätzung'], ['2026-12-23', '3. Quartal, dritte Schätzung']];
const CLOSED = [
  ['2026-11-26', 'Thanksgiving'], ['2026-12-25', 'Weihnachten'],
  ['2027-01-01', 'Neujahr'], ['2027-01-18', 'Martin Luther King Day'], ['2027-02-15', 'Presidents Day'],
  ['2027-03-26', 'Karfreitag'], ['2027-05-31', 'Memorial Day'], ['2027-06-18', 'Juneteenth'],
  ['2027-07-05', 'Unabhängigkeitstag'], ['2027-09-06', 'Labor Day'], ['2027-11-25', 'Thanksgiving'],
  ['2027-12-24', 'Weihnachten'],
];
const EARLY_CLOSE = ['2026-11-27', '2026-12-24', '2027-11-26'];

// Datum + New Yorker Uhrzeit -> Date (berücksichtigt Sommer-/Winterzeit beider Länder).
export function nyTime(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const guess = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const ny = new Date(guess.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (utc - ny));
}

// Dritter Freitag eines Monats (großer Verfallstag im März, Juni, September, Dezember).
function thirdFriday(year, month) {
  const d = new Date(Date.UTC(year, month, 1));
  const first = (5 - d.getUTCDay() + 7) % 7 + 1;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(first + 14).padStart(2, '0')}`;
}

function staticEvents() {
  const ev = [];
  for (const [date, sep] of FOMC) ev.push({ date, at: nyTime(date, '14:00'), kind: 'fed',
    title: 'Fed-Zinsentscheid', detail: (sep ? 'Mit neuen Zinsprognosen, ' : '') + 'Pressekonferenz eine halbe Stunde später' });
  for (const [date, m] of CPI) ev.push({ date, at: nyTime(date, '08:30'), kind: 'macro', title: 'Inflation (CPI)', detail: `Verbraucherpreise ${m}` });
  for (const [date, m] of PPI) ev.push({ date, at: nyTime(date, '08:30'), kind: 'macro', title: 'Erzeugerpreise (PPI)', detail: `Erzeugerpreise ${m}` });
  for (const [date, m] of JOBS) ev.push({ date, at: nyTime(date, '08:30'), kind: 'macro', title: 'US-Arbeitsmarktbericht', detail: `Neue Jobs und Arbeitslosenquote ${m}` });
  for (const [date, m] of PCE) ev.push({ date, at: nyTime(date, '08:30'), kind: 'macro', title: 'PCE-Inflation', detail: `Das Inflationsmaß der Fed, ${m}` });
  for (const [date, m] of GDP) ev.push({ date, at: nyTime(date, '08:30'), kind: 'macro', title: 'US-Wirtschaftswachstum (BIP)', detail: m });
  for (const [date, name] of CLOSED) ev.push({ date, kind: 'market', title: 'US-Börse geschlossen', detail: name });
  for (const date of EARLY_CLOSE) ev.push({ date, at: nyTime(date, '13:00'), kind: 'market', title: 'Verkürzter Handel', detail: 'US-Börse schließt früher' });
  return ev;
}

function expiryEvents(from, to) {
  const ev = [];
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    for (let m = 0; m < 12; m++) {
      const date = thirdFriday(y, m);
      const big = m % 3 === 2;
      ev.push({ date, kind: 'market', title: big ? 'Großer Verfallstag' : 'Optionsverfall',
        detail: big ? 'Optionen und Futures laufen aus, oft starke Schwankungen' : 'Monatliche Optionen laufen aus' });
    }
  }
  return ev;
}

const WHEN = { bmo: 'vor Börsenstart', amc: 'nach Börsenschluss', dmh: 'während des Handels' };

// earnings: [{ date, symbol, hour }] von Finnhub; names: Symbol -> Firmenname.
export function upcomingEvents(earnings = [], names = {}, days = 28, now = new Date()) {
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'America/New_York' });
  const end = new Date(now.getTime() + days * 864e5).toLocaleDateString('sv-SE');
  const earn = earnings.map((e) => ({ date: e.date, kind: 'earnings',
    title: `Quartalszahlen ${names[e.symbol] || e.symbol}`,
    detail: [e.symbol, WHEN[e.hour]].filter(Boolean).join(' · ') }));
  return [...staticEvents(), ...expiryEvents(now, new Date(now.getTime() + days * 864e5)), ...earn]
    .filter((e) => e.date >= today && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.at ?? 0) - (b.at ?? 0));
}
