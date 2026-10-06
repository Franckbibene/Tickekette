// Tests de sécurité : validation, limites, logique métier, contrôle d'accès, en-têtes.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generate } from 'otplib';
import { clock } from '../src/clock.js';
import { get, run } from '../src/db.js';
import { recordPayment } from '../src/services/payments.js';
import {
  PASSWORD,
  accessOrder,
  buy,
  createClient,
  getOrder,
  makeCollective,
  makeEvent,
  makeUser,
  orderByToken,
  payByCard,
  setupServer,
  signWebhook,
} from './helpers.js';

const ctx = setupServer();
const anonymous = () => createClient(ctx);

describe('Nombre de places : valeurs limites', () => {
  for (const [quantity, expected] of [
    [0, 400],
    [-1, 400],
    [1.5, 400],
    ['2', 201],
    [4, 201],
    [5, 400],
  ]) {
    test(`quantité ${JSON.stringify(quantity)} (maximum 4 par commande) → ${expected}`, async () => {
      const { cid } = makeCollective('a');
      const { eventId, typeIds } = makeEvent(cid, [10], { maxPerOrder: 4 });
      assert.equal((await buy(anonymous(), eventId, typeIds[0], quantity)).status, expected);
    });
  }

  test('plus de places que le stock : refusé sans rien réserver', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [2]);
    const res = await buy(anonymous(), eventId, typeIds[0], 3);
    assert.equal(res.status, 409);
    assert.equal(get('SELECT held FROM ticket_types WHERE id = ?', typeIds[0]).held, 0);
  });

  test('type de place d’un autre événement : refusé', async () => {
    const { cid } = makeCollective('a');
    const first = makeEvent(cid, [5]);
    const second = makeEvent(cid, [5]);
    assert.equal((await buy(anonymous(), first.eventId, second.typeIds[0])).status, 400);
  });
});

describe('Prix : jamais fourni par le navigateur', () => {
  test('un prix ou un total envoyé par le client est ignoré', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5], { prices: [2500] });
    const res = await anonymous().request(`/api/events/${eventId}/orders`, {
      method: 'POST',
      body: {
        buyerName: 'Malin',
        buyerEmail: 'malin@exemple.test',
        totalCents: 1,
        items: [{ ticketTypeId: typeIds[0], quantity: 2, unitPriceCents: 1, priceCents: 1 }],
      },
    });
    assert.equal(res.status, 201);
    assert.equal(orderByToken(res.body.token).total_cents, 5000);
  });

  test('un paiement d’un montant différent de la commande est remboursé', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const { body } = await buy(anonymous(), eventId, typeIds[0], 1, { paymentMethod: 'transfer' });
    const order = orderByToken(body.token);
    const result = recordPayment(order.id, { provider: 'transfer', providerPaymentId: 'x', amountCents: 1 });
    assert.equal(result.status, 'refunded_amount_mismatch');
    assert.equal(get('SELECT status FROM orders WHERE id = ?', order.id).status, 'pending');
  });
});

describe('Événements : réservation impossible hors période de vente', () => {
  test('événement commencé, brouillon ou annulé : refusé', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5], { inDays: 1 });
    clock.advance(2 * 86_400_000);
    assert.equal((await buy(anonymous(), eventId, typeIds[0])).status, 409);
    run("UPDATE events SET status = 'draft' WHERE id = ?", eventId);
    assert.equal((await buy(anonymous(), eventId, typeIds[0])).status, 404);
  });
});

describe('Double soumission', () => {
  test('même clé d’idempotence : une seule commande et une seule réservation', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [10]);
    const client = anonymous();
    const send = () =>
      client.request(`/api/events/${eventId}/orders`, {
        method: 'POST',
        headers: { 'idempotency-key': 'cle-de-test-0123456789' },
        body: { buyerName: 'A', buyerEmail: 'a@exemple.test', items: [{ ticketTypeId: typeIds[0], quantity: 2 }] },
      });
    const [a, b] = await Promise.all([send(), send()]);
    assert.notEqual(a.body.token, b.body.token);
    assert.equal(get('SELECT COUNT(*) AS n FROM orders').n, 1);
    assert.equal(get('SELECT held FROM ticket_types WHERE id = ?', typeIds[0]).held, 2);
  });
});

describe('Validation des champs', () => {
  test('e-mail invalide, nom vide ou trop long : refusés', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [10]);
    const client = anonymous();
    const order = (body) =>
      client.request(`/api/events/${eventId}/orders`, {
        method: 'POST',
        body: { items: [{ ticketTypeId: typeIds[0], quantity: 1 }], ...body },
      });
    assert.equal((await order({ buyerName: 'A', buyerEmail: 'pas-un-mail' })).status, 400);
    assert.equal((await order({ buyerName: '   ', buyerEmail: 'a@b.fr' })).status, 400);
    assert.equal((await order({ buyerName: 'x'.repeat(121), buyerEmail: 'a@b.fr' })).status, 400);
    assert.equal((await order({ buyerName: 42, buyerEmail: 'a@b.fr' })).status, 400);
  });

  test('identifiant d’URL mal formé : 404 propre, sans erreur technique', async () => {
    const client = anonymous();
    for (const path of ['/api/events/abc', '/api/events/1;DROP', '/api/orders/%27%20OR%201=1', '/api/events/-1']) {
      const res = await client.request(path);
      assert.equal(res.status, 404, path);
      assert.equal(res.body.error, 'not_found');
    }
  });

  test('JSON invalide : 400 sans détail technique', async () => {
    const res = await fetch(`${ctx.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'tickekette' },
      body: '{"email":',
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_json', message: 'Requête invalide.' });
  });

  test('admin : isOnline "false" (chaîne) n’est pas compris comme vrai', async () => {
    const { email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    const res = await admin.request('/api/admin/events', {
      method: 'POST',
      body: {
        title: 'Concert',
        venue: 'Salle',
        isOnline: 'false',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        ticketTypes: [{ name: 'Standard', priceCents: 1000, quota: 10 }],
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.isOnline, false);
  });

  test('admin : lien d’événement en ligne javascript: refusé', async () => {
    const { email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    const res = await admin.request('/api/admin/events', {
      method: 'POST',
      body: {
        title: 'Live',
        isOnline: true,
        onlineUrl: 'javascript:alert(1)',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        ticketTypes: [{ name: 'Accès', priceCents: 500, quota: 10 }],
      },
    });
    assert.equal(res.status, 400);
  });

  test('admin : prix négatif, quota absurde ou date passée : refusés', async () => {
    const { email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    const create = (patch) =>
      admin.request('/api/admin/events', {
        method: 'POST',
        body: {
          title: 'Concert',
          venue: 'Salle',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          ticketTypes: [{ name: 'Standard', priceCents: 1000, quota: 10 }],
          ...patch,
        },
      });
    assert.equal((await create({ ticketTypes: [{ name: 'A', priceCents: -1, quota: 10 }] })).status, 400);
    assert.equal((await create({ ticketTypes: [{ name: 'A', priceCents: 100, quota: 10_000_000 }] })).status, 400);
    assert.equal((await create({ startsAt: '2000-01-01T00:00:00Z' })).status, 400);
    assert.equal((await create({})).status, 201);
  });

  test('admin : capacité totale excessive même avec des quotas unitaires valides : refusée', async () => {
    const { email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    const res = await admin.request('/api/admin/events', {
      method: 'POST',
      body: {
        title: 'Événement démesuré',
        venue: 'Salle',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        ticketTypes: [
          { name: 'A', priceCents: 1000, quota: 6000 },
          { name: 'B', priceCents: 1000, quota: 6000 },
        ],
      },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'capacity_too_high');
  });
});

describe('Authentification', () => {
  test('MFA obligatoire pour un admin, secret chiffré et code TOTP non rejouable', async () => {
    const { email } = makeCollective('a');
    const client = anonymous();
    const challenge = await client.request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    assert.equal(challenge.status, 202);
    assert.deepEqual(challenge.body, { mfaRequired: true, setupRequired: true });
    const setup = await client.request('/api/auth/mfa/setup');
    assert.equal(setup.headers.get('cache-control'), 'no-store');
    const otp = await generate({ secret: setup.body.secret });
    assert.equal((await client.request('/api/auth/mfa/confirm', { method: 'POST', body: { otp } })).status, 200);
    const stored = get('SELECT mfa_secret_enc FROM users WHERE email = ?', email).mfa_secret_enc;
    assert.ok(stored.startsWith('v1.'));
    assert.equal(stored.includes(setup.body.secret), false);

    await client.request('/api/auth/logout', { method: 'POST' });
    assert.equal(
      (await client.request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).body.setupRequired,
      false,
    );
    const replay = await client.request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD, otp } });
    assert.equal(replay.status, 401);
  });

  test('connexion : session en cookie HttpOnly SameSite=Strict, jamais dans la réponse', async () => {
    const { email } = makeCollective('a');
    const res = await anonymous().login(email);
    assert.equal(res.status, 200);
    assert.match(res.setCookie, /HttpOnly/i);
    assert.match(res.setCookie, /SameSite=Strict/i);
    assert.doesNotMatch(res.setCookie, /; Secure/i);
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.password_hash, undefined);
  });

  test('mauvais mot de passe et compte inconnu : même réponse', async () => {
    const { email } = makeCollective('a');
    const wrong = await anonymous().login(email, 'mauvais-mdp');
    const unknown = await anonymous().login('inconnu@exemple.test', 'mauvais-mdp');
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  test('déconnexion : la session n’est plus acceptée', async () => {
    const { email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    assert.equal((await admin.request('/api/auth/me')).status, 200);
    await admin.request('/api/auth/logout', { method: 'POST' });
    assert.equal((await admin.request('/api/auth/me')).status, 401);
  });

  test('jeton JWT falsifié : refusé', async () => {
    const res = await fetch(`${ctx.base}/api/auth/me`, {
      headers: { cookie: 'tkk_session=eyJhbGciOiJub25lIn0.eyJ1aWQiOjF9.' },
    });
    assert.equal(res.status, 401);
  });

  test('compte supprimé : sa session ne donne plus accès', async () => {
    const { cid, email } = makeCollective('a');
    makeUser(cid, 'ctrl@a.test', 'controller');
    const admin = anonymous();
    const controller = anonymous();
    await admin.login(email);
    await controller.login('ctrl@a.test');
    const { id } = get('SELECT id FROM users WHERE email = ?', 'ctrl@a.test');
    assert.equal((await admin.request(`/api/admin/users/${id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await controller.request('/api/scan/events')).status, 401);
  });

  test('une nouvelle connexion révoque immédiatement l’ancienne session', async () => {
    const { cid } = makeCollective('a');
    makeUser(cid, 'ctrl@a.test', 'controller');
    const first = anonymous();
    const second = anonymous();
    await first.login('ctrl@a.test');
    await second.login('ctrl@a.test');
    assert.equal((await first.request('/api/scan/events')).status, 401);
    assert.equal((await second.request('/api/scan/events')).status, 200);
  });
});

describe('Capacités de commande', () => {
  test('jeton condensé en base, échangé contre un cookie court et réponses non mises en cache', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const purchase = await buy(client, eventId, typeIds[0]);
    const order = orderByToken(purchase.body.token);
    await payByCard(client, purchase.body.token, false);
    assert.match(order.token, /^retired:/);
    assert.equal(get('SELECT COUNT(*) AS n FROM order_access_tokens WHERE token_hash = ?', purchase.body.token).n, 0);
    assert.equal(get('SELECT COUNT(*) AS n FROM emails WHERE html LIKE ?', `%${purchase.body.token}%`).n, 0);
    assert.match(get('SELECT html FROM emails ORDER BY id DESC LIMIT 1').html, /^v1\./);
    const access = await accessOrder(client, purchase.body.token);
    assert.equal(access.status, 200);
    assert.match(access.setCookie, /HttpOnly/i);
    assert.match(access.setCookie, /SameSite=Strict/i);
    assert.match(access.headers.get('cache-control'), /no-store/);
    assert.equal((await client.request(`/api/orders/${purchase.body.token}`)).status, 404);
  });

  test('une commande payée ne peut pas être annulée sans confirmation e-mail valide', async () => {
    const client = anonymous();
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const purchase = await buy(client, eventId, typeIds[0]);
    await payByCard(client, purchase.body.token, false);
    await accessOrder(client, purchase.body.token);
    assert.equal((await client.request('/api/orders/cancel', { method: 'POST' })).status, 403);
    assert.equal((await client.request('/api/orders/cancel-code', { method: 'POST' })).status, 204);
    assert.equal((await client.request('/api/orders/cancel', { method: 'POST', body: { confirmationCode: '000000' } })).status, 403);
    assert.equal(orderByToken(purchase.body.token).status, 'paid');
  });
});

describe('Validation du webhook de paiement', () => {
  test('montants, champs inconnus et timestamps hors fenêtre sont refusés', async () => {
    const { cid } = makeCollective('a');
    const { eventId, typeIds } = makeEvent(cid, [5]);
    const purchase = await buy(anonymous(), eventId, typeIds[0]);
    const order = orderByToken(purchase.body.token);
    const base = {
      id: 'evt_validation',
      type: 'payment.succeeded',
      createdAt: new Date().toISOString(),
      data: { paymentId: 'pi_validation', orderId: order.id, amountCents: order.total_cents, feeCents: 0 },
    };
    const send = async (event) => {
      const payload = JSON.stringify(event);
      return fetch(`${ctx.base}/api/webhooks/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mock-signature': signWebhook(payload) },
        body: payload,
      });
    };
    assert.equal((await send({ ...base, data: { ...base.data, amountCents: -1 } })).status, 400);
    assert.equal((await send({ ...base, data: { ...base.data, feeCents: base.data.amountCents + 1 } })).status, 400);
    assert.equal((await send({ ...base, unexpected: true })).status, 400);
    assert.equal((await send({ ...base, createdAt: new Date(Date.now() - 10 * 60_000).toISOString() })).status, 400);
    assert.equal(get('SELECT COUNT(*) AS n FROM webhook_events').n, 0);
  });
});

describe('Contrôle hors ligne borné', () => {
  test('manifest limité autour de l’événement, grant signé requis et lots plafonnés', async () => {
    const { cid, email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    const near = makeEvent(cid, [5], { inDays: 0.5 });
    const far = makeEvent(cid, [5], { inDays: 10 });
    assert.equal((await admin.request(`/api/scan/events/${far.eventId}/manifest`)).status, 409);
    const manifest = await admin.request(`/api/scan/events/${near.eventId}/manifest`);
    assert.equal(manifest.status, 200);
    assert.ok(Date.parse(manifest.body.offlineExpiresAt) <= Date.now() + 8 * 3_600_000 + 1000);
    assert.equal(
      (
        await admin.request(`/api/scan/events/${near.eventId}/sync`, {
          method: 'POST',
          body: { deviceId: 'porte-a', offlineGrant: 'grant-invalide', scans: [] },
        })
      ).status,
      403,
    );
    const scans = Array.from({ length: 201 }, (_, i) => ({
      clientScanId: `scan-${String(i).padStart(8, '0')}`,
      text: 'billet-invalide',
      scannedAt: new Date().toISOString(),
    }));
    const oversized = await admin.request(`/api/scan/events/${near.eventId}/sync`, {
      method: 'POST',
      body: { deviceId: 'porte-a', offlineGrant: manifest.body.offlineGrant, scans },
    });
    assert.equal(oversized.status, 400);
    assert.equal(get('SELECT COUNT(*) AS n FROM scans').n, 0);
  });
});

describe('CSRF', () => {
  test('requête modifiante sans l’en-tête anti-CSRF : refusée', async () => {
    const { email } = makeCollective('a');
    const admin = anonymous();
    await admin.login(email);
    const res = await admin.request('/api/admin/users', {
      method: 'POST',
      csrf: false,
      body: { name: 'Pirate', email: 'pirate@exemple.test', password: 'motdepasse', role: 'admin' },
    });
    assert.equal(res.status, 403);
    assert.equal(get('SELECT COUNT(*) AS n FROM users WHERE email = ?', 'pirate@exemple.test').n, 0);
  });
});

describe('Contrôle d’accès', () => {
  test('confirmer le virement d’un autre collectif : 404', async () => {
    const a = makeCollective('a');
    const b = makeCollective('b');
    const adminB = anonymous();
    await adminB.login(b.email);
    const { eventId, typeIds } = makeEvent(a.cid, [5]);
    const { body } = await buy(anonymous(), eventId, typeIds[0], 1, { paymentMethod: 'transfer' });
    const order = orderByToken(body.token);
    assert.equal((await adminB.request(`/api/admin/orders/${order.id}/confirm-transfer`, { method: 'POST' })).status, 404);
    assert.equal(get('SELECT status FROM orders WHERE id = ?', order.id).status, 'pending');
  });

  test('un admin ne peut pas créer de super-admin ni supprimer un compte d’un autre collectif', async () => {
    const a = makeCollective('a');
    makeCollective('b');
    const adminA = anonymous();
    await adminA.login(a.email);
    const res = await adminA.request('/api/admin/users', {
      method: 'POST',
      body: { name: 'X', email: 'x@exemple.test', password: 'motdepasse', role: 'superadmin' },
    });
    assert.equal(res.status, 400);
    const other = get('SELECT id FROM users WHERE email = ?', 'admin@b.test');
    assert.equal((await adminA.request(`/api/admin/users/${other.id}`, { method: 'DELETE' })).status, 404);
  });

  test('scanner le billet d’un autre collectif ne révèle rien sur son porteur', async () => {
    const a = makeCollective('a');
    const b = makeCollective('b');
    const eventA = makeEvent(a.cid, [5]);
    const eventB = makeEvent(b.cid, [5]);
    const buyer = anonymous();
    const { body } = await buy(buyer, eventA.eventId, eventA.typeIds[0]);
    await payByCard(buyer, body.token);
    const qr = (await getOrder(buyer, body.token)).body.tickets[0].qr;
    const adminB = anonymous();
    await adminB.login(b.email);
    const res = await adminB.request(`/api/scan/events/${eventB.eventId}/check`, {
      method: 'POST',
      body: { text: qr, deviceId: 't', clientScanId: 'scan-other-event' },
    });
    assert.equal(res.body.result, 'wrong_event');
    assert.equal(res.body.ticket, null);
    assert.equal(res.body.firstEntry, null);
  });

  test('rejouer l’identifiant de scan d’un autre collectif : refusé', async () => {
    const a = makeCollective('a');
    const b = makeCollective('b');
    const eventA = makeEvent(a.cid, [5]);
    const eventB = makeEvent(b.cid, [5]);
    const adminA = anonymous();
    const adminB = anonymous();
    await adminA.login(a.email);
    await adminB.login(b.email);
    await adminA.request(`/api/scan/events/${eventA.eventId}/check`, { method: 'POST', body: { text: 'x', clientScanId: 'scan-partage' } });
    const res = await adminB.request(`/api/scan/events/${eventB.eventId}/check`, {
      method: 'POST',
      body: { text: 'x', clientScanId: 'scan-partage' },
    });
    assert.equal(res.status, 409);
  });

  test('routes admin sans session : 401', async () => {
    const client = anonymous();
    for (const path of ['/api/admin/events', '/api/admin/users', '/api/scan/events', '/api/platform/collectives']) {
      assert.equal((await client.request(path)).status, 401, path);
    }
  });
});

describe('En-têtes HTTP', () => {
  test('CSP stricte, anti-clickjacking, pas de Referer, pas de X-Powered-By', async () => {
    const res = await anonymous().request('/api/collectives');
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('strict-transport-security'), null);
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});
