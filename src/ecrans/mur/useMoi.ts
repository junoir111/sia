import { useEffect, useState } from 'react';
import type { Session } from '../../matrix/auth';
import { lireProfil, lireProfilClient } from '../../matrix/profil';
import { lireSession } from '../../matrix/session';

export type Moi = { role: 'prestataire' | 'client'; pseudo: string; zone: string };

async function lireMoi(session: Session): Promise<Moi | null> {
  const presta = await lireProfil(session);
  if (presta.ok && presta.profil) {
    return { role: 'prestataire', pseudo: presta.profil.pseudo, zone: presta.profil.zone };
  }
  const client = await lireProfilClient(session);
  if (client.ok && client.profil) {
    return { role: 'client', pseudo: client.profil.pseudo, zone: client.profil.zone };
  }
  return null;
}

/** Qui je suis (rôle, pseudo, quartier) d'après mon profil enregistré. `moi` est null sans profil. */
export function useMoi(): { moi: Moi | null; userId: string | null; chargement: boolean } {
  const [session] = useState(lireSession);
  const [lu, setLu] = useState<{ moi: Moi | null } | null>(null);

  useEffect(() => {
    if (!session) return;
    let actif = true;
    lireMoi(session)
      .catch(() => null) // Profil illisible : on affiche le Mur sans rôle.
      .then((moi) => {
        if (actif) setLu({ moi });
      });
    return () => {
      actif = false;
    };
  }, [session]);

  return {
    moi: lu?.moi ?? null,
    userId: session?.userId ?? null,
    chargement: session !== null && lu === null,
  };
}
