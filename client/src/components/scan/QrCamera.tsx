import { useRef } from 'react';
import { useQrScanner } from '../../hooks/useQrScanner';

// Monté uniquement quand la caméra est allumée : le démontage coupe le flux vidéo.
export function QrCamera({ onCode }: { onCode: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const error = useQrScanner(videoRef, onCode);
  return (
    <>
      <video ref={videoRef} className="qr-video" muted playsInline aria-label="Aperçu de la caméra" />
      {error && (
        <div className="alert alert-warn" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
