import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
}

// Champ de formulaire accessible : libellé associé (htmlFor), aide et erreur reliées
// au champ (aria-describedby), champ invalide signalé (aria-invalid), obligatoire annoncé.
function useFieldIds(error?: string, hint?: ReactNode) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return { id, hintId, errorId, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined };
}

function FieldShell({
  id,
  hintId,
  errorId,
  label,
  hint,
  error,
  required,
  children,
}: FieldShellProps & ReturnType<typeof useFieldIds> & { children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="required-mark" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {hint && (
        <span id={hintId} className="hint">
          {hint}
        </span>
      )}
      {children}
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

type TextFieldProps = FieldShellProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export function TextField({ label, hint, error, required, ...inputProps }: TextFieldProps) {
  const ids = useFieldIds(error, hint);
  return (
    <FieldShell {...ids} label={label} hint={hint} error={error} required={required}>
      <input id={ids.id} required={required} aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} {...inputProps} />
    </FieldShell>
  );
}

type TextAreaFieldProps = FieldShellProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

export function TextAreaField({ label, hint, error, required, ...props }: TextAreaFieldProps) {
  const ids = useFieldIds(error, hint);
  return (
    <FieldShell {...ids} label={label} hint={hint} error={error} required={required}>
      <textarea id={ids.id} required={required} aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} {...props} />
    </FieldShell>
  );
}

type SelectFieldProps = FieldShellProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>;

export function SelectField({ label, hint, error, required, children, ...props }: SelectFieldProps) {
  const ids = useFieldIds(error, hint);
  return (
    <FieldShell {...ids} label={label} hint={hint} error={error} required={required}>
      <select id={ids.id} required={required} aria-invalid={error ? true : undefined} aria-describedby={ids.describedBy} {...props}>
        {children}
      </select>
    </FieldShell>
  );
}
