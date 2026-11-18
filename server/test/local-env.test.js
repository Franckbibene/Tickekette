import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { ensureLocalEnv } from '../scripts/ensure-local-env.js';

describe('Initialisation de la configuration locale', () => {
  test('crée quatre secrets aléatoires avec des permissions privées', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tickekette-env-'));
    const envPath = path.join(directory, '.env');

    assert.equal(await ensureLocalEnv(envPath), 'created');
    const contents = await readFile(envPath, 'utf8');
    const secrets = Object.fromEntries(
      contents
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => line.split('=', 2)),
    );

    for (const name of ['JWT_SECRET', 'TICKET_SECRET', 'WEBHOOK_SECRET', 'DATA_ENCRYPTION_KEY']) {
      assert.match(secrets[name], /^[a-f0-9]{64}$/u);
    }
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  });

  test('ne remplace jamais une configuration existante', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tickekette-env-'));
    const envPath = path.join(directory, '.env');
    await writeFile(envPath, 'JWT_SECRET=valeur-a-conserver\n', { mode: 0o644 });

    assert.equal(await ensureLocalEnv(envPath), 'existing');
    assert.equal(await readFile(envPath, 'utf8'), 'JWT_SECRET=valeur-a-conserver\n');
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  });

  test('refuse un lien symbolique à la place du fichier de secrets', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tickekette-env-'));
    const targetPath = path.join(directory, 'target');
    const envPath = path.join(directory, '.env');
    await writeFile(targetPath, 'ne-pas-modifier\n');
    await symlink(targetPath, envPath);

    await assert.rejects(ensureLocalEnv(envPath));
    assert.equal(await readFile(targetPath, 'utf8'), 'ne-pas-modifier\n');
  });
});
