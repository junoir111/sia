import { useEffect } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMoi } from '../ecrans/mur/useMoi';
import { reglerNotificationPrestataires } from '../matrix/notifications';
import { lireSession } from '../matrix/session';
import { useMatrix } from './FournisseurMatrix';

/*
 * À chaque ouverture : un CLIENT doit être prévenu quand un prestataire se rend disponible sur le Mur.
 * La règle est posée côté serveur et vit avec le compte : on la (re)pose à l'ouverture, et on la retire si
 * ce compte est devenu prestataire. Rôle inconnu (profil pas encore enregistré, serveur muet) : on ne
 * touche à rien — la publication du profil pose la règle elle-même, et la prochaine ouverture rattrapera.
 * Ne montre rien.
 */

function PourCeCompte({ client }: { client: MatrixClient }) {
  const { moi } = useMoi();
  const role = moi?.role ?? null;
  useEffect(() => {
    if (role === null) return;
    void reglerNotificationPrestataires(client, role === 'client');
  }, [client, role]);
  return null;
}

export function ReglesNotifications() {
  const { client } = useMatrix();
  const session = lireSession();
  // Remonté à chaque compte : le rôle est relu pour le nouveau, jamais celui d'avant.
  if (!client || !session) return null;
  return <PourCeCompte key={session.userId} client={client} />;
}
