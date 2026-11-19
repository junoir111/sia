import { ClientEvent, SyncState, type MatrixClient } from 'matrix-js-sdk';

/*
 * Réveil rapide de la synchro. Le client garde une longue requête /sync ouverte (30 s) pour recevoir les
 * nouveautés. Sur un téléphone, quand l'appli dort ou que le réseau change, cette connexion peut mourir
 * sans qu'aucune erreur n'arrive : le SDK attendrait alors jusqu'à 110 s. Ici, dès que l'appli revient
 * (page visible, réseau de retour, « resume » de Capacitor), on relance tout de suite ; et un chien de
 * garde surveille qu'un cycle de synchro aboutit toujours.
 * Rien ici ne lit ni n'écrit de donnée de bulle : seulement l'état de la connexion.
 */

/** Page visible et en ligne, mais aucun cycle de synchro abouti depuis ce délai : le chien de garde intervient. */
export const DELAI_CHIEN_DE_GARDE_MS = 45_000;
/** Une longue requête (30 s au plus quand tout va bien) plus vieille que ça est jugée morte au réveil. */
export const AGE_SYNCHRO_SUSPECTE_MS = 35_000;
/** Interventions de suite sans aucun cycle abouti avant de repartir de zéro. */
export const ECHECS_AVANT_REDEMARRAGE = 3;
const PERIODE_CONTROLE_MS = 5_000;
/** Le SDK note l'échec d'une requête coupée un instant plus tard : on lui dit alors de réessayer sans attendre. */
const ATTENTE_APRES_COUPURE_MS = 50;
/** Le SDK a déjà repris la main tout seul dans ces états (réessais en cours). */
const EN_REPRISE = new Set<SyncState | null>([
  SyncState.Error,
  SyncState.Reconnecting,
  SyncState.Catchup,
]);
/** `/sync` : la longue requête gardée ouverte (le seul chemin suivi ici). */
const FORME_URL_SYNC = /\/_matrix\/client\/[^/?]+\/sync(?:\?|$)/;

function urlDe(requete: RequestInfo | URL): string {
  if (typeof requete === 'string') return requete;
  return 'url' in requete ? requete.url : requete.href;
}

export type SuiviSynchro = {
  /** À donner au client (option fetchFn) : repère les requêtes /sync en cours, les autres passent telles quelles. */
  fetchFn: typeof globalThis.fetch;
  /** Coupe les /sync en cours (connexion qui ne répond plus) : le SDK en relance une neuve. */
  couperSynchro: () => void;
};

export function suivreSynchro(): SuiviSynchro {
  const enCours = new Set<AbortController>();
  const fetchFn: typeof globalThis.fetch = (requete, options) => {
    if (!FORME_URL_SYNC.test(urlDe(requete))) return globalThis.fetch(requete, options);
    const coupure = new AbortController();
    const amont = options?.signal;
    const relayer = (): void => coupure.abort();
    // Un arrêt demandé par le SDK (arrêt du client, délai dépassé) coupe aussi notre requête.
    if (amont?.aborted) coupure.abort();
    else amont?.addEventListener('abort', relayer, { once: true });
    enCours.add(coupure);
    return globalThis.fetch(requete, { ...options, signal: coupure.signal }).finally(() => {
      enCours.delete(coupure);
      amont?.removeEventListener('abort', relayer);
    });
  };
  const couperSynchro = (): void => {
    for (const coupure of [...enCours]) coupure.abort();
  };
  return { fetchFn, couperSynchro };
}

type ClientSynchro = Pick<MatrixClient, 'on' | 'off' | 'retryImmediately' | 'getSyncState'>;

export type ActionsReveil = {
  couperSynchro: () => void;
  /** Dernier recours (aucune synchro depuis 3 interventions) : repartir de zéro. */
  redemarrer: () => void;
};

const pageVisible = (): boolean => document.visibilityState !== 'hidden';
const enLigne = (): boolean => navigator.onLine !== false;

/**
 * Surveille la synchro d'un client démarré. Rend la fonction qui arrête la surveillance.
 * - Au réveil (page visible, réseau de retour, resume) : relance immédiate ; si le dernier cycle abouti est
 *   trop vieux, la longue requête est coupée (elle est sûrement morte) pour que la relance parte tout de suite.
 * - Chien de garde : page visible et en ligne mais aucun cycle abouti depuis 45 s → même secousse. Après
 *   3 secousses de suite sans effet : `redemarrer`, sauf si le SDK dit déjà réessayer (serveur injoignable :
 *   repartir de zéro n'y changerait rien).
 */
export function surveillerSynchro(c: ClientSynchro, actions: ActionsReveil): () => void {
  let derniere = Date.now();
  let repere = derniere;
  let echecs = 0;
  let apresCoupure: ReturnType<typeof setTimeout> | undefined;

  const relancer = (): boolean => {
    try {
      return c.retryImmediately();
    } catch {
      return false;
    }
  };

  const secouer = (connexionMorte: boolean): void => {
    if (relancer() || !connexionMorte) return;
    try {
      actions.couperSynchro();
    } catch {
      // Rien à couper : la relance ci-dessous suffit.
    }
    clearTimeout(apresCoupure);
    apresCoupure = setTimeout(relancer, ATTENTE_APRES_COUPURE_MS);
  };

  const synchroBloquee = (): boolean => {
    try {
      return !EN_REPRISE.has(c.getSyncState());
    } catch {
      return true;
    }
  };

  const surSync = (etat: SyncState): void => {
    if (etat !== SyncState.Prepared && etat !== SyncState.Syncing) return;
    derniere = repere = Date.now();
    echecs = 0;
  };

  const reveiller = (): void => {
    if (!pageVisible() || !enLigne()) return;
    const age = Date.now() - derniere;
    repere = Date.now();
    secouer(age > AGE_SYNCHRO_SUSPECTE_MS);
  };

  const controler = (): void => {
    const maintenant = Date.now();
    // En arrière-plan ou hors ligne, un silence est normal : le décompte repart au retour.
    if (!pageVisible() || !enLigne()) {
      repere = maintenant;
      return;
    }
    if (maintenant - Math.max(derniere, repere) < DELAI_CHIEN_DE_GARDE_MS) return;
    repere = maintenant;
    echecs += 1;
    if (echecs >= ECHECS_AVANT_REDEMARRAGE && synchroBloquee()) {
      echecs = 0;
      try {
        actions.redemarrer();
      } catch {
        // Impossible de repartir de zéro : la prochaine intervention réessaiera.
      }
      return;
    }
    secouer(true);
  };

  const surVisibilite = (): void => {
    if (pageVisible()) reveiller();
  };

  c.on(ClientEvent.Sync, surSync);
  document.addEventListener('visibilitychange', surVisibilite);
  // Capacitor (Android) envoie « resume » sur document quand l'appli revient au premier plan.
  document.addEventListener('resume', reveiller);
  window.addEventListener('online', reveiller);
  const minuterie = setInterval(controler, PERIODE_CONTROLE_MS);

  return () => {
    c.off(ClientEvent.Sync, surSync);
    document.removeEventListener('visibilitychange', surVisibilite);
    document.removeEventListener('resume', reveiller);
    window.removeEventListener('online', reveiller);
    clearInterval(minuterie);
    clearTimeout(apresCoupure);
  };
}
