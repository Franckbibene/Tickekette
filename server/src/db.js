import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

let db = null;
const statements = new Map();
let depth = 0;

export function initDb(file) {
  if (db) db.close();
  statements.clear();
  depth = 0;
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
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
