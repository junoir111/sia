import { ClientEvent } from 'matrix-js-sdk';
import { emetteur } from './faux-matrix';

/*
 * Client Matrix simulé pour les tests d'ÉCRANS (aucun réseau) : seulement ce que l'interface lit elle-même,
 * c'est-à-dire l'état de synchronisation et ses abonnements. Le reste est simulé par vi.mock dans chaque test.
 */

export type ClientEcran = {
  simule: true;
  on: (nom: string, rappel: (...a: unknown[]) => void) => void;
  off: (nom: string, rappel: (...a: unknown[]) => void) => void;
  getSyncState: () => string | null;
  /** Fait passer la synchronisation à un nouvel état (« CATCHUP », « SYNCING »…) et prévient les écrans. */
  changerSynchro: (etat: string | null) => void;
};

export function clientEcran(): ClientEcran {
  const e = emetteur();
  let etat: string | null = 'SYNCING';
  return {
    simule: true,
    on: e.on,
    off: e.off,
    getSyncState: () => etat,
    changerSynchro(suivant) {
      const avant = etat;
      etat = suivant;
      e.emit(ClientEvent.Sync, suivant, avant);
    },
  };
}

/**
 * Une promesse qu'on résout (ou rejette) soi-même : le test garde la main sur le moment où le serveur répond,
 * pour regarder l'écran PENDANT que le serveur n'a pas encore répondu.
 */
export function differe<T = void>() {
  let resoudre!: (valeur: T) => void;
  let rejeter!: (erreur: unknown) => void;
  const promesse = new Promise<T>((ok, ko) => {
    resoudre = ok;
    rejeter = ko;
  });
  return { promesse, resoudre, rejeter };
}

/** Erreur que le SDK lève quand le réseau est coupé. */
export function coupureReseau(): Error {
  return Object.assign(new Error('coupé'), { name: 'ConnectionError' });
}
