import { useEffect, useRef } from 'react';
import type { ScanFeedback } from '../../hooks/useOfflineScanner';

const ICONS = { ok: '✓', warn: '!', bad: '✕' } as const;

// Résultat plein écran, lisible de loin à l'entrée d'une salle. Fermeture : touche, clic ou délai.
export function ScanResultOverlay({ feedback, onDismiss }: { feedback: ScanFeedback; onDismiss: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus();
  }, [feedback]);

  return (
    <div className={`scan-result ${feedback.tone}`} role="alert">
      <div className="icon" aria-hidden="true">
        {ICONS[feedback.tone]}
      </div>
      <div className="big">{feedback.title}</div>
      <div className="scan-result-detail">{feedback.detail}</div>
      <button ref={buttonRef} type="button" className="scan-result-close" onClick={onDismiss}>
        Continuer
      </button>
    </div>
  );
}
