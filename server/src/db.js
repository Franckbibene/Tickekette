import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decryptData, encryptData, isEncryptedData } from './dataEncryption.js';
import { INDEXES, MIGRATIONS, SCHEMA } from './schema.js';

// Accès à la base : uniquement des requêtes préparées avec paramètres liés.
// Aucune valeur venant de l'utilisateur n'est concaténée dans le SQL.

let db = null;
const statements = new Map();
// Seule interpolation de la base : noms de table/colonne constants de MIGRATIONS (jamais de saisie).
let depth = 0;

function migrate() {
  for (const { table, column, definition } of MIGRATIONS) {
    const exists = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const orderTokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Migration des anciens jetons en clair vers une table de condensats. La colonne historique
// reste présente pour compatibilité SQLite, mais ne contient plus de capacité utilisable.
function migrateOrderTokens() {
  const rows = db
    .prepare(
      `SELECT o.id, o.token, o.created_at, e.starts_at FROM orders o
       JOIN events e ON e.id = o.event_id WHERE o.token NOT LIKE 'retired:%'`,
    )
    .all();
  const add = db.prepare('INSERT OR IGNORE INTO order_access_tokens (token_hash, order_id, expires_at, created_at) VALUES (?, ?, ?, ?)');
  const retire = db.prepare('UPDATE orders SET token = ? WHERE id = ?');
  for (const row of rows) {
    const expiresAt = new Date(Math.max(Date.parse(row.starts_at) + 30 * 86_400_000, Date.now() + 86_400_000)).toISOString();
    add.run(orderTokenHash(row.token), row.id, expiresAt, row.created_at);
    retire.run(`retired:${row.id}`, row.id);
  }
}

function migrateEmailBodies() {
  const update = db.prepare('UPDATE emails SET html = ? WHERE id = ?');
  for (const row of db.prepare('SELECT id, html FROM emails').all()) {
    if (isEncryptedData(row.html)) decryptData(row.html);
    else update.run(encryptData(row.html), row.id);
  }
  // Une mauvaise clé doit empêcher le démarrage, pas rendre la MFA inutilisable
  // silencieusement au prochain login.
  for (const row of db.prepare('SELECT mfa_secret_enc FROM users WHERE mfa_secret_enc IS NOT NULL').all()) {
    decryptData(row.mfa_secret_enc);
  }
}

function restrictDbFiles(file) {
  if (file === ':memory:') return;
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    if (fs.existsSync(candidate)) fs.chmodSync(candidate, 0o600);
  }
}

export function initDb(file) {
  if (db) db.close();
  statements.clear();
  depth = 0;
  if (file !== ':memory:') {
    // Les futurs WAL, SHM, exports temporaires et sauvegardes créés par ce processus
    // héritent d'un mode privé. DB_FILE doit donc pointer vers un répertoire dédié.
    process.umask(0o077);
    const directory = path.dirname(file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const handle = fs.openSync(file, 'a', 0o600);
    fs.closeSync(handle);
    fs.chmodSync(file, 0o600);
  }
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate();
  migrateOrderTokens();
  migrateEmailBodies();
  db.exec(INDEXES);
  restrictDbFiles(file);
  return db;
}

function stmt(sql) {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

export const get = (sql, ...params) => stmt(sql).get(...params);
export const all = (sql, ...params) => stmt(sql).all(...params);
export const run = (sql, ...params) => stmt(sql).run(...params);

// Transaction synchrone. BEGIN IMMEDIATE prend le verrou d'écriture dès le début :
// deux achats simultanés sont forcément traités l'un après l'autre.
// Les appels imbriqués rejoignent la transaction englobante.
export function tx(fn) {
  if (depth > 0) {
    depth++;
    try {
      return fn();
    } finally {
      depth--;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  depth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth = 0;
  }
}
