import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { DUREE_MESSAGE_MS } from '../config';
import { estIdEvenement } from '../logique/offres';
import { estIdSalon, TYPE_FICHE } from './evenements';

/*
 * Messages éphémères (TRD §5) : un message est effacé (redaction Matrix, sans raison) 1 minute après
 * son AFFICHAGE sur cet appareil. Mes propres messages comptent comme affichés dès l'envoi.
 * File d'attente globale gardée dans localStorage (« sia.a-effacer ») : seulement les identifiants et
 * l'échéance, jamais de contenu. Elle reprend au redémarrage du client (reprendreEffacements).
 */

const CLE_FILE = 'sia.a-effacer';
/** Au-delà, les plus anciens sont effacés tout de suite (la file ne grossit pas sans fin). */
const TAILLE_MAX_FILE = 500;
/** Nouvel essai après une coupure réseau. */
const NOUVEL_ESSAI_MS = 30_000;
/** Silence Radio : pages d'historique relues au plus pour trouver les messages restants. */
const PAGES_MAX = 10;
const TAILLE_PAGE = 50;
/** Codes HTTP qui veulent dire « inutile de réessayer » (déjà effacé, salon quitté, interdit…). */
const STATUTS_DEFINITIFS = [400, 403, 404];

/** Événements de bulle à effacer (le type chiffré est gardé si le déchiffrement a échoué). */
const TYPES_EPHEMERES = new Set(['m.room.message', 'm.room.encrypted', TYPE_FICHE]);

type AEffacer = { roomId: string; eventId: string; echeance: number };

const minuteries = new Map<string, ReturnType<typeof setTimeout>>();

function estEntree(v: unknown): v is AEffacer {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    estIdSalon(o.roomId) &&
    estIdEvenement(o.eventId) &&
    typeof o.echeance === 'number' &&
    Number.isFinite(o.echeance)
  );
}

function lireFile(): AEffacer[] {
  try {
    const brut = localStorage.getItem(CLE_FILE);
    if (brut === null) return [];
    const donnees: unknown = JSON.parse(brut);
    if (!Array.isArray(donnees)) return [];
    return donnees
      .filter(estEntree)
      .slice(-TAILLE_MAX_FILE)
      .map((e) => ({ roomId: e.roomId, eventId: e.eventId, echeance: e.echeance }));
  } catch {
    return [];
  }
}

function ecrireFile(file: readonly AEffacer[]): void {
  try {
    if (file.length === 0) localStorage.removeItem(CLE_FILE);
    else localStorage.setItem(CLE_FILE, JSON.stringify(file));
  } catch {
    // Stockage plein ou interdit : les minuteries en mémoire continuent.
  }
}

function retirerDeLaFile(eventId: string): void {
  ecrireFile(lireFile().filter((e) => e.eventId !== eventId));
}

function statutHttp(erreur: unknown): number | undefined {
  if (typeof erreur !== 'object' || erreur === null) return undefined;
  const statut = (erreur as Record<string, unknown>).httpStatus;
  return typeof statut === 'number' ? statut : undefined;
}

async function effacer(c: MatrixClient, entree: AEffacer): Promise<void> {
  minuteries.delete(entree.eventId);
  try {
    await c.redactEvent(entree.roomId, entree.eventId);
  } catch (erreur) {
    const statut = statutHttp(erreur);
    if (statut === undefined || !STATUTS_DEFINITIFS.includes(statut)) {
      programmer(c, { ...entree, echeance: Date.now() + NOUVEL_ESSAI_MS });
      return;
    }
  }
  retirerDeLaFile(entree.eventId);
}

function programmer(c: MatrixClient, entree: AEffacer): void {
  if (minuteries.has(entree.eventId)) return;
  const attente = Math.max(0, entree.echeance - Date.now());
  minuteries.set(
    entree.eventId,
    setTimeout(() => void effacer(c, entree), attente),
  );
}

/**
 * À appeler par l'écran quand un message s'affiche (ou par envoyerMessage pour mes messages).
 * Le compte à rebours d'une minute part de maintenant ; un message déjà en file garde sa première échéance.
 */
export function marquerAffiche(c: MatrixClient, roomId: string, eventId: string): void {
  if (!estIdSalon(roomId) || !estIdEvenement(eventId)) return;
  const file = lireFile();
  if (file.some((e) => e.eventId === eventId)) return;
  const entree = { roomId, eventId, echeance: Date.now() + DUREE_MESSAGE_MS };
  const nouvelle = [...file, entree];
  const enTrop = nouvelle.slice(0, Math.max(0, nouvelle.length - TAILLE_MAX_FILE));
  ecrireFile(nouvelle.slice(enTrop.length));
  for (const vieux of enTrop) void effacer(c, { ...vieux, echeance: 0 });
  programmer(c, entree);
}

/** Vrai si ce message a déjà été affiché sur cet appareil (sert au compte des non-lus). */
export function dejaAffiche(eventId: string): boolean {
  return minuteries.has(eventId) || lireFile().some((e) => e.eventId === eventId);
}

/** Échéance (date ms) de l'effacement de ce message sur cet appareil, ou null s'il n'est pas en file. */
export function echeanceEffacement(eventId: string): number | null {
  if (!estIdEvenement(eventId)) return null;
  return lireFile().find((e) => e.eventId === eventId)?.echeance ?? null;
}

/**
 * Efface TOUT DE SUITE tous les messages en file (avant une déconnexion). Un seul essai par message ;
 * ceux qui échouent pour une raison passagère restent en file. Ne rejette jamais.
 */
export async function toutEffacerMaintenant(c: MatrixClient): Promise<void> {
  arreterEphemere();
  await Promise.all(
    lireFile().map(async (entree) => {
      try {
        await c.redactEvent(entree.roomId, entree.eventId);
      } catch (erreur) {
        const statut = statutHttp(erreur);
        if (statut === undefined || !STATUTS_DEFINITIFS.includes(statut)) return;
      }
      retirerDeLaFile(entree.eventId);
    }),
  );
}

/** Relance les effacements en attente (appelé au démarrage du client). */
export function reprendreEffacements(c: MatrixClient): void {
  arreterEphemere();
  for (const entree of lireFile()) programmer(c, entree);
}

/** Coupe les minuteries (la file reste dans localStorage pour la prochaine ouverture). */
export function arreterEphemere(): void {
  for (const minuterie of minuteries.values()) clearTimeout(minuterie);
  minuteries.clear();
}

export function estEphemere(ev: MatrixEvent): boolean {
  return !ev.isState() && !ev.isRedacted() && TYPES_EPHEMERES.has(ev.getType());
}

async function chargerHistorique(c: MatrixClient, salon: Room): Promise<void> {
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const encore = await c.paginateEventTimeline(salon.getLiveTimeline(), {
      backwards: true,
      limit: TAILLE_PAGE,
    });
    if (!encore) return;
  }
}

/**
 * Silence Radio : efface tous les messages de la bulle que j'ai le droit d'effacer.
 * Rend le nombre de messages effacés. Les erreurs d'un message n'arrêtent pas les autres.
 */
export async function effacerTout(c: MatrixClient, roomId: string): Promise<number> {
  const salon = estIdSalon(roomId) ? c.getRoom(roomId) : null;
  const moi = c.getUserId();
  if (!salon || !moi) return 0;
  try {
    await chargerHistorique(c, salon);
  } catch {
    // Historique incomplet : on efface au moins ce qui est déjà chargé.
  }
  const etat = salon.getLiveTimeline().getState(Direction.Forward);
  const cibles = salon
    .getLiveTimeline()
    .getEvents()
    .filter((ev) => estEphemere(ev) && ev.getId() && etat?.maySendRedactionForEvent(ev, moi));
  let effaces = 0;
  for (const ev of cibles) {
    const eventId = ev.getId();
    if (!eventId) continue;
    try {
      await c.redactEvent(roomId, eventId);
      effaces += 1;
    } catch {
      // Message déjà effacé ou réseau coupé : on continue avec les autres.
    }
    const minuterie = minuteries.get(eventId);
    if (minuterie) clearTimeout(minuterie);
    minuteries.delete(eventId);
    retirerDeLaFile(eventId);
  }
  return effaces;
}
