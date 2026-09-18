import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { config } from './config.js';
import { apiNotFound, errorHandler } from './http/errorHandler.js';
import { createRateLimiters, permissionsPolicy, requireCsrfHeader, securityHeaders } from './http/security.js';
import { authRouter, platformRouter } from './routes/accounts.js';
import { adminRouter } from './routes/admin/index.js';
import { devRouter } from './routes/dev.js';
import { mockProviderRouter, webhookRouter } from './routes/payments.js';
import { publicRouter } from './routes/public.js';
import { scanRouter } from './routes/scan.js';

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const JSON_BODY_LIMIT = '512kb';

// Pas de CORS : le front est servi par la même origine (proxy Vite en dev, ce serveur en prod).
// Aucun en-tête Access-Control-* n'est émis, donc aucun autre site ne peut appeler l'API
// avec les cookies de l'utilisateur.
export function createApp({
  devTools = config.devTools,
  mockPayments = config.paymentProvider === 'mock',
  rateLimits = !config.isTest,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders, permissionsPolicy);

  // Le webhook lit le corps brut pour vérifier la signature : il passe avant express.json().
  // Il est authentifié par signature HMAC, pas par cookie : l'en-tête CSRF ne s'applique pas.
  app.use('/api/webhooks', webhookRouter);

  app.use('/api', express.json({ limit: JSON_BODY_LIMIT }), cookieParser(), requireCsrfHeader);
  const limits = createRateLimiters(rateLimits);
  app.use('/api/auth', authRouter(limits));
  app.use('/api/platform', platformRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/scan', scanRouter);
  if (mockPayments) app.use('/api/mock-provider', mockProviderRouter);
  if (devTools) app.use('/api/dev', devRouter);
  app.use('/api', publicRouter(limits));
  app.use('/api', apiNotFound);

  // En production, le serveur sert aussi le front compilé (npm run build).
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
