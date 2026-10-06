import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

// En-têtes HTTP de sécurité, adaptés aux besoins réels de l'application :
// - scripts uniquement depuis notre origine (pas d'inline, pas d'eval) ;
// - 'wasm-unsafe-eval' : nécessaire au décodeur de QR codes (WebAssembly), n'autorise pas eval() ;
// - styles inline autorisés : attributs style de React et HTML des mails de démo ;
// - aucune intégration dans un cadre externe (clickjacking) ;
// - aucun Referer envoyé : les liens de commande contiennent un jeton secret.
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", 'blob:'],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(config.secureCookies ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  // En-tête historique, cohérent avec frame-ancestors 'none'.
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  // HSTS n'a de sens que si l'instance locale est réellement servie en HTTPS.
  strictTransportSecurity: config.secureCookies,
});

// Caméra autorisée pour le contrôle des billets, le reste est coupé.
export function permissionsPolicy(_req, res, next) {
  res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
  next();
}

// Protection CSRF en complément du cookie SameSite=Strict : toute requête qui modifie
// des données doit porter un en-tête personnalisé. Un site tiers ne peut pas l'ajouter
// sans requête CORS préalable, que ce serveur n'autorise pas (aucun en-tête CORS émis).
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'tickekette';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrfHeader(req, _res, next) {
  if (SAFE_METHODS.has(req.method) || req.get(CSRF_HEADER) === CSRF_VALUE) return next();
  throw new HttpError(403, 'csrf', 'Requête refusée.');
}

// Limites de débit par adresse IP, complétées par le délai progressif par compte
// pour l'authentification et par des plafonds compte/appareil pour les scans.
function limiter(windowMinutes, limit, message, keyGenerator) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res) => res.status(429).json({ error: 'rate_limited', message }),
  });
}

export function createRateLimiters(enabled) {
  const pass = (_req, _res, next) => next();
  if (!enabled) return { login: pass, orders: pass, waitlist: pass, checkout: pass, scansUser: pass, scansDevice: pass };
  return {
    login: limiter(15, 10, 'Trop de tentatives de connexion. Réessayez dans quelques minutes.'),
    orders: limiter(10, 20, 'Trop de réservations depuis cette connexion. Réessayez plus tard.'),
    waitlist: limiter(10, 10, 'Trop d’inscriptions depuis cette connexion. Réessayez plus tard.'),
    checkout: limiter(10, 30, 'Trop de tentatives de paiement. Réessayez plus tard.'),
    // Deux plafonds complémentaires : changer artificiellement deviceId ne permet
    // pas de contourner la limite globale du compte pour cet événement.
    scansUser: limiter(
      5,
      120,
      'Trop de synchronisations pour ce compte. Réessayez plus tard.',
      (req) => `${req.user?.id ?? 'anonymous'}:${req.params.id ?? 'none'}`,
    ),
    scansDevice: limiter(
      5,
      40,
      'Trop de synchronisations depuis cet appareil. Réessayez plus tard.',
      (req) => `${req.user?.id ?? 'anonymous'}:${req.params.id ?? 'none'}:${String(req.body?.deviceId ?? '').slice(0, 64)}`,
    ),
  };
}
