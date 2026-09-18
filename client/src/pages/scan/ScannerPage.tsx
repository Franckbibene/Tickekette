import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConflictAlert } from '../../components/scan/ConflictAlert';
import { GateSettingsPanel } from '../../components/scan/GateSettingsPanel';
import { ManualEntry } from '../../components/scan/ManualEntry';
import { QrCamera } from '../../components/scan/QrCamera';
import { ScanResultOverlay } from '../../components/scan/ScanResultOverlay';
import { useOfflineScanner } from '../../hooks/useOfflineScanner';
import { formatTime } from '../../utils/format';
import { parseRouteId } from '../../utils/url';
import NotFoundPage from '../public/NotFoundPage';

export default function ScannerPage() {
  const eventId = parseRouteId(useParams().eventId);
  if (eventId === null) return <NotFoundPage />;
  // La clé remonte l'écran à chaque événement : ses données locales sont propres à l'événement.
  return <ScannerScreen key={eventId} eventId={eventId} />;
}

function ScannerScreen({ eventId }: { eventId: number }) {
  const scanner = useOfflineScanner(eventId);
  const [cameraOn, setCameraOn] = useState(false);
  const { manifest, timeZone } = scanner;
  const validTickets = manifest?.tickets.filter((t) => t.status === 'valid') ?? [];
  const enteredCount = validTickets.filter((t) => t.enteredAt).length;

  return (
    <div className="scanner">
      <header className="scanner-top">
        <Link to="/controle" className="btn btn-small" aria-label="Retour à la liste des événements">
          ←
        </Link>
        <h1 className="scanner-title">{manifest?.event.title ?? 'Contrôle'}</h1>
        <span className={`net ${scanner.online ? 'on' : 'off'}`} role="status">
          {scanner.online ? 'En ligne' : 'Hors ligne'}
        </span>
      </header>

      <main className="container narrow stack scanner-main">
        {scanner.loadError && !manifest && <div className="alert alert-error">{scanner.loadError}</div>}

        <section className="card card-tight spread" aria-label="Compteur d’entrées">
          <div>
            <div className="counter">
              {enteredCount} <span className="muted counter-total">/ {validTickets.length} entrés</span>
            </div>
            <div className="small muted">
              {manifest ? `Liste du ${formatTime(manifest.generatedAt, timeZone)}` : 'Liste non téléchargée'}
              {scanner.lastSync && ` · synchro ${formatTime(scanner.lastSync, timeZone)}`}
            </div>
            {scanner.pendingCount > 0 && <div className="small pending-text">{scanner.pendingCount} entrée(s) à synchroniser</div>}
          </div>
          <button type="button" className="btn btn-small" onClick={() => void scanner.refresh()}>
            Actualiser
          </button>
        </section>

        <ConflictAlert conflicts={scanner.conflicts} describeFirst={scanner.describeFirst} onClear={scanner.clearConflicts} />

        <section className="card stack" aria-label="Lecture des QR codes">
          {cameraOn ? (
            <>
              <QrCamera onCode={(text) => void scanner.handleScan(text)} />
              <button type="button" className="btn btn-block" onClick={() => setCameraOn(false)}>
                Arrêter la caméra
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-block btn-large" onClick={() => setCameraOn(true)}>
              Scanner les QR codes
            </button>
          )}
        </section>

        <ManualEntry
          manifest={manifest}
          typeName={scanner.typeName}
          onSubmitCode={(text) => void scanner.handleScan(text)}
          onPickTicket={scanner.handleManual}
        />

        <GateSettingsPanel
          settings={scanner.settings}
          manifest={manifest}
          deviceId={scanner.deviceId}
          onChange={scanner.setSettings}
          onReload={() => void scanner.downloadManifest()}
        />
      </main>

      {scanner.feedback && <ScanResultOverlay feedback={scanner.feedback} onDismiss={scanner.dismissFeedback} />}
    </div>
  );
}
