import { all, get, run, tx } from '../db.js';
import { clock } from '../clock.js';
import { parseScannedText } from './tickets.js';

const ticketByCode = (code) =>
  get(
    `SELECT t.*, tt.name AS ticket_type_name, o.reference FROM tickets t
     JOIN ticket_types tt ON tt.id = t.ticket_type_id
     JOIN orders o ON o.id = t.order_id
     WHERE t.code = ?`,
    code,
  );

function normalizeScanTime(value) {
  const t = Date.parse(value);
  const now = clock.now().getTime();
  // Horodatage du téléphone : accepté s'il est plausible (ni futur, ni vieux de plus de 24 h).
  return Number.isFinite(t) && t <= now + 60_000 && t >= now - 86_400_000 ? new Date(t).toISOString() : clock.nowIso();
}

// Enregistre un passage à l'entrée. Rejouable : un même clientScanId renvoie le même résultat
// (le téléphone peut renvoyer sa file d'attente sans risque après une coupure).
// Règle (5.7) : le premier scan enregistré par le serveur fait foi, les suivants sont des doublons.
// Deux téléphones hors ligne peuvent tous deux laisser entrer le même billet : le conflit
// est alors détecté à la synchronisation et remonté comme alerte dans le tableau de bord.
export function recordScan({ eventId, text, deviceId, gate = '', clientScanId, scannedAt, offline = false, userId }) {
  return tx(() => {
    const previous = get('SELECT * FROM scans WHERE client_scan_id = ?', clientScanId);
    if (previous) return describeScan(previous);

    const { code, forged } = parseScannedText(text);
    const ticket = code && !forged ? ticketByCode(code) : null;
    const at = normalizeScanTime(scannedAt);
    let result;
    if (!ticket) result = 'invalid';
    else if (ticket.event_id !== eventId) result = 'wrong_event';
    else if (ticket.status !== 'valid') result = 'cancelled';
    else if (ticket.entered_at) result = 'duplicate';
    else {
      result = 'ok';
      run('UPDATE tickets SET entered_at = ?, entered_gate = ?, entered_device = ? WHERE id = ?', at, gate, deviceId, ticket.id);
    }
    const { lastInsertRowid } = run(
      `INSERT INTO scans (client_scan_id, event_id, ticket_id, code, device_id, gate, user_id, scanned_at, received_at, offline, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clientScanId,
      eventId,
      ticket?.id ?? null,
      code ?? String(text ?? '').slice(0, 64),
      deviceId,
      gate,
      userId ?? null,
      at,
      clock.nowIso(),
      offline ? 1 : 0,
      result,
    );
    return describeScan(get('SELECT * FROM scans WHERE id = ?', Number(lastInsertRowid)));
  });
}

function describeScan(scan) {
  const ticket = scan.ticket_id ? ticketByCode(scan.code) : null;
  return {
    clientScanId: scan.client_scan_id,
    result: scan.result,
    scannedAt: scan.scanned_at,
    ticket: ticket && {
      code: ticket.code,
      holderName: ticket.holder_name,
      ticketTypeId: ticket.ticket_type_id,
      ticketTypeName: ticket.ticket_type_name,
      reference: ticket.reference,
    },
    firstEntry: ticket?.entered_at ? { at: ticket.entered_at, gate: ticket.entered_gate } : null,
  };
}

// Liste téléchargée par les téléphones avant l'ouverture des portes (fonctionnement hors ligne).
export function manifest(eventId) {
  return all(
    `SELECT t.code, t.ticket_type_id AS ticketTypeId, t.holder_name AS holderName, t.status,
            t.entered_at AS enteredAt, t.entered_gate AS enteredGate, o.reference
     FROM tickets t JOIN orders o ON o.id = t.order_id
     WHERE t.event_id = ? ORDER BY t.holder_name, t.id`,
    eventId,
  );
}

export const entriesOf = (eventId) =>
  all(
    `SELECT code, entered_at AS enteredAt, entered_gate AS enteredGate FROM tickets
     WHERE event_id = ? AND entered_at IS NOT NULL`,
    eventId,
  );
