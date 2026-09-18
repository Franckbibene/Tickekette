// Horloge centralisée : permet d'« avancer le temps » en démo et dans les tests
// (expiration des réservations, fin du tarif early…).
let offsetMs = 0;

export const clock = {
  now: () => new Date(Date.now() + offsetMs),
  nowIso: () => new Date(Date.now() + offsetMs).toISOString(),
  advance(ms) {
    offsetMs += ms;
  },
  reset() {
    offsetMs = 0;
  },
  offset: () => offsetMs,
};
