import type { ReactNode } from 'react';
import { IconeCoche } from './icones';

/** Message de réussite (« Demande envoyée à… ») ; `children` : un lien d'action placé dessous. */
export function BandeauSucces({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="bandeau-succes" role="status">
      <IconeCoche className="bandeau-succes__icone" />
      <span>{message}</span>
      {children}
    </div>
  );
}
