import type { SyncConflict } from '../../hooks/useOfflineScanner';

const SHOWN = 5;

interface Props {
  conflicts: SyncConflict[];
  describeFirst: (entry: SyncConflict['firstEntry']) => string;
  onClear: () => void;
}

export function ConflictAlert({ conflicts, describeFirst, onClear }: Props) {
  if (conflicts.length === 0) return null;
  return (
    <div className="alert alert-error stack" role="alert">
      <strong>{conflicts.length} billet(s) validé(s) à deux portes pendant la coupure réseau</strong>
      <ul className="plain-list">
        {conflicts.slice(0, SHOWN).map((c) => (
          <li key={c.id} className="small">
            {c.holderName ?? 'Billet'} — {describeFirst(c.firstEntry)}
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className="btn btn-small" onClick={onClear}>
          Vu
        </button>
      </div>
    </div>
  );
}
