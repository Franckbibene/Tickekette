// Scénarios de recette du cahier des charges (section 10) : chaque ⚠️ a son test.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clock } from '../src/clock.js';
import { all, get, run } from '../src/db.js';
import { buy, createClient, makeCollective, makeEvent, makeUser, payByCard, setupServer, signWebhook, stock } from './helpers.js';

const ctx = setupServer();
const anonymous = () => createClient(ctx);

describe('5.2 — aucune survente', () => {
  test('50 achats simultanés pour la dernière place : une seule commande aboutit', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [1]);
    const results = await Promise.all(Array.from({ length: 50 }, () => buy(anonymous(), eventId, typeIds[0])));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409 && r.body.error === 'sold_out').length, 49);
    assert.deepEqual(stock(typeIds[0]), { quota: 1, sold: 0, held: 1 });
  });

  test('200 achats simultanés de 1 à 3 places sur 100 places : jamais plus de 100', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [100]);
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => buy(anonymous(), eventId, typeIds[0], 1 + (i % 3))));
    const s = stock(typeIds[0]);
    assert.ok(s.held <= 100);
    const reserved = all(
      "SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status = 'pending'",
    )[0].n;
    assert.equal(reserved, s.held);
    assert.ok(results.some((r) => r.status === 409));
  });
});

describe('5.2 — réservations non payées', () => {
  test('une réservation carte non payée libère ses places après 10 minutes', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [2]);
    const { body } = await buy(client, eventId, typeIds[0], 2);
    assert.equal((await buy(client, eventId, typeIds[0])).status, 409);
    clock.advance(9 * 60_000);
    assert.equal((await client.request(`/api/orders/${body.token}`)).body.status, 'pending');
    clock.advance(2 * 60_000);
    assert.equal((await client.request(`/api/orders/${body.token}`)).body.status, 'expired');
    assert.equal(stock(typeIds[0]).held, 0);
    assert.equal((await buy(client, eventId, typeIds[0])).status, 201);
  });

  test('un virement garde les places 48 h', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const { body } = await buy(client, eventId, typeIds[0], 1, { paymentMethod: 'transfer' });
    clock.advance(47 * 3_600_000);
    assert.equal((await client.request(`/api/orders/${body.token}`)).body.status, 'pending');
    clock.advance(2 * 3_600_000);
    assert.equal((await client.request(`/api/orders/${body.token}`)).body.status, 'expired');
  });

  test('virement confirmé après expiration alors que les places sont revendues : remboursement', async () => {
    const { cid, email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    const { eventId, typeIds } = makeEvent(cid, [1]);
    const transfer = await buy(anonymous(), eventId, typeIds[0], 1, { paymentMethod: 'transfer' });
    clock.advance(49 * 3_600_000);
    const buyer = anonymous();
    const resale = await buy(buyer, eventId, typeIds[0]);
    assert.equal(resale.status, 201);
    await payByCard(buyer, resale.body.token);
    const order = get('SELECT id FROM orders WHERE token = ?', transfer.body.token);
    const confirm = await admin.request(`/api/admin/orders/${order.id}/confirm-transfer`, { method: 'POST' });
    assert.equal(confirm.body.status, 'refunded_late');
    assert.equal(stock(typeIds[0]).sold, 1);
    assert.equal(get("SELECT COUNT(*) AS n FROM payments WHERE kind = 'refund'").n, 1);
  });
});

describe('5.3 — notification de paiement reçue plusieurs fois', () => {
  test('notification envoyée deux fois en même temps : un seul lot de billets', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [10]);
    const { body } = await buy(client, eventId, typeIds[0], 2);
    const pay = await payByCard(client, body.token, true);
    assert.deepEqual(pay.body.deliveries.sort(), ['duplicate_notification', 'paid']);
    const order = (await client.request(`/api/orders/${body.token}`)).body;
    assert.equal(order.status, 'paid');
    assert.equal(order.tickets.length, 2);
    assert.equal(get('SELECT COUNT(*) AS n FROM tickets').n, 2);
    assert.deepEqual(stock(typeIds[0]), { quota: 10, sold: 2, held: 0 });
  });

  test('même paiement renvoyé sous un autre identifiant de notification : ignoré', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [10]);
    const { body } = await buy(anonymous(), eventId, typeIds[0], 1);
    const order = get('SELECT * FROM orders WHERE token = ?', body.token);
    const send = (suffix) => {
      const payload = JSON.stringify({
        id: `evt_${suffix}`,
        type: 'payment.succeeded',
        data: { paymentId: 'pi_same', orderToken: body.token, amountCents: order.total_cents, feeCents: 0 },
      });
      return fetch(`${ctx.base}/api/webhooks/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mock-signature': signWebhook(payload) },
        body: payload,
      }).then((r) => r.json());
    };
    const outcomes = await Promise.all([send('1'), send('2'), send('3')]);
    assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ['already_recorded', 'already_recorded', 'paid']);
    assert.equal(get('SELECT COUNT(*) AS n FROM tickets').n, 1);
  });

  test('notification avec une signature invalide : rejetée', async () => {
    const res = await fetch(`${ctx.base}/api/webhooks/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mock-signature': 'faux' },
      body: '{}',
    });
    assert.equal(res.status, 400);
  });

  test('double clic sur « Payer » chez le prestataire : un seul paiement', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [10]);
    const { body } = await buy(client, eventId, typeIds[0]);
    const checkout = await client.request(`/api/orders/${body.token}/checkout`, { method: 'POST' });
    const sessionId = checkout.body.redirectUrl.split('/').pop();
    const pay = () => client.request(`/api/mock-provider/sessions/${sessionId}/pay`, { method: 'POST', body: {} });
    const results = await Promise.all([pay(), pay()]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(get("SELECT COUNT(*) AS n FROM payments WHERE kind = 'payment'").n, 1);
  });
});

describe('5.4 — liste d’attente', () => {
  test('une place libérée est proposée au premier inscrit, puis au suivant s’il ne paie pas', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [1]);
    const first = await buy(client, eventId, typeIds[0]);
    await payByCard(client, first.body.token, false);
    const join = (email) =>
      client.request(`/api/events/${eventId}/waitlist`, {
        method: 'POST',
        body: { ticketTypeId: typeIds[0], name: email, email, quantity: 1 },
      });
    assert.equal((await join('premier@exemple.test')).body.position, 1);
    assert.equal((await join('second@exemple.test')).body.position, 2);

    await client.request(`/api/orders/${first.body.token}/cancel`, { method: 'POST' });
    // La place ne revient pas en vente publique : elle est réservée au premier inscrit.
    assert.equal((await buy(client, eventId, typeIds[0])).status, 409);
    const offer1 = get("SELECT * FROM orders WHERE buyer_email = 'premier@exemple.test'");
    assert.equal(offer1.status, 'pending');

    clock.advance(121 * 60_000);
    await client.request(`/api/events/${eventId}`);
    assert.equal(get('SELECT status FROM orders WHERE id = ?', offer1.id).status, 'expired');
    const offer2 = get("SELECT * FROM orders WHERE buyer_email = 'second@exemple.test'");
    assert.equal(offer2.status, 'pending');
    await payByCard(client, offer2.token);
    assert.equal(get('SELECT status FROM waitlist_entries WHERE email = ?', 'second@exemple.test').status, 'converted');
  });

  test('inscription refusée s’il reste des places', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const res = await anonymous().request(`/api/events/${eventId}/waitlist`, {
      method: 'POST',
      body: { ticketTypeId: typeIds[0], name: 'X', email: 'x@exemple.test', quantity: 1 },
    });
    assert.equal(res.status, 409);
  });
});

describe('5.5 — annulation par l’acheteur', () => {
  test('annulation remboursée avant la limite, refusée après', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5], { inDays: 3 });
    const a = await buy(client, eventId, typeIds[0], 2);
    await payByCard(client, a.body.token);
    const cancel = await client.request(`/api/orders/${a.body.token}/cancel`, { method: 'POST' });
    assert.equal(cancel.body.status, 'refunded');
    assert.equal(stock(typeIds[0]).sold, 0);

    const b = await buy(client, eventId, typeIds[0], 1);
    await payByCard(client, b.body.token);
    clock.advance(2 * 86_400_000 + 3_600_000); // moins de 48 h avant l'événement
    const late = await client.request(`/api/orders/${b.body.token}/cancel`, { method: 'POST' });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, 'cancel_deadline_passed');
  });
});

describe('5.7 — contrôle à l’entrée', () => {
  async function paidTicket() {
    const { cid, email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const buyer = anonymous();
    const { body } = await buy(buyer, eventId, typeIds[0]);
    await payByCard(buyer, body.token);
    const order = (await buyer.request(`/api/orders/${body.token}`)).body;
    return { admin, eventId, qr: order.tickets[0].qr };
  }

  test('un billet ne passe qu’une fois', async () => {
    const { admin, eventId, qr } = await paidTicket();
    const scan = (clientScanId) =>
      admin.request(`/api/scan/events/${eventId}/check`, { method: 'POST', body: { text: qr, deviceId: 'tel-1', clientScanId } });
    assert.equal((await scan('s1')).body.result, 'ok');
    const second = (await scan('s2')).body;
    assert.equal(second.result, 'duplicate');
    assert.ok(second.firstEntry.at);
  });

  test('deux téléphones hors ligne scannent le même billet : conflit détecté à la synchro', async () => {
    const { admin, eventId, qr } = await paidTicket();
    const sync = (deviceId, clientScanId) =>
      admin.request(`/api/scan/events/${eventId}/sync`, {
        method: 'POST',
        body: { deviceId, gate: deviceId, scans: [{ clientScanId, text: qr, scannedAt: clock.nowIso() }] },
      });
    const [a, b] = await Promise.all([sync('porte-A', 'a1'), sync('porte-B', 'b1')]);
    assert.deepEqual([a.body.results[0].result, b.body.results[0].result].sort(), ['duplicate', 'ok']);
    // Rejouer la même synchronisation ne crée pas de nouveau scan.
    const replay = await sync('porte-A', 'a1');
    assert.equal(replay.body.results[0].result, a.body.results[0].result);
    assert.equal(get('SELECT COUNT(*) AS n FROM scans').n, 2);
    const stats = await admin.request(`/api/admin/events/${eventId}/stats`);
    assert.equal(stats.body.alerts.length, 1);
    assert.equal(stats.body.alerts[0].offline, true);
  });

  test('QR code retouché : refusé', async () => {
    const { admin, eventId, qr } = await paidTicket();
    const forged = `${qr.slice(0, -2)}xx`;
    const res = await admin.request(`/api/scan/events/${eventId}/check`, { method: 'POST', body: { text: forged, deviceId: 't' } });
    assert.equal(res.body.result, 'invalid');
  });
});

describe('4.1 — séparation des collectifs', () => {
  test('un collectif ne voit ni les événements, ni les chiffres, ni les billets d’un autre', async () => {
    const a = makeCollective('a');
    const b = makeCollective('b');
    const adminB = anonymous();
    await adminB.login(b.email);
    const { eventId } = makeEvent(a.cid, [5]);
    assert.equal((await adminB.request(`/api/admin/events/${eventId}`)).status, 404);
    assert.equal((await adminB.request(`/api/admin/events/${eventId}/stats`)).status, 404);
    assert.equal((await adminB.request(`/api/scan/events/${eventId}/manifest`)).status, 404);
    assert.deepEqual((await adminB.request('/api/admin/events')).body, []);
  });

  test('un contrôleur n’a pas accès aux chiffres', async () => {
    const { cid } = makeCollective('a');
    makeUser(cid, 'ctrl@a.test', 'controller');
    const controller = anonymous();
    await controller.login('ctrl@a.test');
    const { eventId } = makeEvent(cid, [5]);
    assert.equal((await controller.request(`/api/admin/events/${eventId}/stats`)).status, 403);
    assert.equal((await controller.request(`/api/scan/events/${eventId}/manifest`)).status, 200);
  });
});

describe('5.1 — tarif early', () => {
  test('le tarif early s’arrête à son quota, puis à sa date même si le quota se libère', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [100]);
    run(
      'UPDATE ticket_types SET early_price_cents = 1000, early_until = ?, early_quota = 3 WHERE id = ?',
      new Date(clock.now().getTime() + 86_400_000).toISOString(),
      typeIds[0],
    );
    const total = async (qty) => {
      const { body } = await buy(client, eventId, typeIds[0], qty);
      return get('SELECT total_cents FROM orders WHERE token = ?', body.token).total_cents;
    };
    assert.equal(await total(2), 2000);
    assert.equal(await total(2), 3000); // 1 early + 1 plein tarif
    assert.equal(await total(1), 2000);
    clock.advance(2 * 86_400_000); // après la date de fin : plein tarif
    run('UPDATE ticket_types SET early_used = 0 WHERE id = ?', typeIds[0]);
    assert.equal(await total(1), 2000);
  });
});
