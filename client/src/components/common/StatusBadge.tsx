import type { EventStatus, OrderStatus, WaitlistStatus } from '../../types/api';

type Tone = '' | 'badge-good' | 'badge-warn' | 'badge-bad' | 'badge-info';

const ORDER_LABELS: Record<OrderStatus, [string, Tone]> = {
  pending: ['En attente de paiement', 'badge-warn'],
  paid: ['Payée', 'badge-good'],
  expired: ['Expirée', ''],
  cancelled: ['Abandonnée', ''],
  refunded: ['Remboursée', 'badge-info'],
};

const EVENT_LABELS: Record<EventStatus, [string, Tone]> = {
  draft: ['Brouillon', ''],
  published: ['En vente', 'badge-good'],
  cancelled: ['Annulé', 'badge-bad'],
};

const WAITLIST_LABELS: Record<WaitlistStatus, [string, Tone]> = {
  waiting: ['En attente', 'badge-warn'],
  offered: ['Place proposée', 'badge-info'],
  converted: ['A acheté', 'badge-good'],
  expired: ['Délai dépassé', ''],
  declined: ['A refusé', ''],
};

function Badge({ entry: [label, tone] }: { entry: [string, Tone] }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge entry={ORDER_LABELS[status]} />;
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge entry={EVENT_LABELS[status]} />;
}

export function WaitlistStatusBadge({ status }: { status: WaitlistStatus }) {
  return <Badge entry={WAITLIST_LABELS[status]} />;
}
