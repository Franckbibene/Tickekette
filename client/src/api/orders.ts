import type { CheckoutSession, Order } from '../types/api';
import { expectObject, request } from './http';

const encode = encodeURIComponent;

export interface FetchedOrder extends Order {
  // Heure locale de réception : sert à corriger l'horloge du téléphone pour le compte à rebours.
  receivedAt: number;
}

export const ordersApi = {
  get: (token: string, signal?: AbortSignal) =>
    request<Order>(`/orders/${encode(token)}`, { signal }).then((o) => ({
      ...expectObject(o, ['token', 'status', 'event']),
      receivedAt: Date.now(),
    })),
  checkout: (token: string) =>
    request<{ redirectUrl: string }>(`/orders/${encode(token)}/checkout`, { method: 'POST' }).then((r) => expectObject(r, ['redirectUrl'])),
  cancel: (token: string) =>
    request<Order>(`/orders/${encode(token)}/cancel`, { method: 'POST' }).then((o) => ({
      ...expectObject(o, ['token', 'status']),
      receivedAt: Date.now(),
    })),
};

// Prestataire de paiement simulé (démo uniquement, désactivé en production côté serveur).
export const mockPaymentApi = {
  session: (sessionId: string, signal?: AbortSignal) =>
    request<CheckoutSession>(`/mock-provider/sessions/${encode(sessionId)}`, { signal }).then((s) =>
      expectObject(s, ['id', 'amountCents', 'returnUrl']),
    ),
  pay: (sessionId: string, duplicateNotification: boolean) =>
    request<{ returnUrl: string }>(`/mock-provider/sessions/${encode(sessionId)}/pay`, {
      method: 'POST',
      body: { duplicateNotification },
    }).then((r) => expectObject(r, ['returnUrl'])),
};
