export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code, message, extra) => new HttpError(400, code, message, extra);
export const unauthorized = (message = 'Connexion requise.') => new HttpError(401, 'unauthenticated', message);
export const forbidden = (message = 'Accès refusé.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Ressource introuvable.') => new HttpError(404, 'not_found', message);
export const conflict = (code, message, extra) => new HttpError(409, code, message, extra);
export const unavailable = (code, message) => new HttpError(503, code, message);
