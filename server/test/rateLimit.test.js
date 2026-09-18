// Limites de débit : activées ici (désactivées dans les autres fichiers de test).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buy, createClient, makeCollective, makeEvent, setupServer } from './helpers.js';

const ctx = setupServer({ rateLimits: true });

describe('Limites de débit', () => {
  test('force brute sur la connexion : bloquée après 10 tentatives', async () => {
    const { email } = makeCollective('a');
    const client = createClient(ctx);
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await client.login(email, `essai-${i}`)).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.equal(statuses[11], 429);
    // Même le bon mot de passe est refusé tant que la limite est atteinte.
    assert.equal((await client.login(email)).status, 429);
  });

  test('réservations en masse pour bloquer le stock : limitées', async () => {
    const { cid } = makeCollective('b');
    const { eventId, typeIds } = makeEvent(cid, [500]);
    const client = createClient(ctx);
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await buy(client, eventId, typeIds[0])).status);
    assert.equal(statuses.filter((s) => s === 201).length, 20);
    assert.equal(statuses.at(-1), 429);
  });
});
