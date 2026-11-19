import { useCallback, useEffect, useRef } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { ecouterBulles, listerBulles } from '../../matrix/bulles';
import type { ResumeBulle } from '../../matrix/bulles';
import { acquitterSortie, suivreBulles } from './alertes-bulles';
import type { CarteBulle } from './alertes-bulles';
import { ecrireMemoire, lireMemoire } from './memoire-alertes';
import type { MemoireAlertes } from './memoire-alertes';

/** Ce que le bandeau reçoit des bulles. */
export type RappelsBulles = {
  /** Les invitations reçues (« X dit oui »), à chaque liste de bulles reçue (jamais lors d'un changement d'écran). */
  offres: (offres: ResumeBulle[]) => void;
  /** Les cartes « a accepté » / « Nouveau message » à montrer maintenant (toute la liste, pas seulement les nouvelles). */
  cartes: (cartes: CarteBulle[]) => void;
};

/** Liste toute fraîche des bulles (sans réseau), ou null si elle ne se lit pas : on garde alors la dernière. */
function listeFraiche(client: MatrixClient): ResumeBulle[] | null {
  try {
    return listerBulles(client);
  } catch {
    return null;
  }
}

/**
 * Écoute les bulles pour le bandeau : les offres reçues, et les deux alertes en direct
 * (« a accepté », « Nouveau message ») avec leur mémoire locale (memoire-alertes.ts).
 * `ouverte` : la bulle affichée à l'écran. Y entrer retire ses cartes ; en sortir fait de ce qui reste
 * non lu une chose connue (un message qu'on ne sait pas montrer ne doit pas ressurgir à chaque fois).
 */
export function useAlertesBulles(
  client: MatrixClient | null,
  ouverte: string | null,
  rappels: RappelsBulles,
): void {
  const rappelsActuels = useRef(rappels);
  const salonOuvert = useRef(ouverte);
  const precedente = useRef<string | null>(null);
  const derniere = useRef<readonly ResumeBulle[] | null>(null);
  const memoire = useRef<MemoireAlertes | null>(null);

  useEffect(() => {
    rappelsActuels.current = rappels;
  });

  const lire = useCallback((): MemoireAlertes => (memoire.current ??= lireMemoire()), []);

  const retenir = useCallback(
    (suivante: MemoireAlertes): void => {
      if (suivante !== lire()) ecrireMemoire(suivante);
      memoire.current = suivante;
    },
    [lire],
  );

  /** Recalcule les cartes de bulle d'après une liste (les offres n'en dépendent pas ici). */
  const appliquer = useCallback(
    (bulles: readonly ResumeBulle[]): void => {
      const suivi = suivreBulles(bulles, salonOuvert.current, lire());
      retenir(suivi.memoire);
      rappelsActuels.current.cartes(suivi.cartes);
    },
    [lire, retenir],
  );

  // Les bulles, tenues à jour : une seule écoute pour les offres et les alertes.
  useEffect(() => {
    if (!client) return;
    memoire.current = null;
    derniere.current = null;
    return ecouterBulles(client, (bulles) => {
      derniere.current = bulles;
      rappelsActuels.current.offres(bulles.filter((b) => b.etat === 'invitation-recue'));
      appliquer(bulles);
    });
  }, [client, appliquer]);

  // Changement d'écran : entrer dans une bulle retire ses cartes ; la quitter retient ce qui reste non lu.
  useEffect(() => {
    if (!client) return;
    salonOuvert.current = ouverte;
    const quittee = precedente.current;
    precedente.current = ouverte;
    let bulles = derniere.current;
    if (quittee !== null && quittee !== ouverte) {
      bulles = listeFraiche(client) ?? bulles;
      if (bulles) {
        derniere.current = bulles;
        retenir(acquitterSortie(lire(), bulles, quittee));
      }
    }
    if (bulles) appliquer(bulles);
  }, [client, ouverte, appliquer, lire, retenir]);
}
