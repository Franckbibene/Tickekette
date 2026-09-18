import { isoToZonedInput, sameClock, zonedInputToIso } from './timezones';

describe('fuseaux horaires', () => {
  it('heure de Paris en hiver et en été (changement d’heure)', () => {
    expect(zonedInputToIso('2027-01-15T20:30', 'Europe/Paris')).toBe('2027-01-15T19:30:00.000Z');
    expect(zonedInputToIso('2027-07-15T20:30', 'Europe/Paris')).toBe('2027-07-15T18:30:00.000Z');
  });

  it('aller-retour saisie ↔ UTC', () => {
    const iso = zonedInputToIso('2027-03-14T20:30', 'America/Montreal');
    expect(iso).not.toBeNull();
    expect(isoToZonedInput(iso, 'America/Montreal')).toBe('2027-03-14T20:30');
  });

  it('saisie invalide : null', () => {
    expect(zonedInputToIso('14/03/2027 20h30', 'Europe/Paris')).toBeNull();
    expect(zonedInputToIso('', 'Europe/Paris')).toBeNull();
  });

  it('compare les heures de deux fuseaux', () => {
    expect(sameClock('2027-01-15T19:30:00Z', 'Europe/Paris', 'Europe/Berlin')).toBe(true);
    expect(sameClock('2027-01-15T19:30:00Z', 'Europe/Paris', 'America/New_York')).toBe(false);
  });
});
