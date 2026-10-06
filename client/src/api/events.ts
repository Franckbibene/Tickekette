import type { CollectiveRef, EventDetail, EventSummary, OrderRequest, WaitlistRequest } from '../types/api';
import { expectArray, expectObject, request } from './http';

export const eventsApi = {
  list: (collectiveSlug: string | undefined, signal?: AbortSignal) => {
    const query = collectiveSlug ? `?collective=${encodeURIComponent(collectiveSlug)}` : '';
    return request<EventSummary[]>(`/events${query}`, { signal }).then(expectArray);
  },
  get: (eventId: number, signal?: AbortSignal) =>
    request<EventDetail>(`/events/${eventId}`, { signal }).then((e) => expectObject(e, ['id', 'ticketTypes'])),
  collectives: (signal?: AbortSignal) => request<CollectiveRef[]>('/collectives', { signal }).then(expectArray),
  // La clé d'idempotence rend la création rejouable sans doublon (double clic, nouvel essai réseau).
  createOrder: (eventId: number, order: OrderRequest, idempotencyKey: string) =>
    request<{ token: string }>(`/events/${eventId}/orders`, {
      method: 'POST',
      body: order,
      headers: { 'Idempotency-Key': idempotencyKey },
    }).then((r) => expectObject(r, ['token'])),
  // La position n'est pas renvoyée ici : elle part par mail, pour que la réponse ne révèle pas
  // si l'adresse était déjà inscrite (voir services/waitlist.js côté serveur).
  joinWaitlist: (eventId: number, entry: WaitlistRequest) =>
    request<{ registered: boolean }>(`/events/${eventId}/waitlist`, { method: 'POST', body: entry }).then((r) =>
      expectObject(r, ['registered']),
    ),
};
