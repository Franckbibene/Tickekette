// Types partagés du serveur (utilisés via JSDoc par la vérification checkJs).

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: 'superadmin' | 'admin' | 'controller';
  collective_id: number | null;
  session_version: number;
  mfa_enabled: number;
}

declare global {
  namespace Express {
    interface Request {
      // Renseigné par requireAuth() à partir du cookie de session vérifié.
      user?: SessionUser;
      mfaUser?: any;
      order?: any;
    }
  }
}
