import { useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { surveillerAbsence } from '../appareil/absence';
import { etatVerrou, surVerrou, verrouiller } from '../appareil/verrou';
import { EcranCode } from '../ecrans/code/EcranCode';
import { porteActuelle } from './porte';

/**
 * Porte de l'appli (F12). Tant que le code n'est pas tapé, les écrans restent cachés mais vivants (un message
 * commencé n'est pas perdu, les nouveautés continuent d'arriver). Un téléphone connecté sans code en choisit un.
 * L'appli se referme à clé après une minute passée dehors.
 */
export function VerrouAppli({ children }: { children: ReactNode }) {
  useLocation(); // une connexion ou une déconnexion change l'adresse : la porte se relit
  useSyncExternalStore(surVerrou, etatVerrou);
  useEffect(() => surveillerAbsence(verrouiller), []);

  const porte = porteActuelle();
  return (
    <>
      <div hidden={porte !== 'ouverte'}>{children}</div>
      {porte !== 'ouverte' && (
        <EcranCode key={porte} mode={porte === 'code-a-taper' ? 'taper' : 'choisir'} />
      )}
    </>
  );
}
