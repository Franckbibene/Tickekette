import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { get, initDb } from './db.js';
import { seedDemo } from './seed.js';
import { sweepExpired } from './services/orders.js';

fs.mkdirSync(config.dataDir, { recursive: true });
initDb(config.dbFile);

// Données de démonstration : uniquement hors production, et seulement si la base est vide.
if (!config.isProduction && !get('SELECT id FROM collectives LIMIT 1')) {
  try {
    seedDemo();
    console.info('Base vide : données de démonstration créées.');
  } catch (err) {
    // `npm run seed` a pu remplir la base au même moment : on garde ses données.
    if (!get('SELECT id FROM collectives LIMIT 1')) throw err;
  }
}

config.apiUrl ||= `http://localhost:${config.port}`;
createApp().listen(config.port, () => {
  console.info(`API Tickekette sur le port ${config.port}`);
  // Signal visible : ces routes livrent les mails (adresses, liens de commande) sans authentification.
  if (config.devTools) console.warn('⚠ Outils de démonstration actifs sur /api/dev — ne jamais exposer ce serveur publiquement.');
});

// Libère régulièrement les réservations non payées expirées (5.2).
setInterval(() => {
  try {
    sweepExpired();
  } catch (err) {
    console.error('Erreur pendant la libération des réservations :', err);
  }
}, config.sweepIntervalMs).unref();
