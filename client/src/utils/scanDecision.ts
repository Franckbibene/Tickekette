import type { Manifest, ManifestTicket } from '../types/api';

// Décision prise par le téléphone quand le serveur est injoignable (5.7).
// Fonction pure : testée indépendamment de l'interface.

export type OfflineDecision =
  | { kind: 'no_manifest' }
  | { kind: 'unknown' }
  | { kind: 'wrong_zone'; ticket: ManifestTicket }
  | { kind: 'cancelled'; ticket: ManifestTicket }
  | { kind: 'duplicate'; ticket: ManifestTicket }
  | { kind: 'ok'; ticket: ManifestTicket };

const QR_PREFIX = 'TKK1.';

// Contenu d'un QR code (« TKK1.<code>.<signature> ») ou code saisi à la main -> code du billet.
export function extractTicketCode(text: string): string {
  const value = text.trim();
  return value.startsWith(QR_PREFIX) ? (value.split('.')[1] ?? '') : value;
}

export function decideOffline(manifest: Manifest | null, code: string, acceptedZones: number[]): OfflineDecision {
  if (!manifest) return { kind: 'no_manifest' };
  const ticket = manifest.tickets.find((t) => t.code === code);
  if (!ticket) return { kind: 'unknown' };
  if (acceptedZones.length > 0 && !acceptedZones.includes(ticket.ticketTypeId)) return { kind: 'wrong_zone', ticket };
  if (ticket.status !== 'valid') return { kind: 'cancelled', ticket };
  if (ticket.enteredAt) return { kind: 'duplicate', ticket };
  return { kind: 'ok', ticket };
}

export function markEntered(manifest: Manifest, code: string, at: string, gate: string | null): Manifest {
  return {
    ...manifest,
    tickets: manifest.tickets.map((t) => (t.code === code && !t.enteredAt ? { ...t, enteredAt: at, enteredGate: gate } : t)),
  };
}

export function applyEntries(manifest: Manifest, entries: { code: string; enteredAt: string; enteredGate: string | null }[]): Manifest {
  const byCode = new Map(entries.map((e) => [e.code, e]));
  return {
    ...manifest,
    tickets: manifest.tickets.map((t) => {
      const entry = byCode.get(t.code);
      return entry ? { ...t, enteredAt: entry.enteredAt, enteredGate: entry.enteredGate } : t;
    }),
  };
}

// Recherche pour la saisie manuelle : nom, référence de commande ou début du code.
export function searchTickets(manifest: Manifest | null, query: string, limit = 8): ManifestTicket[] {
  const q = query.trim().toLowerCase();
  if (!manifest || q.length < 2) return [];
  return manifest.tickets
    .filter((t) => t.holderName.toLowerCase().includes(q) || t.reference.toLowerCase().includes(q) || t.code.toLowerCase().startsWith(q))
    .slice(0, limit);
}
