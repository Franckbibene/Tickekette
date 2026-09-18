import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { adminRouter } from './routes/admin.js';
import { authRouter, platformRouter } from './routes/accounts.js';
import { devRouter } from './routes/dev.js';
import { mockProviderRouter, webhookRouter } from './routes/payments.js';
import { publicRouter } from './routes/public.js';
import { scanRouter } from './routes/scan.js';

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));

export function createApp({ devTools = !config.isProduction } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Le webhook lit le corps brut pour vérifier la signature : il passe avant express.json().
  app.use('/api/webhooks', webhookRouter);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth', authRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/scan', scanRouter);
  app.use('/api/mock-provider', mockProviderRouter);
  if (devTools) app.use('/api/dev', devRouter);
  app.use('/api', publicRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Route inconnue.' }));

  // En production, le serveur sert aussi le front compilé (npm run build).
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'Requête invalide.' });
    }
    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Erreur interne, réessayez.' });
  });

  return app;
}
