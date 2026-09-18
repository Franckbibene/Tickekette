import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { clock } from './clock.js';
import { all, get, initDb, run, tx } from './db.js';
import { hashPassword } from './auth.js';
import { createOrder } from './services/orders.js';
import { recordPayment } from './services/payments.js';
import { joinWaitlist } from './services/waitlist.js';
import { recordScan } from './services/scans.js';

export const DEMO_PASSWORD = 'demo1234';

const FIRST = [
  'Camille',
  'Léa',
  'Hugo',
  'Inès',
  'Lucas',
  'Manon',
  'Nathan',
  'Chloé',
  'Yanis',
  'Sarah',
  'Théo',
  'Jade',
  'Rayan',
  'Louise',
  'Malik',
  'Zoé',
];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Garcia', 'Nguyen', 'Diallo', 'Moreau', 'Laurent', 'Lefèvre', 'Roux', 'Fournier', 'Benali'];

function dayAt(days, utcHour, utcMinute = 0) {
  const d = clock.now();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(utcHour, utcMinute, 0, 0);
  return d.toISOString();
}

function insertCollective(name, slug, color, iban) {
  return Number(
    run('INSERT INTO collectives (name, slug, color, iban, created_at) VALUES (?, ?, ?, ?, ?)', name, slug, color, iban, clock.nowIso())
      .lastInsertRowid,
  );
}

function insertUser(collectiveId, email, name, role) {
  run(
    'INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    collectiveId,
    email,
    hashPassword(DEMO_PASSWORD),
    name,
    role,
    clock.nowIso(),
  );
}

function insertEvent(collectiveId, e, types) {
  const id = Number(
    run(
      `INSERT INTO events (collective_id, title, description, venue, is_online, online_url, starts_at, timezone, status,
         cancel_deadline_hours, max_per_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      collectiveId,
      e.title,
      e.description,
      e.venue ?? '',
      e.online ? 1 : 0,
      e.onlineUrl ?? null,
      e.startsAt,
      e.timezone ?? 'Europe/Paris',
      e.status ?? 'published',
      e.cancelDeadlineHours ?? 48,
      e.maxPerOrder ?? 6,
      clock.nowIso(),
    ).lastInsertRowid,
  );
  types.forEach((t, i) =>
    run(
      `INSERT INTO ticket_types (event_id, name, position, price_cents, quota, early_price_cents, early_until, early_quota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      t.name,
      i,
      t.price,
      t.quota,
      t.earlyPrice ?? null,
      t.earlyUntil ?? null,
      t.earlyQuota ?? null,
    ),
  );
  return { id, types: all('SELECT id, name FROM ticket_types WHERE event_id = ? ORDER BY position', id) };
}

let buyerIndex = 0;
function buyer() {
  const first = FIRST[buyerIndex % FIRST.length];
  const last = LAST[Math.floor(buyerIndex / FIRST.length) % LAST.length];
  buyerIndex++;
  return {
    buyerName: `${first} ${last}`,
    buyerEmail: `${first}.${last}.${buyerIndex}@exemple.test`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''),
  };
}

const reserve = (eventId, ticketTypeId, quantity, method) =>
  createOrder(eventId, { ...buyer(), paymentMethod: method, items: [{ ticketTypeId, quantity }] }).order;

function sell(eventId, ticketTypeId, quantity, method = 'card') {
  const order = reserve(eventId, ticketTypeId, quantity, method);
  recordPayment(order.id, {
    provider: method === 'card' ? 'mockpay' : 'transfer',
    providerPaymentId: `seed_${order.reference}`,
    amountCents: order.total_cents,
    feeCents: method === 'card' ? Math.round(order.total_cents * 0.014) + 25 : 0,
  });
  return order;
}

export function seedDemo() {
  buyerIndex = 0;
  tx(() => {
    run(
      "INSERT INTO users (collective_id, email, password_hash, name, role, created_at) VALUES (NULL, 'super@tickekette.test', ?, 'Équipe plateforme', 'superadmin', ?)",
      hashPassword(DEMO_PASSWORD),
      clock.nowIso(),
    );

    const nuits = insertCollective('Les Nuits de la Garonne', 'nuits-garonne', '#9a3412', 'FR76 3000 4000 0500 0012 3456 789');
    insertUser(nuits, 'admin@nuits.test', 'Margaux (Nuits de la Garonne)', 'admin');
    insertUser(nuits, 'controle@nuits.test', 'Bénévole entrée', 'controller');

    const bassins = insertCollective('Collectif Bassins', 'bassins', '#0f766e', 'FR76 1027 8022 0000 0202 1880 144');
    insertUser(bassins, 'admin@bassins.test', 'Admin Bassins', 'admin');

    const ondes = insertCollective('Ondes Lointaines', 'ondes-lointaines', '#4338ca', 'FR76 1470 7000 0100 1234 5678 910');
    insertUser(ondes, 'admin@ondes.test', 'Admin Ondes', 'admin');

    const rocher = insertEvent(
      nuits,
      {
        title: 'Nuit Garonne #12 — Concert au Rocher',
        description: 'Trois groupes de la scène bordelaise, ouverture des portes à 20 h.',
        venue: 'Le Rocher de Palmer, Cenon',
        startsAt: dayAt(30, 19, 30),
      },
      [
        { name: 'Fosse', price: 2200, quota: 450, earlyPrice: 1600, earlyUntil: dayAt(10, 22), earlyQuota: 100 },
        { name: 'Balcon', price: 2800, quota: 150 },
      ],
    );
    for (let i = 0; i < 18; i++) sell(rocher.id, rocher.types[0].id, 1 + (i % 4));
    for (let i = 0; i < 9; i++) sell(rocher.id, rocher.types[1].id, 2);
    reserve(rocher.id, rocher.types[1].id, 2, 'transfer');
    reserve(rocher.id, rocher.types[0].id, 4, 'transfer');

    const darwin = insertEvent(
      nuits,
      {
        title: 'Soirée Darwin — DJ set',
        description: 'Warehouse party sur la rive droite. VIP : accès mezzanine et vestiaire.',
        venue: 'Darwin, Bordeaux',
        startsAt: dayAt(5, 20),
        maxPerOrder: 4,
      },
      [
        { name: 'Standard', price: 1200, quota: 60 },
        { name: 'VIP', price: 2500, quota: 6 },
      ],
    );
    for (let i = 0; i < 10; i++) sell(darwin.id, darwin.types[0].id, 2);
    const vipOrders = [sell(darwin.id, darwin.types[1].id, 2), sell(darwin.id, darwin.types[1].id, 4)];
    joinWaitlist(darwin.id, { ticketTypeId: darwin.types[1].id, name: 'Anaïs Ferrand', email: 'anais@exemple.test', quantity: 2 });
    joinWaitlist(darwin.id, { ticketTypeId: darwin.types[1].id, name: 'Karim Haddad', email: 'karim@exemple.test', quantity: 1 });

    const tonight = insertEvent(
      nuits,
      {
        title: 'Apéro-concert du quai',
        description: 'Concert acoustique en plein air. Événement du jour, pour tester le contrôle à l’entrée.',
        venue: 'Hangar 14, quai des Chartrons',
        startsAt: new Date(clock.now().getTime() + 3 * 3_600_000).toISOString(),
        cancelDeadlineHours: 24,
      },
      [
        { name: 'Standard', price: 1000, quota: 60 },
        { name: 'Balcon', price: 1500, quota: 20 },
      ],
    );
    const tonightOrders = [];
    for (let i = 0; i < 12; i++) tonightOrders.push(sell(tonight.id, tonight.types[i % 3 === 0 ? 1 : 0].id, 1 + (i % 3)));
    // Quelques personnes sont déjà entrées.
    for (const order of tonightOrders.slice(0, 4)) {
      for (const t of all('SELECT code FROM tickets WHERE order_id = ?', order.id)) {
        recordScan({
          eventId: tonight.id,
          text: t.code,
          deviceId: 'seed',
          gate: 'Entrée principale',
          clientScanId: `seed-${t.code}`,
          scannedAt: clock.nowIso(),
        });
      }
    }

    insertEvent(
      nuits,
      {
        title: 'Festival de printemps (brouillon)',
        description: 'Deux jours, deux scènes.',
        venue: 'Parc aux Angéliques',
        startsAt: dayAt(120, 16),
        status: 'draft',
      },
      [
        { name: 'Pass 1 jour', price: 3000, quota: 400 },
        { name: 'Pass 2 jours', price: 5000, quota: 200 },
      ],
    );

    const club = insertEvent(
      bassins,
      {
        title: 'Bassins Club — Techno aux Bassins à flot',
        description: 'Soirée du Collectif Bassins.',
        venue: 'Les Bassins à flot, Bordeaux',
        startsAt: dayAt(12, 21),
      },
      [
        { name: 'Standard', price: 1500, quota: 250 },
        { name: 'VIP', price: 3500, quota: 40 },
      ],
    );
    for (let i = 0; i < 7; i++) sell(club.id, club.types[i % 2].id, 2);

    const live = insertEvent(
      ondes,
      {
        title: 'Session live Bordeaux ↔ Montréal',
        description: 'Concert diffusé en direct depuis Bordeaux, avec des artistes à Montréal. Horaires affichés dans votre fuseau.',
        online: true,
        onlineUrl: 'https://live.exemple.test/session-bdx-mtl',
        startsAt: dayAt(9, 18),
        timezone: 'Europe/Paris',
        cancelDeadlineHours: 2,
      },
      [
        { name: 'Accès live', price: 800, quota: 500 },
        { name: 'Live + replay', price: 1200, quota: 300 },
      ],
    );
    for (let i = 0; i < 5; i++) sell(live.id, live.types[i % 2].id, 1);

    // La boîte mail de démo ne garde que les mails utiles au scénario du README :
    // billets VIP de la Soirée Darwin (pour annuler une commande) et inscriptions en liste d'attente.
    const keep = [...vipOrders.map((o) => o.buyer_email), 'anais@exemple.test', 'karim@exemple.test'];
    run(`DELETE FROM emails WHERE to_email NOT IN (${keep.map(() => '?').join(', ')})`, ...keep);
  });
}

// `npm run seed` : repart d'une base neuve (comptes de démo : interdit en production).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (config.isProduction) throw new Error('Le jeu de données de démonstration ne peut pas être chargé en production.');
  fs.mkdirSync(config.dataDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbFile + suffix, { force: true });
  initDb(config.dbFile);
  seedDemo();
  const { n } = get('SELECT COUNT(*) AS n FROM tickets');
  console.info(`Base de démonstration créée (${n} billets). Mot de passe des comptes de démo : voir README.`);
}
