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
  APP_MODE: 'production',
  NODE_ENV: 'production',
  JWT_SECRET: LONG_SECRET,
  TICKET_SECRET: LONG_SECRET,
  WEBHOOK_SECRET: LONG_SECRET,
  DATA_ENCRYPTION_KEY: LONG_SECRET,
  PUBLIC_URL: 'http://127.0.0.1:3001',
};
const DEMO = {
  APP_MODE: 'demo',
  JWT_SECRET: LONG_SECRET,
  TICKET_SECRET: LONG_SECRET,
  WEBHOOK_SECRET: LONG_SECRET,
  DATA_ENCRYPTION_KEY: LONG_SECRET,
  ENABLE_DEV_TOOLS: 'true',
  ALLOW_DEMO_DATA: 'true',
  PAYMENT_PROVIDER: 'mock',
};

describe('Configuration de production', () => {
  test('APP_MODE absent ou inconnu : refus de démarrer', () => {
    assert.notEqual(loadConfig({ ...PROD, APP_MODE: undefined }).status, 0);
    assert.notEqual(loadConfig({ ...PROD, APP_MODE: 'developpement' }).status, 0);
  });
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

  test('URL ou écoute non locale : refusée, même en HTTPS', () => {
    assert.notEqual(loadConfig({ ...PROD, PUBLIC_URL: 'https://billetterie.exemple.fr' }).status, 0);
    assert.notEqual(loadConfig({ ...PROD, HOST: '0.0.0.0' }).status, 0);
    assert.notEqual(loadConfig({ ...PROD, TRUST_PROXY: '1' }).status, 0);
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

  test('mode démo local accepté, exposition réseau refusée', () => {
    assert.equal(loadConfig({ ...DEMO, HOST: '127.0.0.1' }).status, 0);
    assert.notEqual(loadConfig({ ...DEMO, HOST: '0.0.0.0' }).status, 0);
  });
});
