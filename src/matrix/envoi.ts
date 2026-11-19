import { EventType, MatrixScheduler, type MatrixEvent } from 'matrix-js-sdk';

/*
 * Envoi fiable des messages sur une connexion capricieuse (téléphone, relais, changement de réseau).
 * La file d'envoi d'origine du SDK : une seule file pour TOUS les messages et TOUS les effacements ; à la
 * première coupure du réseau elle abandonne l'envoi en cours ET tous ceux qui attendent derrière, sans
 * jamais renvoyer ; et une requête qui ne répond plus la bloque sans fin. Vu en vrai : « quelques messages
 * partent, d'autres non », alors que « l'autre écrit » s'affichait bien.
 * Ici : une file PAR BULLE, seulement pour les messages (l'ordre est gardé) ; les effacements partent à
 * part, sans attendre ; une requête muette est coupée au bout de DELAI_REQUETE_MS ; une coupure ou un délai
 * dépassé donne un nouvel envoi du même message (même identifiant d'envoi : le serveur ne le crée jamais
 * deux fois). La synchro et le chiffrement gardent leurs propres délais.
 */

/** Une requête ordinaire sans réponse après ce temps est coupée, puis le message est renvoyé. */
export const DELAI_REQUETE_MS = 15_000;
/** Envois d'un même message avant d'abandonner (le premier compte). */
export const ENVOIS_MAX = 5;
/** Attente avant le 1er renvoi ; elle double ensuite, jusqu'à ce plafond. */
export const ATTENTE_MIN_MS = 500;
export const ATTENTE_MAX_MS = 4_000;
/** « Trop de demandes » (429) : délai donné par le serveur, borné ; 2 s s'il n'en donne pas. */
const LIMITE_DEFAUT_MS = 2_000;
const LIMITE_MIN_MS = 500;
const LIMITE_MAX_MS = 5_000;
const ABANDON = -1;

/** File d'envoi : une par bulle, et seulement pour les messages. Les autres événements partent tout de suite. */
export function fileEnvoi(ev: MatrixEvent): string | null {
  const salon = ev.getRoomId();
  return salon && ev.getType() === EventType.RoomMessage ? `bulle:${salon}` : null;
}

type ErreurSdk = { httpStatus?: unknown; name?: unknown; data?: unknown };

function statutHttp(erreur: ErreurSdk): number | undefined {
  return typeof erreur.httpStatus === 'number' ? erreur.httpStatus : undefined;
}

function delaiDemande(erreur: ErreurSdk): number {
  const donnees = erreur.data;
  const brut =
    typeof donnees === 'object' && donnees !== null
      ? (donnees as { retry_after_ms?: unknown }).retry_after_ms
      : undefined;
  const demande = typeof brut === 'number' && Number.isFinite(brut) ? brut : LIMITE_DEFAUT_MS;
  return Math.min(LIMITE_MAX_MS, Math.max(LIMITE_MIN_MS, demande));
}

/**
 * Faut-il renvoyer le message, et dans combien de ms ? `echecs` = nombre d'envois déjà échoués (1 après le premier).
 * Rend -1 pour abandonner : refus définitif du serveur, message trop gros, ou trop d'échecs de suite.
 */
export function reessaiEnvoi(_ev: MatrixEvent | null, echecs: number, erreur: unknown): number {
  if (echecs >= ENVOIS_MAX) return ABANDON;
  const e: ErreurSdk = typeof erreur === 'object' && erreur !== null ? (erreur as ErreurSdk) : {};
  if (e.name === 'M_TOO_LARGE') return ABANDON;
  const statut = statutHttp(e);
  if (statut === 429) return delaiDemande(e);
  if (statut !== undefined && statut >= 400 && statut < 500) return ABANDON;
  // Coupure du réseau, requête coupée par le délai, serveur ou relais en panne passagère : on renvoie.
  return Math.min(ATTENTE_MAX_MS, ATTENTE_MIN_MS * 2 ** Math.max(0, echecs - 1));
}

/** File d'envoi à donner au client (option `scheduler` de createClient). */
export function creerPlanificateur(): MatrixScheduler {
  return new MatrixScheduler(reessaiEnvoi, fileEnvoi);
}
