import type { PublicTicketType } from '../types/api';
import { clampSelection, effectivePrice, selectionTotal } from './pricing';

const type = (id: number, priceCents: number, available: number, earlyPriceCents: number | null = null): PublicTicketType => ({
  id,
  name: `Type ${id}`,
  priceCents,
  earlyActive: earlyPriceCents !== null,
  earlyPriceCents,
  earlyUntil: null,
  earlyRemaining: null,
  available,
  waitlistCount: 0,
});

describe('prix affiché', () => {
  it('prend le tarif early quand il est actif', () => {
    expect(effectivePrice(type(1, 2200, 10, 1600))).toBe(1600);
    expect(effectivePrice(type(1, 2200, 10))).toBe(2200);
  });

  it('les quantités sont bornées par le stock actuel (le stock peut baisser pendant la saisie)', () => {
    const types = [type(1, 1000, 1), type(2, 2500, 0)];
    const selection = clampSelection(types, { 1: 3, 2: 2 });
    expect(selection).toEqual([{ ticketTypeId: 1, quantity: 1 }]);
    expect(selectionTotal(types, selection)).toBe(1000);
  });

  it('quantités négatives ignorées', () => {
    expect(clampSelection([type(1, 1000, 5)], { 1: -2 })).toEqual([]);
  });
});
