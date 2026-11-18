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
      ({ statuts, demandes }) => setLecture({ client, statuts, demandes, erreur: false }),
      () => setLecture({ client, statuts: [], demandes: [], erreur: true }),
    );
    const minuterie = setInterval(() => setMaintenant(Date.now()), RAFRAICHIR_MS);
    return () => {
      arreter();
      clearInterval(minuterie);
    };
  }, [client]);

  const courante = lecture && lecture.client === client ? lecture : null;
  return {
    statuts: courante?.statuts ?? [],
    demandes: courante?.demandes ?? [],
    maintenant,
    pret: courante !== null && !courante.erreur,
    erreur: courante?.erreur ?? false,
  };
}
