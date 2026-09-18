import type {
  AdminEvent,
  AdminEventListItem,
  AdminOrder,
  EventInput,
  EventStats,
  OrderStatus,
  TeamMember,
  TeamMemberInput,
  TransferOrder,
  TransferOutcome,
  WaitlistEntry,
} from '../types/api';
import { download, expectArray, expectObject, request } from './http';

export const adminApi = {
  events: (signal?: AbortSignal) => request<AdminEventListItem[]>('/admin/events', { signal }).then(expectArray),
  event: (eventId: number, signal?: AbortSignal) =>
    request<AdminEvent>(`/admin/events/${eventId}`, { signal }).then((e) => expectObject(e, ['id', 'ticketTypes'])),
  createEvent: (input: EventInput) =>
    request<AdminEvent>('/admin/events', { method: 'POST', body: input }).then((e) => expectObject(e, ['id'])),
  updateEvent: (eventId: number, input: EventInput) =>
    request<AdminEvent>(`/admin/events/${eventId}`, { method: 'PUT', body: input }).then((e) => expectObject(e, ['id'])),
  publishEvent: (eventId: number) => request<AdminEvent>(`/admin/events/${eventId}/publish`, { method: 'POST' }),
  cancelEvent: (eventId: number) => request<AdminEvent>(`/admin/events/${eventId}/cancel`, { method: 'POST' }),
  stats: (eventId: number, signal?: AbortSignal) =>
    request<EventStats>(`/admin/events/${eventId}/stats`, { signal }).then((s) => expectObject(s, ['types', 'money', 'alerts'])),
  orders: (eventId: number, status: OrderStatus | '', signal?: AbortSignal) =>
    request<AdminOrder[]>(`/admin/events/${eventId}/orders${status ? `?status=${status}` : ''}`, { signal }).then(expectArray),
  waitlist: (eventId: number, signal?: AbortSignal) =>
    request<WaitlistEntry[]>(`/admin/events/${eventId}/waitlist`, { signal }).then(expectArray),
  downloadParticipants: (eventId: number) => download(`/admin/events/${eventId}/participants.csv`, 'participants.csv'),
  downloadAccounting: () => download('/admin/accounting.csv', 'comptabilite.csv'),
  transfers: (signal?: AbortSignal) => request<TransferOrder[]>('/admin/transfers', { signal }).then(expectArray),
  confirmTransfer: (orderId: number) =>
    request<{ status: TransferOutcome }>(`/admin/orders/${orderId}/confirm-transfer`, { method: 'POST' }).then((r) =>
      expectObject(r, ['status']),
    ),
  team: (signal?: AbortSignal) => request<TeamMember[]>('/admin/users', { signal }).then(expectArray),
  addTeamMember: (input: TeamMemberInput) => request<TeamMember>('/admin/users', { method: 'POST', body: input }),
  removeTeamMember: (userId: number) => request<undefined>(`/admin/users/${userId}`, { method: 'DELETE' }),
};
