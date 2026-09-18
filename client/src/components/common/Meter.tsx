interface Props {
  sold: number;
  held: number;
  quota: number;
}

// Jauge de remplissage : places vendues, puis réservées non payées (hachurées).
export function Meter({ sold, held, quota }: Props) {
  const pct = (n: number) => (quota > 0 ? `${Math.min(100, (n / quota) * 100)}%` : '0%');
  return (
    <div className="meter" role="img" aria-label={`${sold} vendues, ${held} réservées sur ${quota}`}>
      {sold > 0 && <div className="sold" style={{ width: pct(sold) }} />}
      {held > 0 && <div className="held" style={{ width: pct(held) }} />}
    </div>
  );
}
