import type { ClockState, Mail, MailSummary } from '../types/api';
import { expectArray, expectObject, request } from './http';

// Outils de démonstration (désactivés côté serveur en production).
export const devToolsApi = {
  emails: (signal?: AbortSignal) => request<MailSummary[]>('/dev/emails', { signal }).then(expectArray),
  email: (id: number, signal?: AbortSignal) => request<Mail>(`/dev/emails/${id}`, { signal }).then((m) => expectObject(m, ['id', 'html'])),
  clock: (signal?: AbortSignal) => request<ClockState>('/dev/clock', { signal }),
  advanceClock: (minutes: number) => request<ClockState>('/dev/clock/advance', { method: 'POST', body: { minutes } }),
  resetClock: () => request<ClockState>('/dev/clock/reset', { method: 'POST' }),
};
