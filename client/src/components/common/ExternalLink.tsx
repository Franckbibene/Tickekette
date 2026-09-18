import type { ReactNode } from 'react';
import { safeExternalUrl } from '../../utils/url';

// Lien vers un autre site : protocole vérifié (http/https uniquement), nouvel onglet isolé
// (noopener) et sans Referer (noreferrer : l'URL de la page contient un jeton secret).
export function ExternalLink({ href, className, children }: { href: string | null; className?: string; children: ReactNode }) {
  const safe = safeExternalUrl(href);
  if (!safe) return null;
  return (
    <a className={className} href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
