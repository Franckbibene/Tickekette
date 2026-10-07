// Formes des réponses de l'API. Elles décrivent ce que le serveur promet d'envoyer ;
// la couche api/ vérifie en plus la structure minimale à l'exécution.

export type Role = 'superadmin' | 'admin' | 'controller';

export interface CollectiveRef {
  id?: number;
  name: string;
  slug: string;
  color: string;
}

export interface User {
  id: number;
  name: string;
  role: Role;
  collective: CollectiveRef | null;
}

export type EventStatus = 'draft' | 'published' | 'cancelled';
export type OrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded';
export type PaymentMethod = 'card' | 'transfer';
export type RefundReason = 'buyer_cancelled' | 'event_cancelled' | 'late_payment_sold_out' | 'duplicate_payment' | 'amount_mismatch';
export type WaitlistStatus = 'waiting' | 'offered' | 'converted' | 'expired' | 'declined';

export interface PublicEvent {
  id: number;
  title: string;
  description: string;
  venue: string;
  isOnline: boolean;
  startsAt: string;
  timezone: string;
  status: EventStatus;
  maxPerOrder: number;
  cancelDeadlineHours: number;
  transferAllowed: boolean;
  collective: CollectiveRef;
}

export interface EventSummary extends PublicEvent {
  fromPriceCents: number | null;
  soldOut: boolean;
}

export interface PublicTicketType {
  id: number;
  name: string;
  priceCents: number;
  earlyActive: boolean;
  earlyPriceCents: number | null;
  earlyUntil: string | null;
  earlyRemaining: number | null;
  available: number;
  waitlistCount: number;
}

export interface EventDetail extends PublicEvent {
  salesOpen: boolean;
  ticketTypes: PublicTicketType[];
}

export interface OrderItem {
  ticketTypeName: string;
  quantity: number;
  unitPriceCents: number;
  isEarly: boolean;
}

export interface Ticket {
  code: string;
  qr: string;
  holderName: string;
  ticketTypeName: string;
  status: 'valid' | 'cancelled';
  enteredAt: string | null;
}

export interface Order {
  reference: string;
  status: OrderStatus;
  buyerName: string;
  buyerEmail: string;
  paymentMethod: PaymentMethod;
  totalCents: number;
  expiresAt: string;
  paidAt: string | null;
  refundReason: RefundReason | null;
  isWaitlistOffer: boolean;
  items: OrderItem[];
  event: PublicEvent & { onlineUrl: string | null };
  tickets: Ticket[];
  bank: { iban: string; reference: string } | null;
  canCancel: boolean;
  cancelDeadline: string;
  serverNow: string;
}

export interface OrderRequest {
  buyerName: string;
  buyerEmail: string;
  paymentMethod: PaymentMethod;
  locale: string;
  items: { ticketTypeId: number; quantity: number }[];
}

export interface WaitlistRequest {
  ticketTypeId: number;
  name: string;
  email: string;
  quantity: number;
  locale: string;
}

export interface CheckoutSession {
  id: string;
  label: string;
  amountCents: number;
  status: 'open' | 'paid';
  returnUrl: string;
}

// ---------- Espace organisateur ----------

export interface AdminEventListItem {
  id: number;
  title: string;
  startsAt: string;
  timezone: string;
  status: EventStatus;
  isOnline: boolean;
  venue: string;
  capacity: number;
  sold: number;
  held: number;
  grossCents: number;
}

export interface AdminTicketType {
  id: number;
  name: string;
  priceCents: number;
  quota: number;
  earlyPriceCents: number | null;
  earlyUntil: string | null;
  earlyQuota: number | null;
  sold: number;
  held: number;
  earlyUsed: number;
}

export interface AdminEvent extends PublicEvent {
  onlineUrl: string | null;
  ticketTypes: AdminTicketType[];
}

export interface EventInput {
  title: string;
  description: string;
  venue: string;
  isOnline: boolean;
  onlineUrl: string;
  timezone: string;
  startsAt: string;
  cancelDeadlineHours: number;
  maxPerOrder: number;
  ticketTypes: {
    id: number | null;
    name: string;
    priceCents: number;
    quota: number;
    earlyPriceCents: number | null;
    earlyUntil: string | null;
    earlyQuota: number | null;
  }[];
}

export interface TicketTypeStats {
  id: number;
  name: string;
  quota: number;
  sold: number;
  held: number;
  remaining: number;
  refunded: number;
  entered: number;
  waiting: number;
  grossCents: number;
}

export interface ScanAlert {
  id: number;
  scannedAt: string;
  gate: string;
  deviceId: string;
  offline: boolean;
  holderName: string;
  code: string;
  firstEnteredAt: string;
  firstGate: string | null;
}

export interface EventStats {
  updatedAt: string;
  status: EventStatus;
  types: TicketTypeStats[];
  money: { receivedCents: number; refundedCents: number; grossCents: number; feesCents: number; netCents: number };
  pending: { orders: number; cents: number };
  alerts: ScanAlert[];
}

export interface AdminOrder {
  id: number;
  reference: string;
  buyerName: string;
  buyerEmail: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  totalCents: number;
  createdAt: string;
  expiresAt: string;
  refundReason: RefundReason | null;
  waitlistEntryId: number | null;
  summary: string | null;
}

export interface WaitlistEntry {
  id: number;
  name: string;
  email: string;
  quantity: number;
  status: WaitlistStatus;
  createdAt: string;
  offeredAt: string | null;
  ticketTypeName: string;
  offerExpiresAt: string | null;
}

export interface TransferOrder {
  id: number;
  reference: string;
  buyerName: string;
  buyerEmail: string;
  totalCents: number;
  status: OrderStatus;
  expiresAt: string;
  createdAt: string;
  eventTitle: string;
  timezone: string;
}

export type TransferOutcome =
  'paid' | 'paid_late' | 'refunded_late' | 'refunded_duplicate' | 'refunded_amount_mismatch' | 'already_recorded';

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: Exclude<Role, 'superadmin'>;
}

export interface TeamMemberInput {
  name: string;
  email: string;
  password: string;
  role: Exclude<Role, 'superadmin'>;
}

export interface PlatformCollective {
  id: number;
  name: string;
  slug: string;
  color: string;
  eventsCount: number;
  usersCount: number;
}

export interface CollectiveInput {
  name: string;
  slug: string;
  color: string;
  iban: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

// ---------- Contrôle à l'entrée ----------

export interface ScanEvent {
  id: number;
  title: string;
  startsAt: string;
  timezone: string;
  venue: string;
  isOnline: boolean;
}

export interface ManifestTicket {
  code: string;
  ticketTypeId: number;
  holderName: string;
  status: 'valid' | 'cancelled';
  enteredAt: string | null;
  enteredGate: string | null;
  reference: string;
}

export interface Manifest {
  event: { id: number; title: string; startsAt: string; timezone: string; venue: string };
  ticketTypes: { id: number; name: string }[];
  tickets: ManifestTicket[];
  generatedAt: string;
  offlineGrant: string;
  offlineExpiresAt: string;
}

export type ScanOutcome = 'ok' | 'duplicate' | 'invalid' | 'cancelled' | 'wrong_event';

export interface ScanResponse {
  clientScanId: string;
  result: ScanOutcome;
  scannedAt: string;
  ticket: { code: string; holderName: string; ticketTypeId: number; ticketTypeName: string; reference: string } | null;
  firstEntry: { at: string; gate: string | null } | null;
}

export interface PendingScan {
  clientScanId: string;
  text: string;
  code: string;
  scannedAt: string;
  gate: string;
}

export interface SyncResponse {
  results: ScanResponse[];
  entries: { code: string; enteredAt: string; enteredGate: string | null }[];
  syncedAt: string;
}

// ---------- Outils de démonstration ----------

export interface MailSummary {
  id: number;
  to: string;
  subject: string;
  kind: string;
  createdAt: string;
}

export interface Mail extends MailSummary {
  html: string;
}

export interface ClockState {
  now: string;
  offsetMinutes: number;
}
