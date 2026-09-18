import type { GateSettings } from '../../hooks/useOfflineScanner';
import type { Manifest } from '../../types/api';

const GATE_NAME_MAX = 40;

interface Props {
  settings: GateSettings;
  manifest: Manifest | null;
  deviceId: string;
  onChange: (settings: GateSettings) => void;
  onReload: () => void;
}

export function GateSettingsPanel({ settings, manifest, deviceId, onChange, onReload }: Props) {
  const toggleZone = (id: number, accepted: boolean) =>
    onChange({ ...settings, zone: accepted ? [...settings.zone, id] : settings.zone.filter((z) => z !== id) });

  return (
    <details className="card">
      <summary className="summary-toggle">Réglages de ce téléphone</summary>
      <div className="stack details-body">
        <div className="field">
          <label htmlFor="gate-name">Nom de la porte</label>
          <input
            id="gate-name"
            maxLength={GATE_NAME_MAX}
            value={settings.gate}
            onChange={(e) => onChange({ ...settings, gate: e.target.value })}
          />
        </div>
        <fieldset className="stack plain-fieldset">
          <legend className="label">Zones acceptées à cette porte</legend>
          <p className="small muted">Aucune case cochée = tous les billets acceptés.</p>
          {(manifest?.ticketTypes ?? []).map((t) => (
            <label key={t.id} className="row checkbox-row">
              <input type="checkbox" checked={settings.zone.includes(t.id)} onChange={(e) => toggleZone(t.id, e.target.checked)} />
              {t.name}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn" onClick={onReload}>
          Retélécharger la liste des billets
        </button>
        <p className="small muted">Identifiant du téléphone : {deviceId}</p>
      </div>
    </details>
  );
}
