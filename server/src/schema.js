// Toutes les dates sont stockées en UTC au format ISO 8601 (comparables comme des chaînes).
// Les garanties critiques du cahier des charges sont aussi posées au niveau de la base :
// - CHECK (sold + held <= quota)            -> aucune survente possible (5.2)
// - UNIQUE (provider, provider_payment_id)  -> un paiement = une seule commande (5.3)
// - webhook_events.id PRIMARY KEY            -> une notification traitée une seule fois (5.3)
// - scans.client_scan_id UNIQUE              -> synchronisation hors ligne rejouable (5.7)
// - orders.idempotency_key UNIQUE            -> un double clic ne crée pas deux commandes (5.2)
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS collectives (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '#9a3412',
  iban        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  collective_id  INTEGER REFERENCES collectives(id),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'controller')),
  session_version INTEGER NOT NULL DEFAULT 0,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  login_blocked_until TEXT,
  created_at     TEXT NOT NULL,
  CHECK ((role = 'superadmin') = (collective_id IS NULL))
);

CREATE TABLE IF NOT EXISTS events (
  id                     INTEGER PRIMARY KEY,
  collective_id          INTEGER NOT NULL REFERENCES collectives(id),
  title                  TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  venue                  TEXT NOT NULL DEFAULT '',
  is_online              INTEGER NOT NULL DEFAULT 0,
  online_url             TEXT,
  starts_at              TEXT NOT NULL,
  timezone               TEXT NOT NULL DEFAULT 'Europe/Paris',
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  cancel_deadline_hours  INTEGER NOT NULL DEFAULT 48 CHECK (cancel_deadline_hours >= 0),
  max_per_order          INTEGER NOT NULL DEFAULT 6 CHECK (max_per_order >= 1),
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_collective ON events(collective_id, starts_at);

CREATE TABLE IF NOT EXISTS ticket_types (
  id                 INTEGER PRIMARY KEY,
  event_id           INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  position           INTEGER NOT NULL DEFAULT 0,
  price_cents        INTEGER NOT NULL CHECK (price_cents >= 0),
  quota              INTEGER NOT NULL CHECK (quota >= 0),
  early_price_cents  INTEGER CHECK (early_price_cents IS NULL OR early_price_cents >= 0),
  early_until        TEXT,
  early_quota        INTEGER CHECK (early_quota IS NULL OR early_quota >= 0),
  sold               INTEGER NOT NULL DEFAULT 0,
  held               INTEGER NOT NULL DEFAULT 0,
  early_used         INTEGER NOT NULL DEFAULT 0,
  CHECK (sold >= 0 AND held >= 0 AND sold + held <= quota),
  CHECK (early_used >= 0)
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id              INTEGER PRIMARY KEY,
  event_id        INTEGER NOT NULL REFERENCES events(id),
  ticket_type_id  INTEGER NOT NULL REFERENCES ticket_types(id),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity >= 1),
  locale          TEXT NOT NULL DEFAULT 'fr',
  status          TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'offered', 'converted', 'expired', 'declined')),
  offer_order_id  INTEGER,
  offered_at      TEXT,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_active
  ON waitlist_entries(ticket_type_id, email) WHERE status IN ('waiting', 'offered');
CREATE INDEX IF NOT EXISTS idx_waitlist_queue ON waitlist_entries(ticket_type_id, status, id);

CREATE TABLE IF NOT EXISTS orders (
  id                 INTEGER PRIMARY KEY,
  token              TEXT NOT NULL UNIQUE,
  reference          TEXT NOT NULL UNIQUE,
  event_id           INTEGER NOT NULL REFERENCES events(id),
  collective_id      INTEGER NOT NULL REFERENCES collectives(id),
  buyer_name         TEXT NOT NULL,
  buyer_email        TEXT NOT NULL,
  locale             TEXT NOT NULL DEFAULT 'fr',
  payment_method     TEXT NOT NULL CHECK (payment_method IN ('card', 'transfer')),
  status             TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'refunded')),
  total_cents        INTEGER NOT NULL,
  expires_at         TEXT NOT NULL,
  paid_at            TEXT,
  closed_at          TEXT,
  refund_reason      TEXT,
  waitlist_entry_id  INTEGER REFERENCES waitlist_entries(id),
  idempotency_key    TEXT,
  cancel_code_hash   TEXT,
  cancel_code_expires_at TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_pending ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id, status);

-- Les liens de commande ne sont jamais stockés en clair : seul leur SHA-256 est conservé.
CREATE TABLE IF NOT EXISTS order_access_tokens (
  token_hash  TEXT PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_access_order ON order_access_tokens(order_id, expires_at);

CREATE TABLE IF NOT EXISTS order_items (
  id                INTEGER PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id),
  ticket_type_id    INTEGER NOT NULL REFERENCES ticket_types(id),
  quantity          INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price_cents  INTEGER NOT NULL,
  is_early          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id                   INTEGER PRIMARY KEY,
  order_id             INTEGER NOT NULL REFERENCES orders(id),
  provider             TEXT NOT NULL,
  provider_payment_id  TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount_cents         INTEGER NOT NULL,
  fee_cents            INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  UNIQUE (provider, provider_payment_id, kind)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  result       TEXT,
  received_at  TEXT NOT NULL
);

-- Côté « prestataire de paiement simulé » (remplacé par Stripe & co en production).
CREATE TABLE IF NOT EXISTS mock_provider_sessions (
  id            TEXT PRIMARY KEY,
  order_token   TEXT,
  order_id      INTEGER REFERENCES orders(id),
  amount_cents  INTEGER NOT NULL,
  label         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
  payment_id    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  event_id        INTEGER NOT NULL REFERENCES events(id),
  ticket_type_id  INTEGER NOT NULL REFERENCES ticket_types(id),
  holder_name     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'cancelled')),
  entered_at      TEXT,
  entered_gate    TEXT,
  entered_device  TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);

CREATE TABLE IF NOT EXISTS scans (
  id              INTEGER PRIMARY KEY,
  client_scan_id  TEXT NOT NULL UNIQUE,
  event_id        INTEGER NOT NULL REFERENCES events(id),
  ticket_id       INTEGER REFERENCES tickets(id),
  code            TEXT NOT NULL,
  device_id       TEXT NOT NULL,
  gate            TEXT NOT NULL DEFAULT '',
  user_id         INTEGER REFERENCES users(id),
  scanned_at      TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  offline         INTEGER NOT NULL DEFAULT 0,
  result          TEXT NOT NULL CHECK (result IN ('ok', 'duplicate', 'invalid', 'cancelled', 'wrong_event'))
);
CREATE INDEX IF NOT EXISTS idx_scans_event ON scans(event_id, result);
CREATE INDEX IF NOT EXISTS idx_scans_abuse ON scans(user_id, event_id, device_id, received_at, result);

-- Boîte d'envoi : les corps sont chiffrés par l'application et écrits dans la même
-- transaction que l'action, puis déchiffrés par l'expéditeur (ou /dev en démo).
CREATE TABLE IF NOT EXISTS emails (
  id          INTEGER PRIMARY KEY,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  html        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
`;

// Index créés après les migrations (ils dépendent de colonnes ajoutées en cours de projet).
export const INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idempotency ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
`;

// Colonnes ajoutées après la première version : appliquées aux bases existantes.
export const MIGRATIONS = [
  { table: 'orders', column: 'idempotency_key', definition: 'TEXT' },
  { table: 'orders', column: 'cancel_code_hash', definition: 'TEXT' },
  { table: 'orders', column: 'cancel_code_expires_at', definition: 'TEXT' },
  { table: 'users', column: 'session_version', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'users', column: 'failed_login_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'users', column: 'login_blocked_until', definition: 'TEXT' },
  { table: 'mock_provider_sessions', column: 'order_id', definition: 'INTEGER REFERENCES orders(id)' },
];
