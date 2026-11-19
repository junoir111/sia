import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ContactClient } from '../../logique/clients';
import { ecouterClients, lireClients } from '../../matrix/clients';

/** Ma liste de clients tenue à jour (null tant que le client Matrix n'est pas prêt). */
export function useClients(client: MatrixClient | null): ContactClient[] | null {
  const [etat, setEtat] = useState<{ client: MatrixClient; liste: ContactClient[] } | null>(null);

  useEffect(() => {
    if (!client) return;
    return ecouterClients(client, (liste) => setEtat({ client, liste }));
  }, [client]);

  if (!client) return null;
  // Première lecture sans attendre un changement.
  return etat?.client === client ? etat.liste : lireClients(client);
}
