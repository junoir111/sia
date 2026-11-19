import { useCallback, useSyncExternalStore } from 'react';
import { ClientEvent, SyncState } from 'matrix-js-sdk';
import type { MatrixClient } from 'matrix-js-sdk';

/**
 * Vrai pendant que le client rattrape ses événements (retour du réseau, téléphone rallumé) : les listes
 * peuvent encore changer. Les nouveautés arrivent seules ; ce drapeau sert juste à le dire discrètement.
 */
export function useRattrapage(client: MatrixClient | null): boolean {
  const abonner = useCallback(
    (rappel: () => void) => {
      client?.on(ClientEvent.Sync, rappel);
      return () => {
        client?.off(ClientEvent.Sync, rappel);
      };
    },
    [client],
  );
  const lire = useCallback(() => {
    const etat = client?.getSyncState() ?? null;
    return etat === SyncState.Catchup || etat === SyncState.Reconnecting;
  }, [client]);
  return useSyncExternalStore(abonner, lire);
}
