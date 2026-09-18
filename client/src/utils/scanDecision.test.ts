import type { Manifest } from '../types/api';
import { applyEntries, decideOffline, extractTicketCode, markEntered, searchTickets } from './scanDecision';

const manifest: Manifest = {
  event: { id: 1, title: 'Concert', startsAt: '2030-01-01T20:00:00Z', timezone: 'Europe/Paris', venue: 'Salle' },
  ticketTypes: [
    { id: 1, name: 'Fosse' },
    { id: 2, name: 'Balcon' },
  ],
  tickets: [
    { code: 'AAA', ticketTypeId: 1, holderName: 'Léa Martin', status: 'valid', enteredAt: null, enteredGate: null, reference: 'TKK-1' },
    { code: 'BBB', ticketTypeId: 2, holderName: 'Hugo Roux', status: 'valid', enteredAt: null, enteredGate: null, reference: 'TKK-2' },
    {
      code: 'CCC',
      ticketTypeId: 1,
      holderName: 'Inès Diallo',
      status: 'cancelled',
      enteredAt: null,
      enteredGate: null,
      reference: 'TKK-3',
    },
  ],
  generatedAt: '2030-01-01T18:00:00Z',
};

describe('décision hors ligne', () => {
  it('billet valide puis rescanné : accepté puis refusé', () => {
    expect(decideOffline(manifest, 'AAA', []).kind).toBe('ok');
    const after = markEntered(manifest, 'AAA', '2030-01-01T19:00:00Z', 'Porte A');
    expect(decideOffline(after, 'AAA', []).kind).toBe('duplicate');
  });

  it('billet inconnu, annulé, mauvaise zone, liste absente', () => {
    expect(decideOffline(manifest, 'ZZZ', []).kind).toBe('unknown');
    expect(decideOffline(manifest, 'CCC', []).kind).toBe('cancelled');
    expect(decideOffline(manifest, 'BBB', [1]).kind).toBe('wrong_zone');
    expect(decideOffline(null, 'AAA', []).kind).toBe('no_manifest');
  });

  it('les entrées synchronisées depuis les autres portes sont appliquées', () => {
    const synced = applyEntries(manifest, [{ code: 'BBB', enteredAt: '2030-01-01T19:05:00Z', enteredGate: 'Porte B' }]);
    expect(decideOffline(synced, 'BBB', []).kind).toBe('duplicate');
  });

  it('extrait le code d’un QR code signé ou d’une saisie', () => {
    expect(extractTicketCode('TKK1.AAA.signature')).toBe('AAA');
    expect(extractTicketCode('  AAA ')).toBe('AAA');
  });

  it('recherche par nom ou référence (2 caractères minimum)', () => {
    expect(searchTickets(manifest, 'l')).toHaveLength(0);
    expect(searchTickets(manifest, 'léa').map((t) => t.code)).toEqual(['AAA']);
    expect(searchTickets(manifest, 'tkk-2').map((t) => t.code)).toEqual(['BBB']);
  });
});
