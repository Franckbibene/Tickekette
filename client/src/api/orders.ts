import type { CheckoutSession, Order } from '../types/api';
import { expectObject, request } from './http';

const encode = encodeURIComponent;

export interface FetchedOrder extends Order {
  // Heure locale de réception : sert à corriger l'horloge du téléphone pour le compte à rebours.
  receivedAt: number;
}

export const ordersApi = {
  access: (token: string, signal?: AbortSignal) =>
    request<Order>('/orders/access', { method: 'POST', body: { token }, signal }).then((o) => ({
      ...expectObject(o, ['reference', 'status', 'event']),
      receivedAt: Date.now(),
    })),
  get: (signal?: AbortSignal) =>
    request<Order>('/orders/current', { signal }).then((o) => ({
      ...expectObject(o, ['reference', 'status', 'event']),
      receivedAt: Date.now(),
    })),
  checkout: () => request<{ redirectUrl: string }>('/orders/checkout', { method: 'POST' }).then((r) => expectObject(r, ['redirectUrl'])),
  requestCancellationCode: () => request<undefined>('/orders/cancel-code', { method: 'POST' }),
  cancel: (confirmationCode?: string) =>
    request<Order>('/orders/cancel', { method: 'POST', body: confirmationCode ? { confirmationCode } : {} }).then((o) => ({
      ...expectObject(o, ['reference', 'status']),
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
