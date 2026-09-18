import type { PublicTicketType } from '../types/api';

// Prix affiché pour information : le serveur recalcule toujours le prix réel de la commande.
export const effectivePrice = (tt: PublicTicketType) => tt.earlyPriceCents ?? tt.priceCents;

export interface Selection {
  ticketTypeId: number;
  quantity: number;
}

// Quantités choisies, bornées par le stock actuel (qui peut baisser pendant la saisie).
export function clampSelection(ticketTypes: PublicTicketType[], chosen: Record<number, number>): Selection[] {
  return ticketTypes
    .map((tt) => ({ ticketTypeId: tt.id, quantity: Math.max(0, Math.min(chosen[tt.id] ?? 0, tt.available)) }))
    .filter((s) => s.quantity > 0);
}

export function selectionTotal(ticketTypes: PublicTicketType[], selection: Selection[]): number {
  return selection.reduce((sum, s) => {
    const tt = ticketTypes.find((t) => t.id === s.ticketTypeId);
    return sum + (tt ? effectivePrice(tt) * s.quantity : 0);
  }, 0);
}
