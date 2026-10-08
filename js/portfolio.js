// Portfolio: Stückzahl und durchschnittlicher Kaufpreis (in $ oder €), gespeichert auf dem Gerät.
import { loadState, saveState } from './config.js';

export function getPortfolio() {
  const p = loadState().portfolio || {};
  return { shares: +p.shares || 0, cost: +p.cost || 0, currency: p.currency === 'EUR' ? 'EUR' : 'USD' };
}

export function setPortfolio(p) {
  const state = loadState();
  state.portfolio = p;
  saveState(state);
}

// quote: aktueller SOXL-Kurs; rate: USD -> EUR. Liefert alle Kennzahlen oder null.
export function portfolioFigures(p, quote, rate) {
  if (!p.shares || !quote) return null;
  const valueUsd = p.shares * quote.price;
  const dayUsd = p.shares * (quote.price - quote.prevClose);
  const f = {
    valueUsd, valueEur: rate ? valueUsd * rate : null,
    dayUsd, dayEur: rate ? dayUsd * rate : null,
    dayPct: quote.prevClose ? (quote.price / quote.prevClose - 1) * 100 : 0,
  };
  if (p.cost > 0) {
    const invested = p.shares * p.cost;
    if (p.currency === 'USD') {
      f.plUsd = valueUsd - invested;
      f.plEur = rate ? f.plUsd * rate : null; // zum heutigen Wechselkurs
      f.plPct = (valueUsd / invested - 1) * 100;
    } else {
      f.plEur = rate ? valueUsd * rate - invested : null;
      f.plUsd = rate ? f.plEur / rate : null;
      f.plPct = rate ? (valueUsd * rate / invested - 1) * 100 : null;
    }
  }
  return f;
}
