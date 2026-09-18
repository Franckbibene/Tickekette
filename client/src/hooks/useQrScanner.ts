import { useEffect, useEffectEvent, useState, type RefObject } from 'react';

const SCAN_INTERVAL_MS = 250;

interface QrDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

interface NativeBarcodeDetector {
  new (options: { formats: string[] }): QrDetector;
  getSupportedFormats(): Promise<string[]>;
}

// API native BarcodeDetector quand le navigateur la fournit (Chrome Android…),
// sinon décodeur WebAssembly servi par notre propre site (pas de CDN externe, compatible CSP).
async function createDetector(): Promise<QrDetector> {
  const Native = (globalThis as { BarcodeDetector?: NativeBarcodeDetector }).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats()).includes('qr_code')) {
    return new Native({ formats: ['qr_code'] });
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  });
  return new BarcodeDetector({ formats: ['qr_code'] });
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Accès à la caméra refusé. Autorisez-le dans le navigateur ou utilisez la saisie manuelle.';
  if (name === 'NotFoundError') return 'Aucune caméra détectée. Utilisez la saisie manuelle.';
  return 'Caméra indisponible (HTTPS requis). Utilisez la saisie manuelle.';
}

// Lit les QR codes devant la caméra tant que le composant est affiché.
// Au démontage : arrêt de la boucle de lecture ET du flux vidéo (la caméra s'éteint).
export function useQrScanner(videoRef: RefObject<HTMLVideoElement | null>, onCode: (text: string) => void) {
  const [error, setError] = useState<string | null>(null);
  const handleCode = useEffectEvent(onCode);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    // État partagé avec les fonctions asynchrones : modifié par le nettoyage de l'effet.
    const session: { cancelled: boolean; stream: MediaStream | null; timer?: number } = { cancelled: false, stream: null };
    const stop = (s: MediaStream) => {
      s.getTracks().forEach((track) => {
        track.stop();
      });
    };

    const scan = async (detector: QrDetector) => {
      try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const value = (await detector.detect(video))[0]?.rawValue;
          if (value && !session.cancelled) handleCode(value);
        }
      } catch {
        // Image illisible : on retente à la lecture suivante.
      }
      if (!session.cancelled) {
        session.timer = window.setTimeout(() => void scan(detector), SCAN_INTERVAL_MS);
      }
    };

    const start = async () => {
      // mediaDevices est absent hors HTTPS, même si les types le déclarent toujours présent.
      if (!('mediaDevices' in navigator)) throw new Error('unsupported');
      const detector = await createDetector();
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (session.cancelled) {
        stop(acquired);
        return;
      }
      session.stream = acquired;
      video.srcObject = acquired;
      await video.play();
      await scan(detector);
    };

    start().catch((err: unknown) => {
      if (!session.cancelled) setError(cameraErrorMessage(err));
    });

    return () => {
      session.cancelled = true;
      window.clearTimeout(session.timer);
      if (session.stream) stop(session.stream);
      video.srcObject = null;
    };
  }, [videoRef]);

  return error;
}
