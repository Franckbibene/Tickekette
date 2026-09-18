// Configuration de production : refuse de démarrer dans un état dangereux.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const LONG_SECRET = 'x'.repeat(40);

function loadConfig(env) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config.js')"], {
    cwd: serverDir,
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
}

const PROD = {
  NODE_ENV: 'production',
  JWT_SECRET: LONG_SECRET,
  TICKET_SECRET: LONG_SECRET,
  WEBHOOK_SECRET: LONG_SECRET,
  PUBLIC_URL: 'https://billetterie.exemple.fr',
};

describe('Configuration de production', () => {
  test('configuration complète : démarre', () => {
    assert.equal(loadConfig(PROD).status, 0);
  });

  test('secret manquant ou trop court : refus de démarrer', () => {
    assert.notEqual(loadConfig({ ...PROD, JWT_SECRET: undefined }).status, 0);
    assert.notEqual(loadConfig({ ...PROD, TICKET_SECRET: 'court' }).status, 0);
  });

  test('prestataire de paiement simulé : interdit', () => {
    assert.notEqual(loadConfig({ ...PROD, PAYMENT_PROVIDER: 'mock' }).status, 0);
  });

  test('URL publique en HTTP : interdite', () => {
    assert.notEqual(loadConfig({ ...PROD, PUBLIC_URL: 'http://billetterie.exemple.fr' }).status, 0);
  });

  test('outils de démo et paiement simulé désactivés par défaut', () => {
    const res = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const { config } = await import('./src/config.js'); console.log(config.devTools, config.paymentProvider)",
      ],
      { cwd: serverDir, env: { PATH: process.env.PATH, ...PROD }, encoding: 'utf8' },
    );
    assert.equal(res.stdout.trim(), 'false none');
  });
});
