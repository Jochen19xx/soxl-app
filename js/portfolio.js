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

// Weitere Positionen (z. B. VVSM in Euro): [{ symbol, label, name, shares, cost, currency }]
export function getPositions() {
  const list = loadState().positions;
  return Array.isArray(list) ? list.filter((p) => p.symbol && +p.shares > 0) : [];
}
export function setPositions(list) {
  const state = loadState();
  state.positions = list;
  saveState(state);
}

// Kennzahlen einer weiteren Position, alles zusätzlich in Euro umgerechnet.
// quote: { price, prevClose, currency }; rate: USD -> EUR.
export function positionFigures(pos, quote, rate) {
  if (!pos.shares || !quote?.price) return null;
  const c = quote.currency || 'USD';
  const toEur = c === 'EUR' ? 1 : c === 'USD' ? rate : null;
  const value = pos.shares * quote.price;
  const day = quote.prevClose ? pos.shares * (quote.price - quote.prevClose) : 0;
  const f = {
    currency: c, value, day, dayPct: quote.prevClose ? (quote.price / quote.prevClose - 1) * 100 : 0,
    valueEur: toEur ? value * toEur : null, dayEur: toEur ? day * toEur : null,
  };
  if (pos.cost > 0 && toEur) {
    const costToEur = pos.currency === 'EUR' ? 1 : rate;
    if (costToEur) {
      const investedEur = pos.shares * pos.cost * costToEur;
      f.plEur = f.valueEur - investedEur;
      f.plPct = (f.valueEur / investedEur - 1) * 100;
    }
  }
  return f;
}
