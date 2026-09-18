export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code, message, extra) => new HttpError(400, code, message, extra);
export const notFound = (message = 'Ressource introuvable.') => new HttpError(404, 'not_found', message);
export const conflict = (code, message, extra) => new HttpError(409, code, message, extra);
