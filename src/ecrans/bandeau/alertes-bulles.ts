import { matchPath } from 'react-router-dom';
import { CHEMINS } from '../../chemins';
import type { ResumeBulle } from '../../matrix/bulles';
import { estIdSalon } from '../../matrix/evenements';
import { avecNonLus, avecOuverture } from './memoire-alertes';
import type { MemoireAlertes } from './memoire-alertes';

/*
 * Deux alertes en direct, sans toucher au serveur (tout vient de la liste des bulles déjà écoutée) :
 * - « <pseudo> a accepté. » : ma bulle passe de « en attente » à « ouverte » alors que je n'y suis pas ;
 * - « Nouveau message de <pseudo> » : le compteur de non-lus de la bulle dépasse ce que je connais.
 * Jamais le texte d'un message : on ne lit que l'état et le compteur de la bulle.
 * Pure et sans écran : le bandeau (Bandeau.tsx) en tire ses cartes.
 */

/** Une carte à montrer : la bulle, et le pseudo de l'autre (le nom déjà inventé, jamais le vrai). */
export type CarteBulle = { genre: 'ouverte' | 'message'; roomId: string; pseudo: string };

/** Clé d'une carte dans la pile (distincte de celle d'une offre, qui est le salon seul). */
export function cleCarte(carte: CarteBulle): string {
  return `${carte.genre}:${carte.roomId}`;
}

/** La bulle montrée à l'écran d'après l'adresse (« /bulle/<salon> »), sinon null. */
export function salonDeAdresse(adresse: string): string | null {
  const brut = matchPath(CHEMINS.bulle, adresse)?.params.roomId;
  if (brut === undefined) return null;
  try {
    const roomId = decodeURIComponent(brut);
    return estIdSalon(roomId) ? roomId : null;
  } catch {
    return null; // adresse mal encodée : ce n'est pas une bulle
  }
}

/** Ce que doit montrer le bandeau pour les bulles, et la mémoire à jour (même objet si rien ne change). */
export type SuiviBulles = { cartes: CarteBulle[]; memoire: MemoireAlertes };

/**
 * `ouverte` : la bulle affichée à l'écran en ce moment. Dans cette bulle, aucune carte : on y est déjà,
 * et on y a vu ce qui arrive. Les cartes se déduisent de la liste à chaque fois : elles restent tant que
 * la bulle n'est pas ouverte, et ne reviennent pas une fois traitées.
 */
export function suivreBulles(
  bulles: readonly ResumeBulle[],
  ouverte: string | null,
  memoire: MemoireAlertes,
): SuiviBulles {
  let suivie = memoire;
  const cartes: CarteBulle[] = [];
  for (const b of bulles) {
    const ici = b.roomId === ouverte;
    const ouverture = suivie.ouvertures[b.roomId];
    if (b.etat === 'en-attente' && ouverture === undefined) {
      suivie = avecOuverture(suivie, b.roomId, 'attente');
    } else if (b.etat === 'fermee' && ouverture === 'attente') {
      suivie = avecOuverture(suivie, b.roomId, null); // l'autre est parti sans accepter
    } else if (b.etat === 'ouverte' && ouverture === 'attente') {
      if (ici) suivie = avecOuverture(suivie, b.roomId, 'dite');
      else cartes.push({ genre: 'ouverte', roomId: b.roomId, pseudo: b.autre.pseudo });
    }
    if (b.etat !== 'ouverte' || ici) continue;
    const connus = suivie.messages[b.roomId] ?? 0;
    if (b.nonLus > connus) {
      cartes.push({ genre: 'message', roomId: b.roomId, pseudo: b.autre.pseudo });
    } else if (b.nonLus < connus) {
      suivie = avecNonLus(suivie, b.roomId, b.nonLus); // lus ou effacés : le prochain sera une nouveauté
    }
  }
  return { cartes, memoire: suivie };
}

/**
 * Je quitte la bulle `roomId` : ce qui reste non lu alors (messages que l'écran ne sait pas montrer)
 * m'a été présenté, ce n'est plus une nouveauté. `bulles` doit être une liste fraîche, lue après la sortie.
 */
export function acquitterSortie(
  memoire: MemoireAlertes,
  bulles: readonly ResumeBulle[],
  roomId: string,
): MemoireAlertes {
  const b = bulles.find((x) => x.roomId === roomId);
  return avecNonLus(memoire, roomId, b?.etat === 'ouverte' ? b.nonLus : 0);
}
