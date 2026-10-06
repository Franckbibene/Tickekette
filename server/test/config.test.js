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

// Lit une valeur de configuration dans un processus neuf (config.js lit l'environnement à l'import).
function readConfig(env, expression) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `const { config } = await import('./src/config.js'); console.log(${expression})`],
    { cwd: serverDir, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' },
  ).stdout.trim();
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
    assert.equal(readConfig(PROD, 'config.devTools, config.paymentProvider'), 'false none');
  });

  test('outils de démo : actifs seulement sur demande explicite, jamais en production', () => {
    // Un déploiement qui oublie NODE_ENV ne doit pas exposer les mails ni l'horloge.
    assert.equal(readConfig({}, 'config.devTools'), 'false');
    assert.equal(readConfig({ NODE_ENV: 'staging' }, 'config.devTools'), 'false');
    // Ce que pose `npm run dev` : la démo reste utilisable.
    assert.equal(readConfig({ ENABLE_DEV_TOOLS: 'true' }, 'config.devTools'), 'true');
    // La production reste un verrou indépendant de la variable.
    assert.equal(readConfig({ ...PROD, ENABLE_DEV_TOOLS: 'true' }, 'config.devTools'), 'false');
  });
});
