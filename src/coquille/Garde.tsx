import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { CHEMINS } from '../chemins';
import { lireSession } from '../matrix/session';

/** Écran réservé aux personnes connectées : sans session, retour à l'accueil (E1). */
export function Garde({ children }: { children: ReactNode }) {
  if (!lireSession()) return <Navigate to={CHEMINS.accueil} replace />;
  return <>{children}</>;
}
