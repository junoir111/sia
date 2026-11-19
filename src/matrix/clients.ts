import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import {
  ajouterClient,
  contenuClients,
  nettoyerClients,
  retirerClient,
  type ContactClient,
} from '../logique/clients';
import { autreDeBulle } from './bulles';
import { TYPE_CLIENTS } from './evenements';

/*
 * « Mes clients » : la liste privée du prestataire, gardée sur son compte (donnée `io.sia.clients`), que seuls lui
 * et le serveur peuvent lire. On y range quelqu'un depuis une bulle où il a accepté de discuter ; ensuite, « Écrire »
 * (bulles.ts, ecrireA) lui propose une nouvelle bulle, qu'il peut refuser. Le compte du client n'est jamais affiché.
 */

/** Au bout de ce délai, une écriture sans nouvelle est abandonnée (réseau coupé : l'écran le dit). */
const DELAI_ECRITURE_MS = 20_000;

let derniere: Promise<unknown> = Promise.resolve();

/** Une écriture à la fois : chacune part de la liste déjà mise à jour par la précédente (aucun client perdu). */
function enFile<T>(tache: () => Promise<T>): Promise<T> {
  const suite = derniere.then(tache);
  derniere = suite.catch(() => undefined);
  return suite;
}

/** Ma liste de clients, telle que la synchro l'a apportée (ce qui est mal formé est ignoré). */
export function lireClients(c: MatrixClient): ContactClient[] {
  return nettoyerClients(c.getAccountData(TYPE_CLIENTS)?.getContent());
}

/** Prévient avec la liste à jour à chaque changement. Rend la fonction qui arrête d'écouter. */
export function ecouterClients(
  c: MatrixClient,
  rappel: (liste: ContactClient[]) => void,
): () => void {
  const surCompte = (evenement: MatrixEvent): void => {
    if (evenement.getType() === TYPE_CLIENTS) rappel(lireClients(c));
  };
  c.on(ClientEvent.AccountData, surCompte);
  return () => {
    c.off(ClientEvent.AccountData, surCompte);
  };
}

/** Vrai si l'autre personne de cette bulle est déjà dans ma liste. */
export function clientEnregistre(c: MatrixClient, roomId: string): boolean {
  const autre = autreDeBulle(c, roomId);
  return autre !== null && lireClients(c).some((x) => x.userId === autre.userId);
}

/** Écrit la liste sur le compte et attend que la synchro la rapporte (20 s au plus). */
async function ecrire(c: MatrixClient, liste: readonly ContactClient[]): Promise<void> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<never>((_, refuser) => {
    minuterie = setTimeout(
      () => refuser(Object.assign(new Error('Écriture trop longue.'), { name: 'TimeoutError' })),
      DELAI_ECRITURE_MS,
    );
  });
  try {
    await Promise.race([c.setAccountData(TYPE_CLIENTS, contenuClients(liste)), delai]);
  } finally {
    clearTimeout(minuterie);
  }
}

/** Enregistre l'autre personne de cette bulle comme client. Refusé tant qu'elle n'a pas accepté la bulle. */
export function enregistrerClient(c: MatrixClient, roomId: string): Promise<void> {
  return enFile(async () => {
    const autre = autreDeBulle(c, roomId);
    if (!autre) throw new Error('Impossible d’enregistrer cette personne.');
    const liste = ajouterClient(lireClients(c), autre);
    if (!liste) throw new Error('Liste de clients pleine.');
    await ecrire(c, liste);
  });
}

/** Retire ce client de ma liste (rien n'est écrit s'il n'y est pas). */
export function retirerClientEnregistre(c: MatrixClient, userId: string): Promise<void> {
  return enFile(async () => {
    const liste = lireClients(c);
    if (!liste.some((x) => x.userId === userId)) return;
    await ecrire(c, retirerClient(liste, userId));
  });
}
