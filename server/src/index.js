import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config.js';
import { get, initDb } from './db.js';
import { seedDemo } from './seed.js';
import { sweepExpired } from './services/sales.js';

fs.mkdirSync(config.dataDir, { recursive: true });
initDb(config.dbFile);
if (!get('SELECT id FROM collectives LIMIT 1')) {
  try {
    seedDemo();
    console.log('Base vide : données de démonstration créées.');
  } catch (err) {
    // `npm run seed` a pu remplir la base au même moment : on garde ses données.
    if (!get('SELECT id FROM collectives LIMIT 1')) throw err;
  }
}

config.apiUrl ||= `http://localhost:${config.port}`;
const app = createApp();
app.listen(config.port, () => {
  console.log(`API Tickekette sur http://localhost:${config.port}`);
});

// Libère régulièrement les réservations non payées expirées (5.2).
setInterval(() => {
  try {
    sweepExpired();
  } catch (err) {
    console.error('Erreur pendant la libération des réservations :', err);
  }
}, config.sweepIntervalMs).unref();
