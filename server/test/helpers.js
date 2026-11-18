import crypto from 'node:crypto';
import { after, before, beforeEach } from 'node:test';
import { createApp } from '../src/app.js';
import { clock } from '../src/clock.js';
import { config } from '../src/config.js';
import { decryptData } from '../src/dataEncryption.js';
import { all, get, initDb, run } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

export const PASSWORD = 'motdepasse-test';

// Démarre une application de test sur un port libre, avec une base en mémoire neuve pour chaque test.
export function setupServer(options = {}) {
  const ctx = { base: '' };
  let server;
  before(async () => {
    server = createApp({ devTools: true, mockPayments: true, rateLimits: false, ...options }).listen(0, config.host);
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    ctx.base = `http://${config.host === '::1' ? '[::1]' : config.host}:${port}`;
    config.apiUrl = ctx.base;
  });
  after(() => server.close());
  beforeEach(() => {
    clock.reset();
    initDb(':memory:');
  });
  return ctx;
}

export function createClient(ctx) {
  const cookies = new Map();
  /**
   * @param {string} path
   * @param {{ method?: string, body?: unknown, headers?: Record<string, string>, csrf?: boolean }} [options]
   */
  async function request(path, { method = 'GET', body, headers = {}, csrf = true } = {}) {
    const res = await fetch(ctx.base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'x-requested-with': 'tickekette' } : {}),
        ...(cookies.size ? { cookie: [...cookies.values()].join('; ') } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const header of setCookies) {
      const pair = header.split(';')[0];
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      if (/Max-Age=0/i.test(header) || pair.slice(separator + 1) === '') cookies.delete(name);
      else cookies.set(name, pair);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers, setCookie: setCookies.join(', ') };
  }
  function login(email, password = PASSWORD) {
    return request('/api/auth/login', { method: 'POST', body: { email, password } });
  }
  return {
    request,
    login,
  };
}

export function makeCollective(slug) {
  const cid = Number(
    run("INSERT INTO collectives (name, slug, iban, created_at) VALUES (?, ?, 'FR76', ?)", slug, slug, clock.nowIso()).lastInsertRowid,
  );
  const email = `admin@${slug}.test`;
  makeUser(cid, email, 'admin');
  return { cid, email };
}

export function makeUser(collectiveId, email, role) {
  run(
    'INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    collectiveId,
    email,
    hashPassword(PASSWORD),
    'Utilisateur test',
    role,
    clock.nowIso(),
  );
}

/**
 * @param {number} cid
 * @param {number[]} quotas
 * @param {{ inDays?: number, prices?: number[], maxPerOrder?: number }} [options]
 */
export function makeEvent(cid, quotas, { inDays = 10, prices, maxPerOrder = 6 } = {}) {
  const startsAt = new Date(clock.now().getTime() + inDays * 86_400_000).toISOString();
  const eventId = Number(
    run(
      `INSERT INTO events (collective_id, title, venue, starts_at, status, max_per_order, created_at)
       VALUES (?, 'Concert test', 'Salle', ?, 'published', ?, ?)`,
      cid,
      startsAt,
      maxPerOrder,
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

/**
 * @param {ReturnType<typeof createClient>} client
 * @param {number} eventId
 * @param {number} ticketTypeId
 * @param {unknown} [quantity] volontairement non typé : les tests envoient aussi des valeurs invalides
 * @param {Record<string, unknown>} [extra]
 */
export const buy = (client, eventId, ticketTypeId, quantity = 1, extra = {}) =>
  client.request(`/api/events/${eventId}/orders`, {
    method: 'POST',
    body: {
      buyerName: 'Test',
      buyerEmail: `acheteur-${crypto.randomUUID()}@exemple.test`,
      paymentMethod: 'card',
      items: [{ ticketTypeId, quantity }],
      ...extra,
    },
  });

export function orderByToken(token) {
  return get(
    `SELECT o.* FROM orders o JOIN order_access_tokens oat ON oat.order_id = o.id
     WHERE oat.token_hash = ?`,
    crypto.createHash('sha256').update(token).digest('hex'),
  );
}

export const accessOrder = (client, token) => client.request('/api/orders/access', { method: 'POST', body: { token } });

export async function getOrder(client, token) {
  return accessOrder(client, token);
}

export async function payByCard(client, token, duplicateNotification = true) {
  await accessOrder(client, token);
  const { body } = await client.request('/api/orders/checkout', { method: 'POST' });
  const sessionId = body.redirectUrl.split('/').pop();
  return client.request(`/api/mock-provider/sessions/${sessionId}/pay`, { method: 'POST', body: { duplicateNotification } });
}

export function tokenFromLatestOrderEmail(email) {
  const messages = all(`SELECT html FROM emails WHERE (? IS NULL OR to_email = ?) ORDER BY id DESC LIMIT 20`, email ?? null, email ?? null);
  const token = messages.map((message) => decryptData(message.html).match(/\/commande\/([A-Za-z0-9_-]{16,64})/)?.[1]).find(Boolean);
  if (!token) throw new Error('Lien de commande absent de la boîte de test.');
  return token;
}

export async function cancelOrder(client, token) {
  const access = await accessOrder(client, token);
  if (access.body?.status === 'paid') {
    await client.request('/api/orders/cancel-code', { method: 'POST' });
    const email = get("SELECT html FROM emails WHERE kind = 'cancellation_code' ORDER BY id DESC LIMIT 1");
    const confirmationCode = email ? decryptData(email.html).match(/\b(\d{6})\b/)?.[1] : null;
    if (!confirmationCode) throw new Error("Code d'annulation absent de la boîte de test.");
    return client.request('/api/orders/cancel', { method: 'POST', body: { confirmationCode } });
  }
  return client.request('/api/orders/cancel', { method: 'POST' });
}

export const stock = (id) => ({ ...get('SELECT quota, sold, held FROM ticket_types WHERE id = ?', id) });

export function signWebhook(payload) {
  return crypto.createHmac('sha256', config.webhookSecret).update(payload).digest('hex');
}
