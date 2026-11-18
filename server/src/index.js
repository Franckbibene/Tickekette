import { createApp } from './app.js';
import { config } from './config.js';
import { get, initDb } from './db.js';
import { seedDemo } from './seed.js';
import { sweepExpired } from './services/orders.js';

initDb(config.dbFile);

// Données de démonstration : activation explicite et écoute locale par défaut.
if (config.demoData && !get('SELECT id FROM collectives LIMIT 1')) {
  try {
    seedDemo();
    console.info('Base vide : données de démonstration créées.');
  } catch (err) {
    // `npm run seed` a pu remplir la base au même moment : on garde ses données.
    if (!get('SELECT id FROM collectives LIMIT 1')) throw err;
  }
}

const apiHost = config.host === '::1' ? '[::1]' : config.host;
config.apiUrl ||= `http://${apiHost}:${config.port}`;
createApp().listen(config.port, config.host, () => {
  console.info(`API Tickekette sur ${config.host}:${config.port}`);
});

// Libère régulièrement les réservations non payées expirées (5.2).
setInterval(() => {
  try {
    sweepExpired();
  } catch (err) {
    console.error('Erreur pendant la libération des réservations :', err);
  }
}, config.sweepIntervalMs).unref();
