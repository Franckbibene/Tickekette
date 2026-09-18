import type { TicketTypeDraft } from '../../utils/eventForm';
import { FIELD_LIMITS } from '../../utils/validation';
import { TextField } from '../forms/Field';

interface Props {
  draft: TicketTypeDraft;
  index: number;
  error?: string;
  canRemove: boolean;
  onChange: (patch: Partial<TicketTypeDraft>) => void;
  onRemove: () => void;
}

export function TicketTypeFields({ draft, index, error, canRemove, onChange, onRemove }: Props) {
  const locked = draft.sold + draft.held > 0;
  return (
    <fieldset className="type-editor stack">
      <legend className="spread type-editor-legend">
        <strong>{draft.name.trim() || `Type n°${index + 1}`}</strong>
      </legend>
      <div className="spread">
        {locked ? (
          <span className="small muted">
            {draft.sold} vendues, {draft.held} réservées : suppression impossible
          </span>
        ) : (
          canRemove && (
            <button type="button" className="btn btn-ghost btn-small" onClick={onRemove}>
              Supprimer ce type
            </button>
          )
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-grid type-grid">
        <TextField
          label="Nom"
          required
          maxLength={FIELD_LIMITS.name}
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <TextField
          label="Prix (€)"
          required
          inputMode="decimal"
          value={draft.price}
          onChange={(e) => onChange({ price: e.target.value })}
        />
        <TextField
          label="Quota"
          required
          type="number"
          min={draft.sold + draft.held}
          max={FIELD_LIMITS.quotaMax}
          value={draft.quota}
          onChange={(e) => onChange({ quota: e.target.value })}
        />
      </div>
      <div className="form-grid type-grid">
        <TextField
          label="Prix early (€)"
          hint="optionnel"
          inputMode="decimal"
          value={draft.earlyPrice}
          onChange={(e) => onChange({ earlyPrice: e.target.value })}
        />
        <TextField
          label="Fin du tarif early"
          type="datetime-local"
          required={draft.earlyPrice.trim() !== ''}
          value={draft.earlyUntil}
          onChange={(e) => onChange({ earlyUntil: e.target.value })}
        />
        <TextField
          label="Quota early"
          hint="vide = illimité"
          type="number"
          min={0}
          value={draft.earlyQuota}
          onChange={(e) => onChange({ earlyQuota: e.target.value })}
        />
      </div>
    </fieldset>
  );
}
