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
import type { EntreeDemande, EntreeStatut } from '../logique/mur';
import { LIMITES, estObjet, modaliteSure, texteSur, type Service } from '../logique/profil';
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
/** Statut lu sur le Mur : un EntreeStatut, plus les services indicatifs publiés (3 au plus). */
export type EntreeStatutMur = EntreeStatut & { services?: Service[] };
/** Ce qu'on voit du Mur à un instant donné. */
export type InstantaneMur = { statuts: EntreeStatutMur[]; demandes: EntreeDemande[] };

const CLE_STATUT = 'sia.statut';
/** Demande publiée par ce téléphone (écrite par l'écran profil-client). */
const CLE_DEMANDE = 'sia.demande';
const PAGES_MAX = 5;
const TAILLE_PAGE = 50;

let idMur: string | null = null;

/** Services indicatifs : absents (rien), ou 3 au plus {label 40 max, prix entier 1..100 000 000}. */
function servicesSurs(brut: unknown): Service[] | null {
  if (brut === undefined) return [];
  if (!Array.isArray(brut) || brut.length > LIMITES.servicesMax) return null;
  const services: Service[] = [];
  for (const v of brut) {
    if (!estObjet(v)) return null;
    const label = texteSur(v.label, LIMITES.service);
    const prix = v.prix;
    if (label === null || typeof prix !== 'number' || !Number.isInteger(prix)) return null;
    if (prix < 1 || prix > LIMITES.prixMax) return null;
    services.push({ label, prix });
  }
  return services;
}

/**
 * Statut « disponible » propre, ou null. Fin dans le futur et 24 h au plus après `reference`.
 * `services` (facultatif) : un `services` mal formé refuse tout le statut.
 */
export function nettoyerStatut(inconnu: unknown, reference: number): StatutPrestataire | null {
  if (!estObjet(inconnu)) return null;
  const pseudo = texteSur(inconnu.pseudo, LIMITES.pseudo);
  const metier = texteSur(inconnu.metier, LIMITES.metier);
  const zone = texteSur(inconnu.zone, LIMITES.zone);
  const fin = inconnu.fin;
  const services = servicesSurs(inconnu.services);
  if (pseudo === null || metier === null || zone === null || services === null) return null;
  if (typeof fin !== 'number' || !Number.isInteger(fin) || fin < 0) return null;
  if (fin > reference + DUREE_MAX_ANNONCE_MS + TOLERANCE_HORLOGE_MS) return null;
  const modalite = modaliteSure(inconnu.modalite);
  return {
    pseudo,
    metier,
    zone,
    fin,
    ...(modalite ? { modalite } : {}),
    ...(services.length > 0 ? { services } : {}),
  };
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

/** Efface mes demandes encore visibles sur le Mur (celle gardée par ce téléphone et celles du fil). */
export async function retirerMesDemandes(c: MatrixClient): Promise<void> {
  const salon = await rejoindreMur(c);
  const moi = c.getUserId();
  const ids = new Set<string>();
  const gardee = lireDemandeGardee();
  if (gardee) ids.add(gardee.eventId);
  for (const ev of c.getRoom(salon)?.getLiveTimeline().getEvents() ?? []) {
    const id = ev.getId();
    if (ev.getType() === TYPE_ANNONCE && ev.getSender() === moi && !ev.isRedacted() && id) {
      ids.add(id);
    }
  }
  for (const id of ids) {
    try {
      await c.redactEvent(salon, id);
    } catch {
      // Déjà effacée (ou plus visible) : rien à faire.
    }
  }
}

/** Avant la déconnexion : retire mon statut ET mes demandes du Mur (chacun tenté même si l'autre échoue). */
export async function retirerMesPublications(c: MatrixClient): Promise<void> {
  await rejoindreMur(c);
  await Promise.allSettled([retirerStatut(c), retirerMesDemandes(c)]);
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

/** Dernier événement de ce type par auteur (un effacé reste le dernier : « éteint » = plus rien). */
function dernierParAuteur(evenements: readonly MatrixEvent[], type: string): MatrixEvent[] {
  const derniers = new Map<string, MatrixEvent>();
  for (const ev of evenements) {
    const auteur = ev.getSender();
    if (ev.getType() !== type || ev.isState() || typeof auteur !== 'string') continue;
    const avant = derniers.get(auteur);
    if (!avant || ev.getTs() >= avant.getTs()) derniers.set(auteur, ev);
  }
  // Du plus ancien au plus récent : le premier arrivé garde son pseudo dans l'annuaire.
  return [...derniers.values()].sort((a, b) => a.getTs() - b.getTs());
}

function entreeStatut(ev: MatrixEvent, maintenant: number): EntreeStatutMur | null {
  const eventId = ev.getId();
  const userId = ev.getSender();
  if (ev.isRedacted() || !estIdEvenement(eventId) || typeof userId !== 'string') return null;
  const statut = nettoyerStatut(ev.getContent(), ev.getTs());
  if (!statut || statut.fin <= maintenant || !noterPseudo(userId, statut.pseudo)) return null;
  const { pseudo, metier, zone, fin, modalite, services } = statut;
  return {
    eventId,
    userId,
    pseudo,
    metier,
    zone,
    fin,
    ...(modalite ? { modalite } : {}),
    ...(services ? { services } : {}),
  };
}

function entreeDemande(ev: MatrixEvent, maintenant: number): EntreeDemande | null {
  if (ev.isRedacted()) return null;
  const d = lireDemande(ev);
  if (!d || d.demande.fin <= maintenant || !noterPseudo(d.expediteur, d.demande.pseudo))
    return null;
  const { pseudo, service, zone, texte, budget, fin } = d.demande;
  return {
    eventId: d.eventId,
    userId: d.expediteur,
    pseudo,
    service,
    zone,
    texte,
    budget,
    fin,
    creeLe: ev.getTs(),
  };
}

/** Ce que montre le Mur maintenant (sans réseau) : 1 statut et 1 demande valables au plus par personne. */
function instantane(salon: Room, maintenant: number): InstantaneMur {
  const evenements = salon.getLiveTimeline().getEvents();
  const statuts: EntreeStatutMur[] = [];
  for (const ev of dernierParAuteur(evenements, TYPE_STATUT)) {
    const e = entreeStatut(ev, maintenant);
    if (e) statuts.push(e);
  }
  const demandes: EntreeDemande[] = [];
  for (const ev of dernierParAuteur(evenements, TYPE_ANNONCE)) {
    const e = entreeDemande(ev, maintenant);
    if (e) demandes.push(e);
  }
  return { statuts, demandes };
}

async function murCharge(c: MatrixClient, duree: number): Promise<Room | null> {
  await rejoindreMur(c);
  const salon = salonMur(c);
  if (!salon) return null;
  await chargerHistorique(c, salon, Date.now() - duree - TOLERANCE_HORLOGE_MS);
  return salon;
}

/** Prestataires disponibles sur le Mur : le statut le plus récent de chaque personne, non expiré. */
export async function lireStatuts(c: MatrixClient): Promise<EntreeStatutMur[]> {
  const salon = await murCharge(c, DUREE_MAX_ANNONCE_MS);
  return salon ? instantane(salon, Date.now()).statuts : [];
}

/** Demandes de clients valables sur le Mur : la plus récente de chaque personne, non expirée. */
export async function lireDemandes(c: MatrixClient): Promise<EntreeDemande[]> {
  const salon = await murCharge(c, DUREE_DEMANDE_MS);
  return salon ? instantane(salon, Date.now()).demandes : [];
}

const DELAI_REGROUPEMENT_MS = 50;

/**
 * Appelle `rappel` avec l'état du Mur (statuts + demandes) dès qu'il est lu, puis à chaque changement
 * (nouvel événement, effacement). `auxErreur` reçoit l'échec de la première lecture (Mur injoignable).
 * Rend une fonction qui arrête l'écoute.
 */
export function ecouterMur(
  c: MatrixClient,
  rappel: (mur: InstantaneMur) => void,
  auxErreur?: (erreur: unknown) => void,
): () => void {
  let arrete = false;
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  const emettre = (): void => {
    const salon = salonMur(c) ?? c.getRooms().find((r) => estMur(r)) ?? null;
    if (salon && !arrete) rappel(instantane(salon, Date.now()));
  };
  const prevenir = (_ev: MatrixEvent, salon: Room | undefined): void => {
    if (arrete || minuterie !== null || !estMur(salon)) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      emettre();
    }, DELAI_REGROUPEMENT_MS);
  };
  c.on(RoomEvent.Timeline, prevenir);
  c.on(RoomEvent.Redaction, prevenir);
  murCharge(c, DUREE_MAX_ANNONCE_MS).then(emettre, (erreur: unknown) => auxErreur?.(erreur));
  return () => {
    arrete = true;
    if (minuterie !== null) clearTimeout(minuterie);
    c.off(RoomEvent.Timeline, prevenir);
    c.off(RoomEvent.Redaction, prevenir);
  };
}

/** Pour les tests : oublie l'identifiant du Mur. */
export function oublierMur(): void {
  idMur = null;
}
