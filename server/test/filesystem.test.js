import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { initDb } from '../src/db.js';

test('SQLite impose un répertoire 0700 et des fichiers 0600', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tickekette-permissions-'));
  const file = path.join(directory, 'data', 'test.db');
  try {
    initDb(file);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
      if (fs.existsSync(candidate)) assert.equal(fs.statSync(candidate).mode & 0o777, 0o600, candidate);
    }
  } finally {
    initDb(':memory:');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
