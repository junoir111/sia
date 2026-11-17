import {
  KnownMembership,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { ALIAS_MUR, DUREE_MAX_ANNONCE_MS } from '../config';
import {
  DUREE_DEMANDE_MS,
  nettoyerDemande,
  TOLERANCE_HORLOGE_MS,
  type DemandeClient,
} from '../logique/demande';
import type { AnnonceRecue } from '../logique/notification';
import { estIdEvenement } from '../logique/offres';
import { LIMITES, estObjet, texteSur } from '../logique/profil';
import { noterPseudo } from './annuaire';
import { TYPE_ANNONCE, TYPE_STATUT, type ContenuAnnonce, type ContenuStatut } from './evenements';

/*
 * Le Mur (salon public entre membres, NON chiffré) : demandes de clients (io.sia.annonce) et
 * statuts « disponible » des prestataires (io.sia.statut). Contrat : 7-contrats-mise-en-relation.md.
 * Tout ce qui est lu passe par nettoyerDemande / nettoyerStatut : le réseau n'est pas fiable.
 */

/** Demande lue sur le Mur : `contenu` est la copie NETTOYÉE (utilisable avec doitNotifier). */
export type DemandeRecue = AnnonceRecue & { demande: DemandeClient; contenu: ContenuAnnonce };
export type StatutPrestataire = ContenuStatut;

const CLE_STATUT = 'sia.statut';
/** Demande publiée par ce téléphone (écrite par l'écran profil-client). */
const CLE_DEMANDE = 'sia.demande';
const PAGES_MAX = 5;
const TAILLE_PAGE = 50;

let idMur: string | null = null;

/** Statut « disponible » propre, ou null. Fin dans le futur et 24 h au plus après `reference`. */
export function nettoyerStatut(inconnu: unknown, reference: number): StatutPrestataire | null {
  if (!estObjet(inconnu)) return null;
  const pseudo = texteSur(inconnu.pseudo, LIMITES.pseudo);
  const metier = texteSur(inconnu.metier, LIMITES.metier);
  const zone = texteSur(inconnu.zone, LIMITES.zone);
  const fin = inconnu.fin;
  if (pseudo === null || metier === null || zone === null) return null;
  if (typeof fin !== 'number' || !Number.isInteger(fin) || fin < 0) return null;
  if (fin > reference + DUREE_MAX_ANNONCE_MS + TOLERANCE_HORLOGE_MS) return null;
  return { pseudo, metier, zone, fin };
}

/** Rejoint le Mur (s'il ne l'est pas déjà) et rend son identifiant. */
export async function rejoindreMur(c: MatrixClient): Promise<string> {
  if (idMur && c.getRoom(idMur)?.getMyMembership() === KnownMembership.Join) return idMur;
  const salon = await c.joinRoom(ALIAS_MUR);
  idMur = salon.roomId;
  return idMur;
}

function salonMur(c: MatrixClient): Room | null {
  return idMur ? c.getRoom(idMur) : null;
}

function estMur(salon: Room | undefined): boolean {
  if (!salon) return false;
  return salon.roomId === idMur || salon.getCanonicalAlias() === ALIAS_MUR;
}

/** Publie une demande de client (2 h). Rend l'identifiant de l'événement. */
export async function publierDemande(c: MatrixClient, d: DemandeClient): Promise<string> {
  const maintenant = Date.now();
  const propre = nettoyerDemande({ ...d, role: 'client' }, maintenant);
  if (!propre || propre.fin <= maintenant) throw new Error('Demande invalide.');
  const contenu: ContenuAnnonce = { role: 'client', ...propre };
  const salon = await rejoindreMur(c);
  const { event_id } = await c.sendEvent(salon, TYPE_ANNONCE, contenu);
  return event_id;
}

/** Retire (efface) une demande publiée. */
export async function retirerDemande(c: MatrixClient, eventId: string): Promise<void> {
  if (!estIdEvenement(eventId)) throw new Error('Référence de demande invalide.');
  await c.redactEvent(await rejoindreMur(c), eventId);
}

function lireIdStatut(): string | null {
  try {
    const id = localStorage.getItem(CLE_STATUT);
    return estIdEvenement(id) ? id : null;
  } catch {
    return null;
  }
}

function ecrireIdStatut(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(CLE_STATUT);
    else localStorage.setItem(CLE_STATUT, id);
  } catch {
    // Stockage indisponible : le Mur sera relu pour retrouver le statut.
  }
}

/** Publie mon statut « disponible » (l'ancien est d'abord effacé : 1 statut au plus). */
export async function publierStatut(c: MatrixClient, s: StatutPrestataire): Promise<string> {
  const maintenant = Date.now();
  const propre = nettoyerStatut(s, maintenant);
  if (!propre || propre.fin <= maintenant || propre.fin > maintenant + DUREE_MAX_ANNONCE_MS) {
    throw new Error('Statut invalide.');
  }
  await retirerStatut(c);
  const { event_id } = await c.sendEvent(await rejoindreMur(c), TYPE_STATUT, propre);
  ecrireIdStatut(event_id);
  return event_id;
}

/** Éteint « disponible » : efface mes statuts encore visibles sur le Mur. */
export async function retirerStatut(c: MatrixClient): Promise<void> {
  const salon = await rejoindreMur(c);
  const moi = c.getUserId();
  const ids = new Set<string>();
  const memorise = lireIdStatut();
  if (memorise) ids.add(memorise);
  for (const ev of c.getRoom(salon)?.getLiveTimeline().getEvents() ?? []) {
    const id = ev.getId();
    if (ev.getType() === TYPE_STATUT && ev.getSender() === moi && !ev.isRedacted() && id) {
      ids.add(id);
    }
  }
  for (const id of ids) {
    try {
      await c.redactEvent(salon, id);
    } catch {
      // Déjà effacé (ou plus visible) : rien à faire.
    }
  }
  ecrireIdStatut(null);
}

/** Lit un événement du Mur comme demande de client ; null s'il n'en est pas une valide. */
export function lireDemande(ev: MatrixEvent): DemandeRecue | null {
  const eventId = ev.getId();
  const expediteur = ev.getSender();
  if (ev.getType() !== TYPE_ANNONCE || ev.isRedacted() || ev.isState()) return null;
  if (!estIdEvenement(eventId) || typeof expediteur !== 'string') return null;
  // La fin est bornée par l'heure d'envoi donnée par le serveur, pas par l'heure de lecture.
  const demande = nettoyerDemande(ev.getContent(), ev.getTs());
  if (!demande) return null;
  return { eventId, expediteur, demande, contenu: { role: 'client', ...demande } };
}

/**
 * Écoute les nouvelles demandes publiées sur le Mur (et, si donné, celles qui sont retirées).
 * Rend une fonction qui arrête l'écoute.
 */
export function ecouterDemandes(
  c: MatrixClient,
  rappel: (d: DemandeRecue) => void,
  auRetrait?: (eventId: string) => void,
): () => void {
  // Une seule demande active par compte : la plus récente remplace la précédente.
  const derniere = new Map<string, { eventId: string; ts: number }>();
  const surEvenement = (
    ev: MatrixEvent,
    salon: Room | undefined,
    versLeDebut: boolean | undefined,
  ): void => {
    if (versLeDebut || !estMur(salon)) return;
    const d = lireDemande(ev);
    if (!d || d.demande.fin <= Date.now() || !noterPseudo(d.expediteur, d.demande.pseudo)) return;
    const avant = derniere.get(d.expediteur);
    if (avant && avant.ts > ev.getTs()) return;
    derniere.set(d.expediteur, { eventId: d.eventId, ts: ev.getTs() });
    if (avant && avant.eventId !== d.eventId) auRetrait?.(avant.eventId);
    rappel(d);
  };
  const surEffacement = (effacement: MatrixEvent, salon: Room): void => {
    // Selon la version du salon, la cible est en haut de l'événement ou dans son contenu.
    const cible = effacement.getAssociatedId() ?? effacement.getContent().redacts;
    if (!auRetrait || !estMur(salon) || !estIdEvenement(cible)) return;
    if (salon.findEventById(cible)?.getType() === TYPE_ANNONCE) auRetrait(cible);
  };
  c.on(RoomEvent.Timeline, surEvenement);
  c.on(RoomEvent.Redaction, surEffacement);
  return () => {
    c.off(RoomEvent.Timeline, surEvenement);
    c.off(RoomEvent.Redaction, surEffacement);
  };
}

/** Demandes encore valables sur le Mur (relit l'historique des 2 dernières heures au besoin). */
export async function demandesActives(c: MatrixClient): Promise<DemandeRecue[]> {
  await rejoindreMur(c);
  const salon = salonMur(c);
  if (!salon) return [];
  await chargerHistorique(c, salon, Date.now() - DUREE_DEMANDE_MS - TOLERANCE_HORLOGE_MS);
  const maintenant = Date.now();
  const parCompte = new Map<string, DemandeRecue>();
  for (const ev of salon.getLiveTimeline().getEvents()) {
    const d = lireDemande(ev);
    // Pseudo déjà pris par un autre compte : ignorée. Sinon la plus récente du compte remplace l'autre.
    if (!d || !noterPseudo(d.expediteur, d.demande.pseudo) || d.demande.fin <= maintenant) continue;
    parCompte.delete(d.expediteur);
    parCompte.set(d.expediteur, d);
  }
  return [...parCompte.values()];
}

/** Retrouve une demande du Mur par son identifiant (fil chargé, sinon serveur). */
export async function trouverDemande(
  c: MatrixClient,
  eventId: string,
): Promise<DemandeRecue | null> {
  if (!estIdEvenement(eventId)) return null;
  const salon = await rejoindreMur(c);
  const local = c.getRoom(salon)?.findEventById(eventId);
  if (local) return lireDemande(local);
  const brut = await c.fetchRoomEvent(salon, eventId);
  const ev = c.getEventMapper()(brut);
  return ev.getRoomId() === salon ? lireDemande(ev) : null;
}

/** Demande du Mur déjà chargée sur l'appareil (sans réseau), ou null. */
export function demandeLocale(c: MatrixClient, eventId: string): DemandeRecue | null {
  if (!estIdEvenement(eventId)) return null;
  const salon = salonMur(c) ?? c.getRooms().find((r) => estMur(r)) ?? null;
  const ev = salon?.findEventById(eventId);
  return ev ? lireDemande(ev) : null;
}

/**
 * Ma demande `eventId` si elle est encore valable : lue sur le Mur (envoyée par moi), sinon celle gardée
 * par ce téléphone (« sia.demande »). Sans réseau. null si ce n'est pas ma demande ou si elle est expirée.
 */
export function maDemandeValable(c: MatrixClient, eventId: string): DemandeClient | null {
  if (!estIdEvenement(eventId)) return null;
  const maintenant = Date.now();
  const surMur = demandeLocale(c, eventId);
  if (surMur) {
    return surMur.expediteur === c.getUserId() && surMur.demande.fin > maintenant
      ? surMur.demande
      : null;
  }
  const gardee = lireDemandeGardee();
  if (!gardee || gardee.eventId !== eventId) return null;
  return gardee.demande.fin > maintenant ? gardee.demande : null;
}

function lireDemandeGardee(): { eventId: string; demande: DemandeClient } | null {
  try {
    const brut = localStorage.getItem(CLE_DEMANDE);
    if (brut === null) return null;
    const donnees: unknown = JSON.parse(brut);
    if (!estObjet(donnees) || !estIdEvenement(donnees.eventId)) return null;
    const demande = nettoyerDemande(donnees.demande);
    return demande ? { eventId: donnees.eventId, demande } : null;
  } catch {
    return null;
  }
}

/** Oublie la demande gardée par ce téléphone (« sia.demande »). */
export function oublierDemandeLocale(): void {
  try {
    localStorage.removeItem(CLE_DEMANDE);
  } catch {
    // Stockage inaccessible : rien à effacer.
  }
}

/** Charge l'historique du Mur jusqu'à `limite` (date ms) au plus loin, PAGES_MAX pages au plus. */
async function chargerHistorique(c: MatrixClient, salon: Room, limite: number): Promise<void> {
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const premier = salon.getLiveTimeline().getEvents()[0];
    if (premier && premier.getTs() < limite) break;
    const encore = await c.paginateEventTimeline(salon.getLiveTimeline(), {
      backwards: true,
      limit: TAILLE_PAGE,
    });
    if (!encore) break;
  }
}

/**
 * Vrai si mon annonce ou statut est périmé : `fin` illisible ou passée, ou plus de 24 h après l'envoi
 * (document 5 : 24 h au plus après la publication).
 */
function estExpire(ev: MatrixEvent, maintenant: number): boolean {
  const fin: unknown = ev.getContent().fin;
  if (typeof fin !== 'number' || !Number.isFinite(fin) || fin <= maintenant) return true;
  return ev.getTs() + DUREE_MAX_ANNONCE_MS <= maintenant;
}

/**
 * Efface mes io.sia.annonce et io.sia.statut expirés encore visibles sur le Mur (document 5, §5 :
 * « effacé par son auteur à la prochaine ouverture »). À appeler au démarrage. Ne rejette pas
 * pour un effacement refusé : il sera retenté à la prochaine ouverture.
 */
export async function nettoyerMesAnnonces(c: MatrixClient): Promise<void> {
  const id = await rejoindreMur(c);
  const salon = c.getRoom(id);
  if (!salon) return;
  const maintenant = Date.now();
  await chargerHistorique(c, salon, maintenant - DUREE_MAX_ANNONCE_MS - TOLERANCE_HORLOGE_MS);
  const moi = c.getUserId();
  const memorise = lireIdStatut();
  const aEffacer = salon
    .getLiveTimeline()
    .getEvents()
    .filter(
      (ev) =>
        (ev.getType() === TYPE_ANNONCE || ev.getType() === TYPE_STATUT) &&
        ev.getSender() === moi &&
        !ev.isRedacted() &&
        !ev.isState() &&
        estIdEvenement(ev.getId()) &&
        estExpire(ev, maintenant),
    );
  for (const ev of aEffacer) {
    const eventId = ev.getId() as string;
    try {
      await c.redactEvent(id, eventId);
      if (eventId === memorise) ecrireIdStatut(null);
    } catch {
      // Refusé ou réseau coupé : retenté à la prochaine ouverture.
    }
  }
}

/** Mon statut « disponible » encore valable sur le Mur (sans réseau), ou null. */
export function monStatutActif(
  c: MatrixClient,
): { eventId: string; statut: StatutPrestataire } | null {
  const salon = salonMur(c) ?? c.getRooms().find((r) => estMur(r)) ?? null;
  if (!salon) return null;
  const moi = c.getUserId();
  const maintenant = Date.now();
  for (const ev of [...salon.getLiveTimeline().getEvents()].reverse()) {
    const eventId = ev.getId();
    if (ev.getType() !== TYPE_STATUT || ev.getSender() !== moi) continue;
    if (ev.isRedacted() || ev.isState() || !estIdEvenement(eventId)) continue;
    const statut = nettoyerStatut(ev.getContent(), ev.getTs());
    if (statut && statut.fin > maintenant) return { eventId, statut };
  }
  return null;
}

/** Pour les tests : oublie l'identifiant du Mur. */
export function oublierMur(): void {
  idMur = null;
}
