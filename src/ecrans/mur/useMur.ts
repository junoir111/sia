import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import type { EntreeDemande } from '../../logique/mur';
import { ecouterMur, type EntreeStatutMur } from '../../matrix/mur';

const RAFRAICHIR_MS = 30_000;

export type VueMur = {
  statuts: readonly EntreeStatutMur[];
  demandes: readonly EntreeDemande[];
  /** Heure de référence (mise à jour toutes les 30 s) : les entrées expirées disparaissent seules. */
  maintenant: number;
  /** Faux tant que la première lecture du Mur n'est pas finie. */
  pret: boolean;
  erreur: boolean;
};

type Lecture = {
  client: MatrixClient;
  statuts: readonly EntreeStatutMur[];
  demandes: readonly EntreeDemande[];
  erreur: boolean;
};

/**
 * Dernière lecture réussie du Mur, par client : l'écran suivant (liste, fiche, retour au Mur) s'affiche
 * tout de suite avec ce qu'on sait déjà, puis se met à jour tout seul. Plus de « Chargement… » à chaque pas.
 */
let memoire = new WeakMap<MatrixClient, Lecture>();

/** Pour les tests : oublie ce qui a été lu. */
export function oublierMemoireMur(): void {
  memoire = new WeakMap();
}

/**
 * Statuts « disponible » et demandes du Mur, tenus à jour (contrat : projet/8-contrats-mur.md).
 * Branché sur ecouterMur de src/matrix/mur.ts, qui rend l'état du Mur à chaque changement.
 */
export function useMur(client: MatrixClient | null): VueMur {
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  useEffect(() => {
    if (!client) return;
    const arreter = ecouterMur(
      client,
      ({ statuts, demandes }) => {
        const nouvelle = { client, statuts, demandes, erreur: false };
        memoire.set(client, nouvelle);
        setLecture(nouvelle);
      },
      () => setLecture({ client, statuts: [], demandes: [], erreur: true }),
    );
    const minuterie = setInterval(() => setMaintenant(Date.now()), RAFRAICHIR_MS);
    // Téléphone rallumé ou appli rouverte : l'heure se met à jour tout de suite (pas dans 30 s),
    // les entrées expirées pendant ce temps disparaissent sans rien toucher.
    const auRetour = (): void => {
      if (document.visibilityState === 'visible') setMaintenant(Date.now());
    };
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      arreter();
      clearInterval(minuterie);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [client]);

  // La lecture de cet écran d'abord ; sinon la dernière gardée (même si cet écran n'a pas pu relire :
  // mieux vaut montrer ce qu'on sait que tout cacher) ; sinon l'erreur, si c'est tout ce qu'on a.
  const propre = lecture && lecture.client === client ? lecture : null;
  const gardee = client ? memoire.get(client) : undefined;
  const courante = propre && !propre.erreur ? propre : (gardee ?? propre);
  return {
    statuts: courante?.statuts ?? [],
    demandes: courante?.demandes ?? [],
    maintenant,
    pret: courante !== null && !courante.erreur,
    erreur: courante?.erreur ?? false,
  };
}
