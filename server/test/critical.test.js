// Scénarios de recette du cahier des charges (section 10) : chaque ⚠️ a son test.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { clock } from '../src/clock.js';
import { config } from '../src/config.js';
import { all, get, initDb, run } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

let server;
let base;

before(async () => {
  server = createApp({ devTools: true }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
  config.apiUrl = base;
});
after(() => server.close());

beforeEach(() => {
  clock.reset();
  initDb(':memory:');
});

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function makeCollective(slug) {
  const cid = Number(
    run("INSERT INTO collectives (name, slug, iban, created_at) VALUES (?, ?, 'FR76', ?)", slug, slug, clock.nowIso()).lastInsertRowid,
  );
  const email = `admin@${slug}.test`;
  run(
    "INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, 'Admin', 'admin', ?)",
    cid,
    email,
    hashPassword('motdepasse'),
    clock.nowIso(),
  );
  return { cid, email };
}

async function login(email) {
  const { body } = await api('/api/auth/login', { method: 'POST', body: { email, password: 'motdepasse' } });
  return body.token;
}

function makeEvent(cid, quotas, { inDays = 10, prices } = {}) {
  const startsAt = new Date(clock.now().getTime() + inDays * 86_400_000).toISOString();
  const eventId = Number(
    run(
      "INSERT INTO events (collective_id, title, venue, starts_at, status, created_at) VALUES (?, 'Concert test', 'Salle', ?, 'published', ?)",
      cid,
      startsAt,
      clock.nowIso(),
    ).lastInsertRowid,
  );
  const typeIds = quotas.map((quota, i) =>
    Number(
      run(
        'INSERT INTO ticket_types (event_id, name, position, price_cents, quota) VALUES (?, ?, ?, ?, ?)',
        eventId,
        `Type ${i + 1}`,
        i,
        prices?.[i] ?? 2000,
        quota,
      ).lastInsertRowid,
    ),
  );
  return { eventId, typeIds };
}

const buy = (eventId, ticketTypeId, quantity = 1, extra = {}) =>
  api(`/api/events/${eventId}/orders`, {
    method: 'POST',
    body: {
      buyerName: 'Test',
      buyerEmail: `acheteur-${crypto.randomUUID()}@exemple.test`,
      paymentMethod: 'card',
      items: [{ ticketTypeId, quantity }],
      ...extra,
    },
  });

async function payByCard(token, duplicateNotification = true) {
  const { body } = await api(`/api/orders/${token}/checkout`, { method: 'POST' });
  const sessionId = body.redirectUrl.split('/').pop();
  return api(`/api/mock-provider/sessions/${sessionId}/pay`, { method: 'POST', body: { duplicateNotification } });
}

const stock = (id) => get('SELECT quota, sold, held FROM ticket_types WHERE id = ?', id);

describe('5.2 — aucune survente', () => {
  test('50 achats simultanés pour la dernière place : une seule commande aboutit', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [1]);
    const results = await Promise.all(Array.from({ length: 50 }, () => buy(eventId, typeIds[0])));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409 && r.body.error === 'sold_out').length, 49);
    assert.deepEqual({ ...stock(typeIds[0]) }, { quota: 1, sold: 0, held: 1 });
  });

  test('200 achats simultanés de 1 à 3 places sur 100 places : jamais plus de 100', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [100]);
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => buy(eventId, typeIds[0], 1 + (i % 3))));
    const s = stock(typeIds[0]);
    assert.ok(s.held <= 100);
    const reserved = all("SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'pending'")[0].n;
    assert.equal(reserved, s.held);
    assert.ok(results.some((r) => r.status === 409));
  });
});

describe('5.2 — réservations non payées', () => {
  test('une réservation carte non payée libère ses places après 10 minutes', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [2]);
    const { body } = await buy(eventId, typeIds[0], 2);
    assert.equal((await buy(eventId, typeIds[0])).status, 409);
    clock.advance(9 * 60_000);
    assert.equal((await api(`/api/orders/${body.token}`)).body.status, 'pending');
    clock.advance(2 * 60_000);
    assert.equal((await api(`/api/orders/${body.token}`)).body.status, 'expired');
    assert.equal(stock(typeIds[0]).held, 0);
    assert.equal((await buy(eventId, typeIds[0])).status, 201);
  });

  test('un virement garde les places 48 h', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const { body } = await buy(eventId, typeIds[0], 1, { paymentMethod: 'transfer' });
    clock.advance(47 * 3_600_000);
    assert.equal((await api(`/api/orders/${body.token}`)).body.status, 'pending');
    clock.advance(2 * 3_600_000);
    assert.equal((await api(`/api/orders/${body.token}`)).body.status, 'expired');
  });

  test('virement confirmé après expiration alors que les places sont revendues : remboursement', async () => {
    const { cid, email } = makeCollective('a');
    const token = await login(email);
    const { eventId, typeIds } = makeEvent(cid, [1]);
    const transfer = await buy(eventId, typeIds[0], 1, { paymentMethod: 'transfer' });
    clock.advance(49 * 3_600_000);
    const resale = await buy(eventId, typeIds[0]);
    assert.equal(resale.status, 201);
    await payByCard(resale.body.token);
    const order = get('SELECT id FROM orders WHERE token = ?', transfer.body.token);
    const confirm = await api(`/api/admin/orders/${order.id}/confirm-transfer`, { method: 'POST', token });
    assert.equal(confirm.body.status, 'refunded_late');
    assert.equal(stock(typeIds[0]).sold, 1);
    assert.equal(get("SELECT COUNT(*) AS n FROM payments WHERE kind = 'refund'").n, 1);
  });
});

describe('5.3 — notification de paiement reçue plusieurs fois', () => {
  test('notification envoyée deux fois en même temps : un seul lot de billets', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [10]);
    const { body } = await buy(eventId, typeIds[0], 2);
    const pay = await payByCard(body.token, true);
    assert.deepEqual(pay.body.deliveries.sort(), ['duplicate_notification', 'paid']);
    const order = (await api(`/api/orders/${body.token}`)).body;
    assert.equal(order.status, 'paid');
    assert.equal(order.tickets.length, 2);
    assert.equal(get('SELECT COUNT(*) AS n FROM tickets').n, 2);
    assert.deepEqual({ ...stock(typeIds[0]) }, { quota: 10, sold: 2, held: 0 });
  });

  test('même paiement renvoyé sous un autre identifiant de notification : ignoré', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [10]);
    const { body } = await buy(eventId, typeIds[0], 1);
    const order = get('SELECT * FROM orders WHERE token = ?', body.token);
    const send = (eventIdSuffix) => {
      const payload = JSON.stringify({
        id: `evt_${eventIdSuffix}`,
        type: 'payment.succeeded',
        data: { paymentId: 'pi_same', orderToken: body.token, amountCents: order.total_cents, feeCents: 0 },
      });
      return fetch(`${base}/api/webhooks/payment`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mock-signature': crypto.createHmac('sha256', config.webhookSecret).update(payload).digest('hex'),
        },
        body: payload,
      }).then((r) => r.json());
    };
    const outcomes = await Promise.all([send('1'), send('2'), send('3')]);
    assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ['already_recorded', 'already_recorded', 'paid']);
    assert.equal(get('SELECT COUNT(*) AS n FROM tickets').n, 1);
  });

  test('notification avec une signature invalide : rejetée', async () => {
    const res = await fetch(`${base}/api/webhooks/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mock-signature': 'faux' },
      body: '{}',
    });
    assert.equal(res.status, 400);
  });
});

describe('5.4 — liste d’attente', () => {
  test('une place libérée est proposée au premier inscrit, puis au suivant s’il ne paie pas', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [1]);
    const first = await buy(eventId, typeIds[0]);
    await payByCard(first.body.token, false);
    const join = (email) =>
      api(`/api/events/${eventId}/waitlist`, { method: 'POST', body: { ticketTypeId: typeIds[0], name: email, email, quantity: 1 } });
    assert.equal((await join('premier@exemple.test')).body.position, 1);
    assert.equal((await join('second@exemple.test')).body.position, 2);

    await api(`/api/orders/${first.body.token}/cancel`, { method: 'POST' });
    // La place ne revient pas en vente publique : elle est réservée au premier inscrit.
    assert.equal((await buy(eventId, typeIds[0])).status, 409);
    const offer1 = get("SELECT * FROM orders WHERE buyer_email = 'premier@exemple.test'");
    assert.equal(offer1.status, 'pending');

    clock.advance(121 * 60_000);
    await api(`/api/events/${eventId}`);
    assert.equal(get('SELECT status FROM orders WHERE id = ?', offer1.id).status, 'expired');
    const offer2 = get("SELECT * FROM orders WHERE buyer_email = 'second@exemple.test'");
    assert.equal(offer2.status, 'pending');
    await payByCard(offer2.token);
    assert.equal(get('SELECT status FROM waitlist_entries WHERE email = ?', 'second@exemple.test').status, 'converted');
  });

  test('inscription refusée s’il reste des places', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const res = await api(`/api/events/${eventId}/waitlist`, {
      method: 'POST',
      body: { ticketTypeId: typeIds[0], name: 'X', email: 'x@exemple.test', quantity: 1 },
    });
    assert.equal(res.status, 409);
  });
});

describe('5.5 — annulation par l’acheteur', () => {
  test('annulation remboursée avant la limite, refusée après', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5], { inDays: 3 });
    const a = await buy(eventId, typeIds[0], 2);
    await payByCard(a.body.token);
    const cancel = await api(`/api/orders/${a.body.token}/cancel`, { method: 'POST' });
    assert.equal(cancel.body.status, 'refunded');
    assert.equal(stock(typeIds[0]).sold, 0);

    const b = await buy(eventId, typeIds[0], 1);
    await payByCard(b.body.token);
    clock.advance(2 * 86_400_000 + 3_600_000); // moins de 48 h avant l'événement
    const late = await api(`/api/orders/${b.body.token}/cancel`, { method: 'POST' });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, 'cancel_deadline_passed');
  });
});

describe('5.7 — contrôle à l’entrée', () => {
  async function paidTicket() {
    const { cid, email } = makeCollective('a');
    const token = await login(email);
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const { body } = await buy(eventId, typeIds[0]);
    await payByCard(body.token);
    const order = (await api(`/api/orders/${body.token}`)).body;
    return { token, eventId, qr: order.tickets[0].qr, code: order.tickets[0].code };
  }

  test('un billet ne passe qu’une fois', async () => {
    const { token, eventId, qr } = await paidTicket();
    const scan = (clientScanId) =>
      api(`/api/scan/events/${eventId}/check`, { method: 'POST', token, body: { text: qr, deviceId: 'tel-1', clientScanId } });
    assert.equal((await scan('s1')).body.result, 'ok');
    const second = (await scan('s2')).body;
    assert.equal(second.result, 'duplicate');
    assert.ok(second.firstEntry.at);
  });

  test('deux téléphones hors ligne scannent le même billet : conflit détecté à la synchro', async () => {
    const { token, eventId, qr } = await paidTicket();
    const sync = (deviceId, clientScanId) =>
      api(`/api/scan/events/${eventId}/sync`, {
        method: 'POST',
        token,
        body: { deviceId, gate: deviceId, scans: [{ clientScanId, text: qr, scannedAt: clock.nowIso() }] },
      });
    const [a, b] = await Promise.all([sync('porte-A', 'a1'), sync('porte-B', 'b1')]);
    assert.deepEqual([a.body.results[0].result, b.body.results[0].result].sort(), ['duplicate', 'ok']);
    // Rejouer la même synchronisation ne crée pas de nouveau scan.
    const replay = await sync('porte-A', 'a1');
    assert.equal(replay.body.results[0].result, a.body.results[0].result);
    assert.equal(get('SELECT COUNT(*) AS n FROM scans').n, 2);
    const stats = await api(`/api/admin/events/${eventId}/stats`, { token });
    assert.equal(stats.body.alerts.length, 1);
    assert.equal(stats.body.alerts[0].offline, true);
  });

  test('QR code retouché : refusé', async () => {
    const { token, eventId, qr } = await paidTicket();
    const forged = `${qr.slice(0, -2)}xx`;
    const res = await api(`/api/scan/events/${eventId}/check`, { method: 'POST', token, body: { text: forged, deviceId: 't' } });
    assert.equal(res.body.result, 'invalid');
  });
});

describe('4.1 — séparation des collectifs', () => {
  test('un collectif ne voit ni les événements, ni les chiffres, ni les billets d’un autre', async () => {
    const a = makeCollective('a');
    const b = makeCollective('b');
    const tokenB = await login(b.email);
    const { eventId } = makeEvent(a.cid, [5]);
    assert.equal((await api(`/api/admin/events/${eventId}`, { token: tokenB })).status, 404);
    assert.equal((await api(`/api/admin/events/${eventId}/stats`, { token: tokenB })).status, 404);
    assert.equal((await api(`/api/scan/events/${eventId}/manifest`, { token: tokenB })).status, 404);
    assert.deepEqual((await api('/api/admin/events', { token: tokenB })).body, []);
  });

  test('un contrôleur n’a pas accès aux chiffres', async () => {
    const { cid } = makeCollective('a');
    run(
      "INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (?, 'ctrl@a.test', ?, 'C', 'controller', ?)",
      cid,
      hashPassword('motdepasse'),
      clock.nowIso(),
    );
    const token = await login('ctrl@a.test');
    const { eventId } = makeEvent(cid, [5]);
    assert.equal((await api(`/api/admin/events/${eventId}/stats`, { token })).status, 403);
    assert.equal((await api(`/api/scan/events/${eventId}/manifest`, { token })).status, 200);
  });
});

describe('5.1 — tarif early', () => {
  test('le tarif early s’arrête à son quota puis à sa date', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [100]);
    run(
      'UPDATE ticket_types SET early_price_cents = 1000, early_until = ?, early_quota = 3 WHERE id = ?',
      new Date(clock.now().getTime() + 86_400_000).toISOString(),
      typeIds[0],
    );
    const first = await buy(eventId, typeIds[0], 2);
    assert.equal(get('SELECT total_cents FROM orders WHERE token = ?', first.body.token).total_cents, 2000);
    const second = await buy(eventId, typeIds[0], 2); // 1 early + 1 plein tarif
    assert.equal(get('SELECT total_cents FROM orders WHERE token = ?', second.body.token).total_cents, 3000);
    const third = await buy(eventId, typeIds[0], 1);
    assert.equal(get('SELECT total_cents FROM orders WHERE token = ?', third.body.token).total_cents, 2000);
  });
});
