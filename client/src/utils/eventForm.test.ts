import { emptyEventForm, hasEventFormErrors, toEventInput, validateEventForm, type EventFormState } from './eventForm';

const NOW = new Date('2027-01-01T12:00:00Z');

function validForm(): EventFormState {
  const form = emptyEventForm();
  return {
    ...form,
    title: 'Concert',
    venue: 'Salle',
    startsAt: '2027-03-14T20:30',
    types: form.types.map((t) => ({ ...t, price: '22', quota: '100' })),
  };
}

describe('formulaire d’événement', () => {
  it('formulaire complet : aucune erreur et conversion en centimes / UTC', () => {
    const form = validForm();
    expect(hasEventFormErrors(validateEventForm(form, { requireFuture: true, now: NOW }))).toBe(false);
    const input = toEventInput(form);
    expect(input.startsAt).toBe('2027-03-14T19:30:00.000Z');
    expect(input.ticketTypes[0]).toMatchObject({ priceCents: 2200, quota: 100, earlyPriceCents: null });
  });

  it('titre vide, date passée, prix invalide : erreurs', () => {
    const form = { ...validForm(), title: ' ', startsAt: '2026-01-01T20:00' };
    form.types = form.types.map((t, i) => (i === 0 ? { ...t, price: '-3' } : t));
    const errors = validateEventForm(form, { requireFuture: true, now: NOW });
    expect(errors.title).toBeDefined();
    expect(errors.startsAt).toBeDefined();
    expect(Object.keys(errors.types ?? {})).toHaveLength(1);
  });

  it('tarif early : doit être inférieur au prix et finir avant l’événement', () => {
    const form = validForm();
    form.types = form.types.map((t, i) => (i === 0 ? { ...t, earlyPrice: '30', earlyUntil: '2027-03-01T00:00' } : t));
    expect(validateEventForm(form, { requireFuture: true, now: NOW }).types).toBeDefined();
    form.types = form.types.map((t, i) => (i === 0 ? { ...t, earlyPrice: '15', earlyUntil: '2027-04-01T00:00' } : t));
    expect(validateEventForm(form, { requireFuture: true, now: NOW }).types).toBeDefined();
  });

  it('quota inférieur aux places déjà vendues : refusé', () => {
    const form = validForm();
    form.types = form.types.map((t, i) => (i === 0 ? { ...t, quota: '5', sold: 10 } : t));
    expect(validateEventForm(form, { requireFuture: false, now: NOW }).types).toBeDefined();
  });

  it('événement en ligne : lien javascript: refusé', () => {
    const form = { ...validForm(), isOnline: true, onlineUrl: 'javascript:alert(1)' };
    expect(validateEventForm(form, { requireFuture: true, now: NOW }).onlineUrl).toBeDefined();
  });
});
