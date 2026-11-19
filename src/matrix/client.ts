import {
  ClientEvent,
  createClient,
  HttpApiEvent,
  SyncState,
  type MatrixClient,
} from 'matrix-js-sdk';
import { logger as journalSdk, type Logger } from 'matrix-js-sdk/lib/logger';
import { ADRESSE_SERVEUR } from '../config';
import type { Session } from './auth';
import { arreterEphemere, reprendreEffacements } from './ephemere';
import { DELAI_REQUETE_MS, creerPlanificateur } from './envoi';
import { suivreSynchro, surveillerSynchro } from './reveil';
import { estSession } from './session';

/*
 * UN seul client Matrix pour toute l'appli (contrat « src/matrix/ », client.ts).
 * - Chiffrement Rust (Olm/Megolm) avec sa base IndexedDB propre à SIA (préfixe « sia-crypto »).
 * - Aucun journal du SDK dans la console : il pourrait contenir des identifiants ou des jetons.
 * - Réveil rapide : au retour de l'appli, du réseau ou en cas de silence de la synchro (reveil.ts).
 */

export const PREFIXE_BASE_CRYPTO = 'sia-crypto';
const DELAI_PREMIER_SYNC_MS = 60_000;

/** Journal muet donné au client (et à ses enfants). */
const silence: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  getChild: () => silence,
};

type JournalLoglevel = { setLevel?: (niveau: string, garder?: boolean) => void };

/** Fait taire aussi le journal global (ancien) du SDK. */
function fairTaireSdk(): void {
  try {
    (journalSdk as unknown as JournalLoglevel).setLevel?.('silent', false);
  } catch {
    // Journal sans réglage de niveau : rien à faire.
  }
}

let actif: MatrixClient | null = null;
let demarrage: { cle: string; promesse: Promise<MatrixClient> } | null = null;
/** Augmente à chaque nouveau démarrage ou arrêt : un démarrage dépassé ne devient jamais le client actif. */
let generation = 0;
/** Arrête la surveillance de la synchro du client actif (reveil.ts). */
let arretReveil: (() => void) | null = null;

/** Entre deux rechargements automatiques : pas de boucle si le serveur reste injoignable. */
export const PAUSE_RECHARGEMENT_MS = 5 * 60_000;
const CLE_RECHARGEMENT = 'sia.rechargement';

/**
 * Dernier recours du chien de garde : recharger l'appli (la session et les clés de chiffrement restent sur
 * l'appareil). On ne peut pas simplement arrêter puis relancer le client : arrêter coupe le chiffrement
 * pour de bon. Au plus une fois toutes les 5 minutes.
 */
export function rechargerAppli(): void {
  try {
    const dernier = Number(sessionStorage.getItem(CLE_RECHARGEMENT));
    if (Date.now() - dernier < PAUSE_RECHARGEMENT_MS) return;
    sessionStorage.setItem(CLE_RECHARGEMENT, String(Date.now()));
    window.location.reload();
  } catch {
    // Pas de page à recharger (tests) ou stockage refusé : la prochaine intervention réessaiera.
  }
}

function cleSession(s: Session): string {
  return `${s.userId}
${s.deviceId}`;
}

function attendrePremierSync(c: MatrixClient): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const fin = (erreur?: unknown): void => {
      clearTimeout(minuterie);
      c.off(ClientEvent.Sync, surSync);
      c.off(HttpApiEvent.SessionLoggedOut, surDeconnexion);
      if (erreur === undefined) resoudre();
      else rejeter(erreur);
    };
    const surSync = (etat: SyncState): void => {
      if (etat === SyncState.Prepared || etat === SyncState.Syncing) fin();
    };
    const surDeconnexion = (erreur: unknown): void => fin(erreur ?? { errcode: 'M_UNKNOWN_TOKEN' });
    const minuterie = setTimeout(() => {
      const erreur = new Error('Le serveur ne répond pas.');
      erreur.name = 'TimeoutError';
      fin(erreur);
    }, DELAI_PREMIER_SYNC_MS);
    c.on(ClientEvent.Sync, surSync);
    c.on(HttpApiEvent.SessionLoggedOut, surDeconnexion);
  });
}

/** À qui appartient la réserve de clés de ce téléphone (« userId|deviceId »). */
const CLE_PROPRIETAIRE_CRYPTO = 'sia.crypto-de';

function effacerBase(nom: string): Promise<void> {
  return new Promise((fini) => {
    try {
      const requete = indexedDB.deleteDatabase(nom);
      requete.onsuccess = requete.onerror = requete.onblocked = () => fini();
    } catch {
      fini();
    }
  });
}

/** Efface la réserve de clés de chiffrement (celle d'un autre compte ou d'un autre appareil). */
async function effacerReserveCrypto(): Promise<void> {
  await effacerBase(`${PREFIXE_BASE_CRYPTO}::matrix-sdk-crypto`);
  await effacerBase(`${PREFIXE_BASE_CRYPTO}::matrix-sdk-crypto-meta`);
}

/** Au-delà, la réserve de clés est jugée bloquée (vu en vrai : init qui ne finit jamais). */
export const DELAI_INIT_CRYPTO_MS = 25_000;

/**
 * Lance le chiffrement. S'il ne répond pas à temps, la réserve est sûrement tenue ouverte par l'ancienne
 * page : on recharge la page (au plus une fois toutes les 5 minutes) et le démarrage échoue. Les clés ne
 * sont JAMAIS effacées ici (voir preparerChiffrement).
 */
async function initAvecDelai(c: MatrixClient): Promise<void> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<never>((_, rejeter) => {
    minuterie = setTimeout(() => {
      rechargerAppli();
      rejeter(new Error('Chiffrement bloqué.'));
    }, DELAI_INIT_CRYPTO_MS);
  });
  try {
    await Promise.race([
      c.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: PREFIXE_BASE_CRYPTO }),
      delai,
    ]);
  } finally {
    clearTimeout(minuterie);
  }
}

/** Le chiffrement refuse la réserve parce qu'elle appartient à un AUTRE appareil (autre compte ou autre connexion). */
const ERREUR_AUTRE_RESERVE = /account in the store/i;

function estReserveDUnAutre(erreur: unknown): boolean {
  const texte =
    typeof erreur === 'string'
      ? erreur
      : typeof erreur === 'object' && erreur !== null && 'message' in erreur
        ? String((erreur as { message: unknown }).message)
        : '';
  return ERREUR_AUTRE_RESERVE.test(texte);
}

/**
 * Prépare le chiffrement. RÈGLE : les clés d'un appareil ne sont jamais effacées tant que cet appareil
 * garde la même identité. Effacer puis recommencer avec le même identifiant d'appareil change ses clés sans
 * que ses contacts le sachent : ils continuent de chiffrer pour les anciennes, et leurs messages deviennent
 * illisibles pour lui (vu en vrai : un sens de la conversation qui « n'arrive pas »).
 * On n'efface donc que la réserve d'un AUTRE appareil : propriétaire noté différent, ou refus du chiffrement
 * (« account in the store »). Une réserve sans propriétaire connu (anciennes versions) est gardée : si elle
 * n'est pas à nous, le chiffrement le dira. Tout autre échec fait échouer le démarrage, qui sera réessayé.
 */
async function preparerChiffrement(c: MatrixClient, session: Session): Promise<void> {
  const proprietaire = `${session.userId}|${session.deviceId}`;
  let precedent: string | null;
  try {
    precedent = localStorage.getItem(CLE_PROPRIETAIRE_CRYPTO);
  } catch {
    precedent = null;
  }
  if (precedent !== null && precedent !== proprietaire) await effacerReserveCrypto();
  try {
    await initAvecDelai(c);
  } catch (erreur) {
    if (!estReserveDUnAutre(erreur)) throw erreur;
    await effacerReserveCrypto();
    await initAvecDelai(c);
  }
  try {
    localStorage.setItem(CLE_PROPRIETAIRE_CRYPTO, proprietaire);
  } catch {
    // Stockage refusé : le chiffrement refusera de lui-même la réserve d'un autre appareil.
  }
}

async function lancer(
  session: Session,
): Promise<{ client: MatrixClient; couperSynchro: () => void }> {
  fairTaireSdk();
  const suivi = suivreSynchro();
  const c = createClient({
    baseUrl: ADRESSE_SERVEUR,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    logger: silence,
    fetchFn: suivi.fetchFn,
    // Envoi fiable sur connexion capricieuse (voir envoi.ts) : une file par bulle, renvoi après une coupure.
    scheduler: creerPlanificateur(),
    localTimeoutMs: DELAI_REQUETE_MS,
  });
  try {
    await preparerChiffrement(c, session);
    const pret = attendrePremierSync(c);
    await c.startClient({ initialSyncLimit: 20, lazyLoadMembers: true });
    await pret;
  } catch (erreur) {
    c.stopClient();
    throw erreur;
  }
  return { client: c, couperSynchro: suivi.couperSynchro };
}

/**
 * Démarre le client Matrix de cette session (ou rend celui qui tourne déjà pour elle).
 * Rejette si la session est illisible, refusée par le serveur, ou si le premier sync n'arrive pas.
 */
export async function demarrerClient(session: Session): Promise<MatrixClient> {
  if (!estSession(session)) throw new Error('Session invalide.');
  const cle = cleSession(session);
  if (actif && actif.getUserId() === session.userId && actif.getDeviceId() === session.deviceId) {
    return actif;
  }
  if (demarrage?.cle === cle) return demarrage.promesse;
  // Autre session (ou aucune en cours) : l'ancien client et tout démarrage en cours ne sont plus voulus.
  arreterClient();
  const moi = generation;
  const promesse = lancer(session)
    .then(({ client: c, couperSynchro }) => {
      if (moi !== generation) {
        c.stopClient();
        throw new Error('Démarrage annulé : une autre session a été demandée.');
      }
      actif = c;
      reprendreEffacements(c);
      arretReveil = surveillerSynchro(c, { couperSynchro, redemarrer: rechargerAppli });
      return c;
    })
    .finally(() => {
      if (demarrage?.promesse === promesse) demarrage = null;
    });
  demarrage = { cle, promesse };
  return promesse;
}

/** Client démarré, ou null. */
export function clientActif(): MatrixClient | null {
  return actif;
}

/** Arrête la synchronisation (les clés de chiffrement restent sur l'appareil). */
export function arreterClient(): void {
  generation += 1;
  demarrage = null;
  arretReveil?.();
  arretReveil = null;
  arreterEphemere();
  actif?.stopClient();
  actif = null;
}
