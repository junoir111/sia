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
import { estSession } from './session';

/*
 * UN seul client Matrix pour toute l'appli (contrat « src/matrix/ », client.ts).
 * - Chiffrement Rust (Olm/Megolm) avec sa base IndexedDB propre à SIA (préfixe « sia-crypto »).
 * - Aucun journal du SDK dans la console : il pourrait contenir des identifiants ou des jetons.
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

/** Vrai si une réserve de clés existe déjà sur ce téléphone (faux si on ne peut pas le savoir). */
async function reserveExiste(): Promise<boolean> {
  try {
    const bases = await indexedDB.databases();
    return bases.some((b) => b.name === `${PREFIXE_BASE_CRYPTO}::matrix-sdk-crypto`);
  } catch {
    return false;
  }
}

/** Au-delà, la réserve de clés est jugée bloquée (vu en vrai : init qui ne finit jamais). */
export const DELAI_INIT_CRYPTO_MS = 25_000;

/**
 * Lance le chiffrement. S'il ne répond pas à temps, la réserve est bloquée : on demande son
 * effacement puis on recharge la page (l'effacement passe dès que l'ancienne connexion est fermée).
 */
async function initAvecDelai(c: MatrixClient): Promise<void> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<never>((_, rejeter) => {
    minuterie = setTimeout(() => {
      void effacerReserveCrypto();
      try {
        window.location.reload();
      } catch {
        // Pas de page à recharger (tests) : l'erreur suffit.
      }
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

/**
 * Prépare le chiffrement. Une réserve laissée par un AUTRE compte (changement de compte sans
 * déconnexion propre) bloquerait le démarrage pour toujours : elle est effacée, puis on réessaie une fois.
 */
async function preparerChiffrement(c: MatrixClient, session: Session): Promise<void> {
  const proprietaire = `${session.userId}|${session.deviceId}`;
  let precedent: string | null;
  try {
    precedent = localStorage.getItem(CLE_PROPRIETAIRE_CRYPTO);
  } catch {
    precedent = null;
  }
  // Réserve d'un autre compte, ou réserve sans propriétaire connu (anciennes versions) : effacée.
  if (precedent !== proprietaire && (precedent !== null || (await reserveExiste()))) {
    await effacerReserveCrypto();
  }
  try {
    await initAvecDelai(c);
  } catch {
    await effacerReserveCrypto();
    await initAvecDelai(c);
  }
  try {
    localStorage.setItem(CLE_PROPRIETAIRE_CRYPTO, proprietaire);
  } catch {
    // Stockage refusé : la reprise par effacement ci-dessus reste le filet de sécurité.
  }
}

async function lancer(session: Session): Promise<MatrixClient> {
  fairTaireSdk();
  const c = createClient({
    baseUrl: ADRESSE_SERVEUR,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    logger: silence,
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
  return c;
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
    .then((c) => {
      if (moi !== generation) {
        c.stopClient();
        throw new Error('Démarrage annulé : une autre session a été demandée.');
      }
      actif = c;
      reprendreEffacements(c);
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
  arreterEphemere();
  actif?.stopClient();
  actif = null;
}
