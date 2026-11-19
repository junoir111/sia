import { useEffect, useState } from 'react';
import type { Session } from '../../matrix/auth';
import { lireProfil, lireProfilClient } from '../../matrix/profil';
import { lireSession } from '../../matrix/session';

export type Moi = { role: 'prestataire' | 'client'; pseudo: string; zone: string };

/**
 * Qui je suis, par compte, tel qu'on l'a lu la dernière fois (mémoire de l'appli ouverte, rien sur le
 * téléphone). Les écrans suivants (liste, fiche) l'ont donc tout de suite, sans attendre le serveur :
 * « Demander » est là dès que la fiche s'ouvre. Une relecture en arrière-plan met à jour.
 */
let memoire = new Map<string, Moi | null>();

/** À appeler quand mon profil vient d'être enregistré : les écrans suivants le voient tout de suite. */
export function memoriserMoi(userId: string, moi: Moi): void {
  // Même règle que la lecture : un profil prestataire passe devant un profil client.
  if (moi.role === 'client' && memoire.get(userId)?.role === 'prestataire') return;
  memoire.set(userId, moi);
}

/** Pour les tests : oublie ce qui a été lu. */
export function oublierMoi(): void {
  memoire = new Map();
}

/** Mon profil, ou null si je n'en ai pas ; undefined si le serveur n'a pas pu répondre (on garde alors ce qu'on sait). */
async function lireMoi(session: Session): Promise<Moi | null | undefined> {
  const presta = await lireProfil(session);
  if (!presta.ok) return undefined;
  if (presta.profil) {
    return { role: 'prestataire', pseudo: presta.profil.pseudo, zone: presta.profil.zone };
  }
  const client = await lireProfilClient(session);
  if (!client.ok) return undefined;
  if (client.profil) {
    return { role: 'client', pseudo: client.profil.pseudo, zone: client.profil.zone };
  }
  return null;
}

/** Qui je suis (rôle, pseudo, quartier) d'après mon profil enregistré. `moi` est null sans profil. */
export function useMoi(): { moi: Moi | null; userId: string | null; chargement: boolean } {
  const [session] = useState(lireSession);
  const [lu, setLu] = useState<{ moi: Moi | null } | null>(() =>
    session && memoire.has(session.userId) ? { moi: memoire.get(session.userId) ?? null } : null,
  );

  useEffect(() => {
    if (!session) return;
    let actif = true;
    lireMoi(session)
      .catch(() => undefined) // Profil illisible : on garde ce qu'on sait, sinon le Mur sans rôle.
      .then((moi) => {
        if (!actif) return;
        if (moi === undefined) {
          setLu((avant) => avant ?? { moi: null });
          return;
        }
        memoire.set(session.userId, moi);
        setLu({ moi });
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
