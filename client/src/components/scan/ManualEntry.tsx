import { useState, type SubmitEvent } from 'react';
import type { Manifest } from '../../types/api';
import { searchTickets } from '../../utils/scanDecision';

const MAX_INPUT_LENGTH = 200;

interface Props {
  manifest: Manifest | null;
  typeName: (id: number) => string;
  onSubmitCode: (text: string) => void;
  onPickTicket: (code: string) => void;
}

// Secours quand le QR code est illisible : recherche par nom, référence ou code.
export function ManualEntry({ manifest, typeName, onSubmitCode, onPickTicket }: Props) {
  const [query, setQuery] = useState('');
  const matches = searchTickets(manifest, query);

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = query.trim();
    if (value) onSubmitCode(value);
    setQuery('');
  }

  return (
    <form className="card stack" onSubmit={submit} role="search">
      <div className="field">
        <label htmlFor="manual-entry">Saisie manuelle</label>
        <input
          id="manual-entry"
          value={query}
          maxLength={MAX_INPUT_LENGTH}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom, référence TKK-… ou code du billet"
          autoComplete="off"
          autoCapitalize="off"
        />
      </div>
      {matches.length > 0 && (
        <ul className="search-results plain-list" aria-label="Billets trouvés">
          {matches.map((ticket) => (
            <li key={ticket.code}>
              <button
                type="button"
                className="btn btn-small btn-block spread-button"
                onClick={() => {
                  onPickTicket(ticket.code);
                  setQuery('');
                }}
              >
                <span>
                  {ticket.holderName} · {typeName(ticket.ticketTypeId)}
                </span>
                <span className="small muted">
                  {ticket.status !== 'valid' ? 'annulé' : ticket.enteredAt ? 'déjà entré' : ticket.reference}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
