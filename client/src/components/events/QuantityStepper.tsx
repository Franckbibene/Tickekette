interface Props {
  value: number;
  max: number;
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number) => void;
}

// Sélecteur de quantité borné entre 0 et `max`.
export function QuantityStepper({ value, max, label, decreaseLabel, increaseLabel, onChange }: Props) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 0} aria-label={decreaseLabel}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={increaseLabel}>
        +
      </button>
    </div>
  );
}
