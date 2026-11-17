import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { ecouterBulles, listerBulles } from '../../matrix/bulles';
import type { ResumeBulle } from '../../matrix/bulles';

/** Liste des bulles tenue à jour (null tant que le client Matrix n'est pas prêt). */
export function useBulles(client: MatrixClient | null): ResumeBulle[] | null {
  const [etat, setEtat] = useState<{ client: MatrixClient; bulles: ResumeBulle[] } | null>(null);

  useEffect(() => {
    if (!client) return;
    return ecouterBulles(client, (bulles) => setEtat({ client, bulles }));
  }, [client]);

  if (!client) return null;
  // Première lecture sans attendre le premier rappel (regroupé toutes les 50 ms).
  return etat?.client === client ? etat.bulles : listerBulles(client);
}

/** Messages non lus + offres pas encore acceptées : ce que montre le petit badge. */
export function compterNouveautes(bulles: readonly ResumeBulle[] | null): number {
  if (!bulles) return 0;
  return bulles.reduce((total, b) => total + b.nonLus + (b.etat === 'invitation-recue' ? 1 : 0), 0);
}
