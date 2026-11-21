import {
  ClientEvent,
  EventStatus,
  KnownMembership,
  MsgType,
  Preset,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  Visibility,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomState,
} from 'matrix-js-sdk';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api/CryptoEvent';
import { preparerPhoto } from '../appareil/photo';
import { nettoyerClients } from '../logique/clients';
import type { DemandeClient } from '../logique/demande';
import {
  etatAffiche,
  nettoyerEtatBulle,
  type EtatAffiche,
  type EtatBulle,
  type ParticipantBulle,
} from '../logique/etat-bulle';
import { avecRef, lireRaison, offresSoeurs, type InvitationRecue } from '../logique/offres';
import { LIMITES, contientCaracterePiege, estObjet, texteSur } from '../logique/profil';
import { pseudoCompatible, pseudoDe } from './annuaire';
import { dejaAffiche, effacerTout, marquerAffiche } from './ephemere';
import {
  ALGORITHME_BULLE,
  estIdSalon,
  NOM_BULLE,
  TYPE_BULLE,
  TYPE_CLIENTS,
  type ContenuEtatBulle,
} from './evenements';
import {
  lireStatuts,
  maDemandeValable,
  oublierDemandeLocale,
  retirerDemande,
  trouverDemande,
} from './mur';
import {
  chiffrerImage,
  dechiffrerImage,
  estFichierChiffre,
  type FichierChiffre,
} from './piece-jointe';

/*
 * Bulles : salons à 2 personnes, TOUJOURS chiffrés (megolm). On refuse d'y écrire sinon.
 * Contrat : 7-contrats-mise-en-relation.md (bulles.ts). L'identifiant Matrix de l'autre n'est jamais
 * rendu à l'écran : seulement son pseudo et sa zone, lus dans l'état io.sia.bulle (ou la raison de l'invitation).
 */

export type ResumeBulle = {
  roomId: string;
  autre: ParticipantBulle;
  demande: EtatBulle['demande'] | null;
  etat: EtatAffiche;
  nonLus: number;
  autreEcrit: boolean;
  /** Invitation reçue de quelqu'un qui me contacte directement (sans annonce) : « X vous demande » ou « X vous écrit ». */
  invitationDirecte?: boolean;
  /** Avec `invitationDirecte` : « X vous écrit » (un prestataire m'écrit) et non « X vous demande ». */
  invitationEcrit?: boolean;
};

/** Longueur maximale d'un message (pas fixée par le document 5 : garde-fou contre les envois énormes). */
export const LONGUEUR_MAX_MESSAGE = 1000;
/** Plafond des octets chiffrés d'une photo à télécharger (une vraie photo réduite pèse moins d'1 Mo). */
const TAILLE_PAQUET_MAX = 10 * 1024 * 1024;
const DUREE_ECRITURE_MS = 5000;
const ATTENTE_CHIFFREMENT_MS = 10_000;
/** Pas entre deux relectures locales (sans réseau) en attendant que la synchro apporte la bulle. */
const PAS_ATTENTE_MS = 100;
const DELAI_REGROUPEMENT_MS = 50;
/** Au plus un partage anticipé de la clé de chiffrement toutes les 3 s pour une même bulle. */
const PAUSE_CHAUFFAGE_MS = 3000;
const BULLES_MAX_CHAUFFAGE = 200;
const FORME_RAISON = /^(.+) \(([^()]+)\) dit oui$/;
const TYPES_MESSAGE = new Set(['m.room.message', 'm.room.encrypted']);
/** Invitations « X vous demande » affichées (et acceptables) en même temps : les autres sont quittées sans bruit. */
export const MAX_INVITATIONS_DIRECTES = 10;
const DEDANS = new Set<string>([KnownMembership.Join, KnownMembership.Invite]);
/** Bulles déjà en train d'être quittées sans bruit (évite de relancer leave à chaque rafraîchissement). */
const enDepart = new Set<string>();
/** Appareils connus de l'autre, par bulle (identifiants seulement). */
const CLE_APPAREILS = 'sia.appareils';
const BULLES_MAX_APPAREILS = 200;
const APPAREILS_MAX = 100;

/**
 * Erreur d'envoi que l'écran doit traiter à part. `pas-envoye` : le message est déjà affiché (écho local)
 * mais le serveur ne l'a pas reçu ; il reste dans le fil avec « toucher pour réessayer ».
 */
export type ErreurEnvoi = 'nouvel-appareil' | 'pas-envoye';
export class ErreurEnvoiBulle extends Error {
  readonly code: ErreurEnvoi;
  constructor(code: ErreurEnvoi) {
    super(code);
    this.name = 'ErreurEnvoiBulle';
    this.code = code;
  }
}

function moi(c: MatrixClient): string {
  const id = c.getUserId();
  if (!id) throw new Error('Client sans utilisateur.');
  return id;
}

function salonValide(c: MatrixClient, roomId: string): Room {
  const salon = estIdSalon(roomId) ? c.getRoom(roomId) : null;
  if (!salon) throw new Error('Bulle inconnue.');
  return salon;
}

/** Vrai seulement si la bulle annonce le chiffrement megolm ET que le module de chiffrement l'applique. */
export async function estChiffree(c: MatrixClient, roomId: string): Promise<boolean> {
  const salon = estIdSalon(roomId) ? c.getRoom(roomId) : null;
  const crypto = c.getCrypto();
  if (!salon || !crypto || !salon.hasEncryptionStateEvent()) return false;
  const algo = salon.currentState.getStateEvents('m.room.encryption', '')?.getContent().algorithm;
  if (algo !== ALGORITHME_BULLE) return false;
  return crypto.isEncryptionEnabledInRoom(roomId);
}

async function attendreChiffrement(c: MatrixClient, roomId: string): Promise<boolean> {
  const limite = Date.now() + ATTENTE_CHIFFREMENT_MS;
  for (;;) {
    if (await estChiffree(c, roomId)) return true;
    if (Date.now() >= limite) return false;
    await new Promise((r) => setTimeout(r, PAS_ATTENTE_MS));
  }
}

function participantSur(p: ParticipantBulle): ParticipantBulle {
  const pseudo = texteSur(p?.pseudo, LIMITES.pseudo);
  const zone = texteSur(p?.zone, LIMITES.zone);
  if (pseudo === null || zone === null) throw new Error('Pseudo ou quartier invalide.');
  return { pseudo, zone };
}

function memeDemande(a: DemandeClient, b: DemandeClient): boolean {
  return (
    a.pseudo === b.pseudo &&
    a.service === b.service &&
    a.zone === b.zone &&
    a.texte === b.texte &&
    a.budget === b.budget &&
    a.fin === b.fin
  );
}

/** Résultat de « Demander » / « Oui » : la bulle, et si elle existait déjà (on y va directement). */
export type MiseEnRelation = { roomId: string; reutilisee: boolean };

/** Une bulle ouverte avec quelqu'un. `etablie` : les deux y sont entrés (sinon l'un n'est qu'invité). */
type BulleOuverte = { roomId: string; autreId: string; etablie: boolean };

/**
 * Règle « une seule bulle par paire » (même verdict des deux côtés) : la bulle où les deux sont
 * entrés gagne ; à égalité, celle dont l'identifiant (roomId) est le plus petit.
 */
function meilleure(a: BulleOuverte, b: BulleOuverte): BulleOuverte {
  if (a.etablie !== b.etablie) return a.etablie ? a : b;
  return a.roomId < b.roomId ? a : b;
}

/** L'autre personne d'une bulle (invitation valable ou bulle rejointe), avec l'état ouvert / parti. */
function autreDe(
  c: MatrixClient,
  salon: Room,
  moiId: string,
): { autreId: string; ouverte: BulleOuverte | null } | null {
  const appartenance = salon.getMyMembership();
  if (appartenance === KnownMembership.Invite) {
    const autreId =
      lireDemandeDirecte(salon, moiId)?.autreId ?? lireOffre(c, salon, moiId)?.autreId;
    if (!autreId) return null;
    const ouverte = invitantParti(salon, autreId)
      ? null
      : { roomId: salon.roomId, autreId, etablie: false };
    return { autreId, ouverte };
  }
  if (appartenance !== KnownMembership.Join || !salon.hasEncryptionStateEvent()) return null;
  const verdict = examinerBulle(salon, moiId);
  if (verdict.statut !== 'saine' && verdict.statut !== 'autre-partie') return null;
  if (verdict.statut === 'autre-partie') return { autreId: verdict.autreId, ouverte: null };
  const etablie = salon.getMember(verdict.autreId)?.membership === KnownMembership.Join;
  return {
    autreId: verdict.autreId,
    ouverte: { roomId: salon.roomId, autreId: verdict.autreId, etablie },
  };
}

/**
 * La bulle gardée pour chaque personne (règle `meilleure`), sans compter la bulle `sauf`
 * ni celles que je suis en train de quitter.
 */
function bullesGardees(c: MatrixClient, moiId: string, sauf?: string): Map<string, BulleOuverte> {
  const gardees = new Map<string, BulleOuverte>();
  for (const salon of c.getRooms()) {
    if (salon.roomId === sauf || enDepart.has(salon.roomId)) continue;
    const ouverte = autreDe(c, salon, moiId)?.ouverte;
    if (!ouverte) continue;
    const deja = gardees.get(ouverte.autreId);
    gardees.set(ouverte.autreId, deja ? meilleure(deja, ouverte) : ouverte);
  }
  return gardees;
}

/**
 * La bulle SIA saine ouverte avec `autreUserId` (moi et lui « join » ou « invite », personne de parti),
 * ou null. S'il y en a plusieurs : celle gardée par la règle « une seule bulle par paire ».
 */
export function bulleAvec(c: MatrixClient, autreUserId: string): string | null {
  const moiId = c.getUserId();
  if (!moiId || typeof autreUserId !== 'string' || autreUserId === moiId) return null;
  return bullesGardees(c, moiId).get(autreUserId)?.roomId ?? null;
}

/**
 * Bulle déjà ouverte avec cette personne (hors `sauf`, bulle que je viens de quitter) :
 * l'accepte si je n'y suis qu'invité, et la rend.
 */
async function reutiliser(
  c: MatrixClient,
  autreId: string,
  sauf?: string,
): Promise<MiseEnRelation | null> {
  const roomId = bullesGardees(c, moi(c), sauf).get(autreId)?.roomId ?? null;
  if (roomId === null) return null;
  if (c.getRoom(roomId)?.getMyMembership() === KnownMembership.Invite) {
    await accepterOffre(c, roomId);
  }
  return { roomId, reutilisee: true };
}

/**
 * Prestataire : « Je dis oui » à une demande. Crée la bulle chiffrée et invite le client, SAUF si une
 * bulle est déjà ouverte avec ce client : elle est alors réutilisée (acceptée si besoin).
 * La demande est relue sur le Mur (source sûre de l'expéditeur) et doit être identique à celle affichée.
 */
export async function direOui(
  c: MatrixClient,
  demande: DemandeClient,
  eventId: string,
  moiPublic: ParticipantBulle,
): Promise<MiseEnRelation> {
  const presta = participantSur(moiPublic);
  const annonce = await trouverDemande(c, eventId);
  if (!annonce || !memeDemande(annonce.demande, demande)) throw new Error('Demande introuvable.');
  if (annonce.demande.fin <= Date.now()) throw new Error('Demande expirée.');
  const client = annonce.expediteur;
  const moiId = moi(c);
  if (client === moiId) throw new Error('Impossible de répondre à sa propre demande.');
  const existante = await reutiliser(c, client);
  if (existante) return existante;

  const d = annonce.demande;
  const etat: ContenuEtatBulle = {
    demande: {
      annonce: eventId,
      service: d.service,
      zone: d.zone,
      budget: d.budget,
      texte: d.texte,
    },
    participants: { [moiId]: presta, [client]: { pseudo: d.pseudo, zone: d.zone } },
  };
  if (!nettoyerEtatBulle(etat)) throw new Error('Bulle invalide.');

  const { room_id } = await c.createRoom({
    name: NOM_BULLE,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    // Bulle à 2 : personne d'autre ne peut être invité ; chacun peut effacer les messages (1 min).
    power_level_content_override: {
      invite: 100,
      kick: 100,
      ban: 100,
      state_default: 100,
      events_default: 0,
      redact: 0,
    },
    initial_state: [
      { type: 'm.room.encryption', state_key: '', content: { algorithm: ALGORITHME_BULLE } },
      { type: TYPE_BULLE, state_key: '', content: etat },
    ],
  });
  try {
    await c.invite(room_id, client, {
      reason: avecRef(`${presta.pseudo} (${presta.zone}) dit oui`, eventId),
    });
  } catch (erreur) {
    await abandonnerBulle(c, room_id, client);
    throw erreur;
  }
  return { roomId: room_id, reutilisee: false };
}

/** Échec après la création : annule l'invitation si elle est partie, puis quitte la bulle (chaque étape tentée). */
async function abandonnerBulle(c: MatrixClient, roomId: string, invite: string): Promise<void> {
  await c.kick(roomId, invite, 'annulé').catch(() => undefined);
  await c.leave(roomId).catch(() => undefined);
}

const FORME_RAISON_DIRECTE = /^(.+) \(([^()]+)\) vous (demande|écrit)$/;
const RAISON_DIRECTE_MAX = LIMITES.pseudo + LIMITES.zone + ' () vous demande'.length;
const ATTENTE_BULLE_MS = 10_000;
/** Prestataires à qui une demande est en train de partir (évite le double clic). */
const demandesEnCours = new Set<string>();

/** `ecrit` : « vous écrit » (un prestataire m'écrit) ; sinon « vous demande » (un client me demande). */
type DemandeDirecte = { autreId: string; autre: ParticipantBulle; ecrit: boolean };

/**
 * Lit une invitation « <pseudo> (<zone>) vous demande » (client qui demande directement) ou « … vous écrit »
 * (prestataire qui écrit à un client enregistré), sans annonce ni référence. Pseudo et zone lisibles, pseudo
 * non pris par un autre compte connu. Sinon null.
 */
function lireDemandeDirecte(salon: Room, moiId: string): DemandeDirecte | null {
  const evMembre = salon.getMember(moiId)?.events.member;
  const raison: unknown = evMembre?.getContent().reason;
  if (typeof raison !== 'string' || raison.length > RAISON_DIRECTE_MAX) return null;
  if (contientCaracterePiege(raison) || raison.includes('[ref:')) return null;
  const forme = FORME_RAISON_DIRECTE.exec(raison);
  const pseudo = texteSur(forme?.[1], LIMITES.pseudo);
  const zone = texteSur(forme?.[2], LIMITES.zone);
  const autreId = evMembre?.getSender();
  if (pseudo === null || zone === null || !autreId || autreId === moiId) return null;
  // Texte libre : le pseudo n'est JAMAIS enregistré ici (seuls le Mur et les statuts réservent un pseudo).
  if (!pseudoCompatible(autreId, pseudo)) return null;
  return { autreId, autre: { pseudo, zone }, ecrit: forme?.[3] === 'écrit' };
}

/** Bulle ouverte par « Demander » ou « Écrire » : sans annonce, à 2 (l'invitant, qui l'a créée, et moi), chiffrée. */
function bulleDirecteAttendue(salon: Room, moiId: string, directe: DemandeDirecte): boolean {
  const etat = lireEtat(salon);
  const verdict = examinerBulle(salon, moiId);
  return (
    etat !== null &&
    etat.demande === null &&
    verdict.statut === 'saine' &&
    verdict.autreId === directe.autreId &&
    verdict.createur === directe.autreId
  );
}

async function accepterDemandeDirecte(
  c: MatrixClient,
  roomId: string,
  moiId: string,
  directe: DemandeDirecte,
): Promise<void> {
  await c.joinRoom(roomId);
  const chiffree = await attendreChiffrement(c, roomId);
  const rejointe = c.getRoom(roomId);
  if (rejointe) await chargerMembres(rejointe);
  if (!chiffree || !rejointe || !bulleDirecteAttendue(rejointe, moiId, directe)) {
    await c.leave(roomId).catch(() => undefined);
    throw new Error('Bulle non chiffrée ou invalide : refusée.');
  }
  // Bulle vérifiée : la clé est partagée en arrière-plan, mon premier message partira en un aller-retour.
  prechaufferBulle(c, roomId);
}

/** Attend (10 s au plus) que `condition` soit vraie. */
async function attendre(condition: () => boolean | Promise<boolean>): Promise<boolean> {
  const limite = Date.now() + ATTENTE_BULLE_MS;
  for (;;) {
    if (await condition()) return true;
    if (Date.now() >= limite) return false;
    await new Promise((r) => setTimeout(r, PAS_ATTENTE_MS));
  }
}

/**
 * Client : « Demander » à un prestataire, en un clic. Crée une bulle chiffrée à 2 et invite CE SEUL
 * prestataire (il doit avoir un statut « disponible » valable sur le Mur). Rien de la demande n'est
 * envoyé : ni budget, ni description (la raison de l'invitation est « <pseudo> (<zone>) vous demande »).
 * La bulle doit être chiffrée et saine (2 personnes) ; sinon elle est quittée et l'envoi échoue.
 * Si une bulle est déjà ouverte avec ce prestataire, rien n'est créé : elle est réutilisée.
 */
export async function demanderA(
  c: MatrixClient,
  userIdPrestataire: string,
  moiPublic: ParticipantBulle,
): Promise<MiseEnRelation> {
  if (demandesEnCours.has(userIdPrestataire)) throw new Error('Demande déjà envoyée.');
  demandesEnCours.add(userIdPrestataire);
  try {
    return await demanderAUneFois(c, userIdPrestataire, moiPublic);
  } finally {
    demandesEnCours.delete(userIdPrestataire);
  }
}

async function demanderAUneFois(
  c: MatrixClient,
  userIdPrestataire: string,
  moiPublic: ParticipantBulle,
): Promise<MiseEnRelation> {
  const moiId = moi(c);
  const client = participantSur(moiPublic);
  if (typeof userIdPrestataire !== 'string' || userIdPrestataire === moiId) {
    throw new Error('Impossible de se demander à soi-même.');
  }
  const existante = await reutiliser(c, userIdPrestataire);
  if (existante) return existante;
  const statut = (await lireStatuts(c)).find((s) => s.userId === userIdPrestataire);
  if (!statut) throw new Error('Prestataire indisponible.');
  const presta = participantSur({ pseudo: statut.pseudo, zone: statut.zone });
  return ouvrirBulleDirecte(c, userIdPrestataire, client, presta, 'vous demande');
}

/**
 * Prestataire : « Écrire » à un client enregistré dans MA liste (donnée de compte `io.sia.clients`). Comme
 * « Demander », dans l'autre sens : bulle chiffrée à 2 sans annonce, invitation « <pseudo> (<zone>) vous écrit » à
 * ce seul client, qui peut refuser. Une bulle déjà ouverte avec lui est réutilisée. Un compte absent de ma liste
 * est refusé : on n'écrit qu'à quelqu'un avec qui une bulle a déjà été ouverte.
 */
export async function ecrireA(
  c: MatrixClient,
  userIdClient: string,
  moiPublic: ParticipantBulle,
): Promise<MiseEnRelation> {
  if (demandesEnCours.has(userIdClient)) throw new Error('Message déjà en route.');
  demandesEnCours.add(userIdClient);
  try {
    return await ecrireAUneFois(c, userIdClient, moiPublic);
  } finally {
    demandesEnCours.delete(userIdClient);
  }
}

async function ecrireAUneFois(
  c: MatrixClient,
  userIdClient: string,
  moiPublic: ParticipantBulle,
): Promise<MiseEnRelation> {
  const moiId = moi(c);
  const presta = participantSur(moiPublic);
  if (typeof userIdClient !== 'string' || userIdClient === moiId) {
    throw new Error("Impossible de s'écrire à soi-même.");
  }
  const contact = nettoyerClients(c.getAccountData(TYPE_CLIENTS)?.getContent()).find(
    (x) => x.userId === userIdClient,
  );
  if (!contact) throw new Error('Client non enregistré.');
  const existante = await reutiliser(c, userIdClient);
  if (existante) return existante;
  const client = participantSur({ pseudo: contact.pseudo, zone: contact.zone });
  return ouvrirBulleDirecte(c, userIdClient, presta, client, 'vous écrit');
}

/**
 * Crée la bulle chiffrée à 2 (sans annonce) et y invite `cibleId`, avec la raison « <moi> (<quartier>) <verbe> ».
 * Rien de plus n'est envoyé : ni budget, ni description. La bulle doit être chiffrée et saine (2 personnes) ;
 * sinon elle est quittée et l'envoi échoue.
 */
async function ouvrirBulleDirecte(
  c: MatrixClient,
  cibleId: string,
  moiP: ParticipantBulle,
  cibleP: ParticipantBulle,
  verbe: 'vous demande' | 'vous écrit',
): Promise<MiseEnRelation> {
  const moiId = moi(c);
  // Pas de champ demande : aucune annonce, aucun budget, aucune description dans la bulle.
  const etat = { participants: { [moiId]: moiP, [cibleId]: cibleP } };
  if (!nettoyerEtatBulle({ ...etat, demande: DEMANDE_NEUTRE })) throw new Error('Bulle invalide.');

  const { room_id } = await c.createRoom({
    name: NOM_BULLE,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    // Bulle à 2 : personne d'autre ne peut être invité ; chacun peut effacer les messages (1 min).
    power_level_content_override: {
      invite: 100,
      kick: 100,
      ban: 100,
      state_default: 100,
      events_default: 0,
      redact: 0,
    },
    initial_state: [
      { type: 'm.room.encryption', state_key: '', content: { algorithm: ALGORITHME_BULLE } },
      { type: TYPE_BULLE, state_key: '', content: etat },
    ],
  });
  try {
    // L'invitation part tout de suite pendant que la synchro apporte la bulle : les deux attentes se
    // recouvrent (2 allers-retours en tout, au lieu de 2 puis l'attente de la synchro).
    const bulleSure = attendre(
      async () => (await estChiffree(c, room_id)) && bulleCreeeSaine(c, room_id),
    ).catch(() => false);
    await c.invite(room_id, cibleId, { reason: `${moiP.pseudo} (${moiP.zone}) ${verbe}` });
    if (!(await bulleSure)) throw new Error('Bulle non chiffrée ou invalide : demande annulée.');
  } catch (erreur) {
    await abandonnerBulle(c, room_id, cibleId);
    // Course croisée : ma bulle a perdu contre celle que l'autre m'a ouverte en même temps → on y va.
    const gagnante = await reutiliser(c, cibleId, room_id).catch(() => null);
    if (gagnante) return gagnante;
    throw erreur;
  }
  return { roomId: room_id, reutilisee: false };
}

/**
 * Bulle que je viens de créer : saine, ou saine sauf que l'invitation de l'autre n'est pas encore arrivée
 * par la synchro (le serveur l'a déjà acquittée). Chiffrée, à 2 au plus, état io.sia.bulle valable et écrit
 * par moi : tout le reste de `bulleSaine` est exigé. Un autre déjà parti ou banni reste refusé.
 */
function bulleCreeeSaine(c: MatrixClient, roomId: string): boolean {
  const moiId = c.getUserId();
  const salon = estIdSalon(roomId) ? c.getRoom(roomId) : null;
  if (!moiId || !salon) return false;
  const verdict = examinerBulle(salon, moiId);
  if (verdict.statut !== 'saine' && verdict.statut !== 'autre-partie') return false;
  if (verdict.createur !== moiId) return false;
  return verdict.statut === 'saine' || salon.getMember(verdict.autreId) === null;
}

function raisonInvitation(salon: Room, moiId: string): unknown {
  return salon.getMember(moiId)?.events.member?.getContent().reason;
}

function invitationsRecues(c: MatrixClient, moiId: string): InvitationRecue[] {
  return c
    .getRooms()
    .filter((r) => r.getMyMembership() === KnownMembership.Invite)
    .map((r) => ({ roomId: r.roomId, raison: raisonInvitation(r, moiId) }));
}

/** Quitte une bulle sans bruit (une seule fois à la fois). */
function quitterSansBruit(c: MatrixClient, roomId: string): void {
  if (enDepart.has(roomId)) return;
  enDepart.add(roomId);
  void c
    .leave(roomId)
    .catch(() => undefined)
    .finally(() => enDepart.delete(roomId));
}

type Offre = { autreId: string; ref: string; autre: ParticipantBulle; demande: DemandeClient };

/**
 * Lit une invitation reçue : valable seulement si elle répond à MA demande encore valable, avec un
 * pseudo et une zone lisibles, et un pseudo qui n'appartient pas à un autre compte. Sinon null.
 */
function lireOffre(c: MatrixClient, salon: Room, moiId: string): Offre | null {
  const evMembre = salon.getMember(moiId)?.events.member;
  const raison = lireRaison(evMembre?.getContent().reason);
  const forme = FORME_RAISON.exec(raison.texte);
  const pseudo = texteSur(forme?.[1], LIMITES.pseudo);
  const zone = texteSur(forme?.[2], LIMITES.zone);
  const autreId = evMembre?.getSender();
  if (!raison.ref || pseudo === null || zone === null || !autreId || autreId === moiId) return null;
  const demande = maDemandeValable(c, raison.ref);
  if (!demande || !pseudoCompatible(autreId, pseudo)) return null;
  return { autreId, ref: raison.ref, autre: { pseudo, zone }, demande };
}

/**
 * Client : accepte une offre. Rejoint la bulle, vérifie qu'elle est chiffrée et bien à 2 (moi et le
 * prestataire qui m'a invité) — sinon la quitte —, puis la rend tout de suite. Le reste ne fait pas
 * attendre : les autres offres pour la même demande sont refusées (elles quittent la liste aussitôt),
 * la demande est oubliée sur ce téléphone et retirée du Mur, le chiffrement est préparé.
 */
export async function accepterOffre(c: MatrixClient, roomId: string): Promise<void> {
  const salon = salonValide(c, roomId);
  const moiId = moi(c);
  if (salon.getMyMembership() !== KnownMembership.Invite) throw new Error('Offre introuvable.');
  const directe = lireDemandeDirecte(salon, moiId);
  if (directe) {
    if (!invitationsDirectesRetenues(c, moiId).has(roomId)) {
      await c.leave(roomId).catch(() => undefined);
      throw new Error('Trop de demandes en attente : refusée.');
    }
    return accepterDemandeDirecte(c, roomId, moiId, directe);
  }
  const offre = lireOffre(c, salon, moiId);
  if (!offre) {
    await c.leave(roomId).catch(() => undefined);
    throw new Error('Offre invalide : refusée.');
  }
  const soeurs = offresSoeurs(invitationsRecues(c, moiId), roomId);
  await c.joinRoom(roomId);
  const chiffree = await attendreChiffrement(c, roomId);
  const rejointe = c.getRoom(roomId);
  if (rejointe) await chargerMembres(rejointe);
  if (!chiffree || !rejointe || !bulleAttendue(rejointe, moiId, offre)) {
    await c.leave(roomId).catch(() => undefined);
    throw new Error('Bulle non chiffrée ou invalide : refusée.');
  }
  oublierDemandeLocale();
  for (const soeur of soeurs) quitterSansBruit(c, soeur);
  void retirerDemande(c, offre.ref).catch(() => undefined);
  prechaufferBulle(c, roomId);
}

/** Charge la liste complète des membres (le client ne charge que ceux qu'il voit passer). */
async function chargerMembres(salon: Room): Promise<void> {
  await salon.loadMembersIfNeeded().catch(() => false);
}

/** La bulle rejointe correspond à l'offre : saine, l'autre est celui qui m'a invité et l'a créée. */
function bulleAttendue(salon: Room, moiId: string, offre: Offre): boolean {
  const etat = lireEtat(salon);
  const verdict = examinerBulle(salon, moiId);
  return (
    etat !== null &&
    etat.demande !== null &&
    verdict.statut === 'saine' &&
    verdict.autreId === offre.autreId &&
    verdict.createur === offre.autreId &&
    etat.demande.annonce === offre.ref
  );
}

/** Refuse une offre (ou quitte une bulle). */
export async function refuserOffre(c: MatrixClient, roomId: string): Promise<void> {
  salonValide(c, roomId);
  await c.leave(roomId);
}

/** État lu d'une bulle : `demande` est null pour une bulle ouverte par « Demander » (pas d'annonce). */
type EtatLu = { demande: EtatBulle['demande'] | null; participants: EtatBulle['participants'] };

/** Valeurs neutres, jamais rendues : servent seulement à faire valider les participants. */
const DEMANDE_NEUTRE = { annonce: '$neutre', service: 'x', zone: 'x', budget: 1, texte: '' };

export function lireEtat(salon: Room): EtatLu | null {
  const brut: unknown = salon.currentState.getStateEvents(TYPE_BULLE, '')?.getContent();
  if (estObjet(brut) && brut.demande === undefined) {
    const sans = nettoyerEtatBulle({ ...brut, demande: DEMANDE_NEUTRE });
    return sans ? { demande: null, participants: sans.participants } : null;
  }
  return nettoyerEtatBulle(brut);
}

function nonLus(salon: Room, autreId: string): number {
  return salon
    .getLiveTimeline()
    .getEvents()
    .filter((ev) => {
      const id = ev.getId();
      return (
        TYPES_MESSAGE.has(ev.getType()) &&
        ev.getSender() === autreId &&
        !ev.isRedacted() &&
        id !== undefined &&
        !dejaAffiche(id)
      );
    }).length;
}

type Verdict =
  | { statut: 'saine' | 'autre-partie'; autreId: string; createur: string }
  | { statut: 'suspecte' }
  | { statut: 'pas-bulle' };

/**
 * Examine une bulle : état io.sia.bulle à exactement 2 participants (moi et l'autre), écrit par le
 * créateur (le prestataire), et personne d'autre rejoint ou invité. « autre-partie » : l'autre a quitté.
 */
function examinerBulle(salon: Room, moiId: string): Verdict {
  const evEtat = salon.currentState.getStateEvents(TYPE_BULLE, '');
  const etat = lireEtat(salon);
  if (!evEtat || !etat) return { statut: 'pas-bulle' };
  const ids = Object.keys(etat.participants);
  const autreId = ids.find((id) => id !== moiId);
  const createur = salon.getCreator();
  if (ids.length !== 2 || !ids.includes(moiId) || !autreId || !createur) {
    return { statut: 'suspecte' };
  }
  if (!ids.includes(createur) || evEtat.getSender() !== createur) return { statut: 'suspecte' };
  const autorises = new Set([moiId, autreId]);
  const intrus = salon
    .getMembers()
    .some((m) => DEDANS.has(m.membership ?? '') && !autorises.has(m.userId));
  if (intrus || salon.getJoinedMemberCount() + salon.getInvitedMemberCount() > 2) {
    return { statut: 'suspecte' };
  }
  const membreAutre = salon.getMember(autreId);
  // Côté prestataire, l'autre ne peut avoir été invité que par moi.
  const invitePar = membreAutre?.events.member?.getSender();
  if (membreAutre?.membership === KnownMembership.Invite && invitePar !== moiId) {
    return { statut: 'suspecte' };
  }
  const moiDedans = DEDANS.has(salon.getMyMembership());
  const autreDedans = DEDANS.has(membreAutre?.membership ?? '');
  return { statut: moiDedans && autreDedans ? 'saine' : 'autre-partie', autreId, createur };
}

/**
 * Vrai si la bulle est bien à 2 : membres rejoints + invités = exactement {moi, l'autre}, participants
 * de io.sia.bulle = ces 2 comptes, l'autre étant le créateur (client) ou mon invité (prestataire).
 */
export function bulleSaine(c: MatrixClient, roomId: string): boolean {
  const moiId = c.getUserId();
  const salon = estIdSalon(roomId) ? c.getRoom(roomId) : null;
  if (!moiId || !salon) return false;
  return examinerBulle(salon, moiId).statut === 'saine';
}

/**
 * L'autre personne d'une bulle saine où elle est entrée : son compte (jamais affiché), son pseudo et son quartier.
 * Null tant qu'elle n'a pas accepté (ou si elle est partie) et pour une bulle douteuse : on n'enregistre comme
 * client que quelqu'un qui a accepté de discuter.
 */
export function autreDeBulle(
  c: MatrixClient,
  roomId: string,
): (ParticipantBulle & { userId: string }) | null {
  const moiId = c.getUserId();
  const salon = estIdSalon(roomId) ? c.getRoom(roomId) : null;
  if (!moiId || !salon) return null;
  const verdict = examinerBulle(salon, moiId);
  if (verdict.statut !== 'saine') return null;
  if (salon.getMember(verdict.autreId)?.membership !== KnownMembership.Join) return null;
  const declare = lireEtat(salon)?.participants[verdict.autreId];
  const autre = declare ? autreAffiche(verdict.autreId, declare) : null;
  return autre ? { userId: verdict.autreId, ...autre } : null;
}

/** Vrai si l'invitant a déjà quitté la bulle (invitation morte). */
function invitantParti(salon: Room, autreId: string): boolean {
  const appartenance = salon.getMember(autreId)?.membership;
  return appartenance === KnownMembership.Leave || appartenance === KnownMembership.Ban;
}

/**
 * Invitations « X vous demande » à garder : valables, invitant encore là, les plus récentes
 * d'abord, MAX_INVITATIONS_DIRECTES au plus. Les surnuméraires et les mortes sont quittées sans bruit.
 */
function invitationsDirectesRetenues(c: MatrixClient, moiId: string): Set<string> {
  const retenues = new Set<string>();
  const invitations = c
    .getRooms()
    .filter((r) => r.getMyMembership() === KnownMembership.Invite)
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
  for (const salon of invitations) {
    const directe = lireDemandeDirecte(salon, moiId);
    if (!directe) continue;
    if (invitantParti(salon, directe.autreId) || retenues.size >= MAX_INVITATIONS_DIRECTES) {
      quitterSansBruit(c, salon.roomId);
    } else {
      retenues.add(salon.roomId);
    }
  }
  return retenues;
}

function resumeInvitation(
  c: MatrixClient,
  salon: Room,
  moiId: string,
  retenues: ReadonlySet<string>,
): ResumeBulle | null {
  const directe = lireDemandeDirecte(salon, moiId);
  if (directe) {
    if (!retenues.has(salon.roomId)) return null;
    return {
      roomId: salon.roomId,
      autre: directe.autre,
      demande: null,
      etat: 'invitation-recue',
      nonLus: 0,
      autreEcrit: false,
      invitationDirecte: true,
      ...(directe.ecrit ? { invitationEcrit: true } : {}),
    };
  }
  const offre = lireOffre(c, salon, moiId);
  if (!offre || invitantParti(salon, offre.autreId)) {
    // Offre qui ne répond pas à MA demande encore valable (ou dont l'auteur est parti) : refusée sans bruit.
    quitterSansBruit(c, salon.roomId);
    return null;
  }
  const d = offre.demande;
  const etat = etatAffiche({
    monAppartenance: KnownMembership.Invite,
    autreAppartenance: salon.getMember(offre.autreId)?.membership,
    autreEcrit: false,
  });
  return {
    roomId: salon.roomId,
    autre: offre.autre,
    demande: {
      annonce: offre.ref,
      service: d.service,
      zone: d.zone,
      budget: d.budget,
      texte: d.texte,
    },
    etat: etat.etat,
    nonLus: 0,
    autreEcrit: false,
  };
}

/** Pseudo de l'autre : celui de l'annuaire pour son vrai compte ; sinon le déclaré s'il n'est pas pris (rien n'est enregistré) ; null si usurpé. */
function autreAffiche(autreId: string, declare: ParticipantBulle): ParticipantBulle | null {
  const connu = pseudoDe(autreId);
  if (connu !== null) return { pseudo: connu, zone: declare.zone };
  return pseudoCompatible(autreId, declare.pseudo) ? declare : null;
}

function resumeBulle(c: MatrixClient, salon: Room, moiId: string): ResumeBulle | null {
  const etatBulle = lireEtat(salon);
  if (!etatBulle || !salon.hasEncryptionStateEvent()) return null;
  const verdict = examinerBulle(salon, moiId);
  if (verdict.statut === 'pas-bulle') return null;
  const declare =
    verdict.statut === 'suspecte' ? undefined : etatBulle.participants[verdict.autreId];
  const autre =
    verdict.statut === 'suspecte' || !declare ? null : autreAffiche(verdict.autreId, declare);
  if (verdict.statut === 'suspecte' || !autre) {
    // Bulle à plus de 2, mal formée ou pseudo usurpé : quittée sans bruit.
    quitterSansBruit(c, salon.roomId);
    return null;
  }
  const autreId = verdict.autreId;
  const membre = salon.getMember(autreId);
  const autreEcrit = membre?.typing === true;
  const etat = etatAffiche({
    monAppartenance: salon.getMyMembership(),
    autreAppartenance: membre?.membership,
    autreEcrit,
  });
  return {
    roomId: salon.roomId,
    autre,
    demande: etatBulle.demande,
    etat: etat.etat,
    nonLus: nonLus(salon, autreId),
    autreEcrit,
  };
}

/**
 * Vrai si une AUTRE bulle est gardée avec la même personne : celle-ci (invitation en double, bulle
 * perdante d'une course croisée, ou bulle fermée remplacée) est alors quittée sans bruit.
 */
function enDoublon(
  c: MatrixClient,
  salon: Room,
  moiId: string,
  gardees: ReadonlyMap<string, BulleOuverte>,
): boolean {
  const autre = autreDe(c, salon, moiId);
  const gardee = autre ? gardees.get(autre.autreId) : undefined;
  return gardee !== undefined && gardee.roomId !== salon.roomId;
}

/** Bulles et offres reçues, la plus récente d'abord (une seule bulle par personne). */
export function listerBulles(c: MatrixClient): ResumeBulle[] {
  const moiId = c.getUserId();
  if (!moiId) return [];
  const retenues = invitationsDirectesRetenues(c, moiId);
  const gardees = bullesGardees(c, moiId);
  return c
    .getRooms()
    .map((salon) => {
      // Bulle que je suis en train de quitter (le serveur n'a pas encore répondu) : plus dans la liste.
      if (enDepart.has(salon.roomId)) return { salon, r: null };
      if (enDoublon(c, salon, moiId, gardees)) {
        quitterSansBruit(c, salon.roomId);
        return { salon, r: null };
      }
      const appartenance = salon.getMyMembership();
      if (appartenance === KnownMembership.Invite)
        return { salon, r: resumeInvitation(c, salon, moiId, retenues) };
      if (appartenance === KnownMembership.Join) return { salon, r: resumeBulle(c, salon, moiId) };
      return { salon, r: null };
    })
    .filter((x): x is { salon: Room; r: ResumeBulle } => x.r !== null)
    .sort((a, b) => b.salon.getLastActiveTimestamp() - a.salon.getLastActiveTimestamp())
    .map((x) => x.r);
}

/**
 * Prestataire : ferme (quitte) les bulles dont le client est parti sans jamais les rejoindre
 * (offre refusée, ou autre prestataire choisi).
 */
export async function fermerBullesRefusees(c: MatrixClient): Promise<void> {
  const moiId = c.getUserId();
  if (!moiId) return;
  for (const salon of c.getRooms()) {
    if (salon.getMyMembership() !== KnownMembership.Join) continue;
    const etat = lireEtat(salon);
    const autreId = etat ? Object.keys(etat.participants).find((id) => id !== moiId) : undefined;
    const evMembre = autreId ? salon.getMember(autreId)?.events.member : undefined;
    if (!evMembre || evMembre.getContent().membership !== KnownMembership.Leave) continue;
    if (evMembre.getPrevContent().membership !== KnownMembership.Invite) continue;
    await c.leave(salon.roomId).catch(() => undefined);
  }
}

/** Bulles saines où je suis entré : en attente de l'autre, ou ouvertes (celles dont le chiffrement se prépare). */
function bullesAChauffer(c: MatrixClient, liste: readonly ResumeBulle[]): Set<string> {
  return new Set(
    liste
      .filter((b) => (b.etat === 'ouverte' || b.etat === 'en-attente') && bulleSaine(c, b.roomId))
      .map((b) => b.roomId),
  );
}

/**
 * Appelle `rappel` avec la liste à jour à chaque changement. Rend une fonction qui arrête l'écoute.
 * Une bulle qui devient ouverte (ou en attente de l'autre) pendant l'écoute voit son chiffrement préparé
 * tout de suite ; celles déjà là au premier tour le sont quand on les ouvre ou qu'on y écrit.
 */
export function ecouterBulles(c: MatrixClient, rappel: (b: ResumeBulle[]) => void): () => void {
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let arrete = false;
  let dejaVues: ReadonlySet<string> | null = null;
  const prevenir = (): void => {
    if (minuterie !== null || arrete) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      if (arrete) return;
      void fermerBullesRefusees(c);
      const liste = listerBulles(c);
      rappel(liste);
      // Après l'écran : le préchauffage ne retarde jamais l'affichage de la liste.
      const aChauffer = bullesAChauffer(c, liste);
      if (dejaVues !== null) {
        for (const roomId of aChauffer) if (!dejaVues.has(roomId)) prechaufferBulle(c, roomId);
      }
      dejaVues = aChauffer;
    }, DELAI_REGROUPEMENT_MS);
  };
  const evenements = [
    ClientEvent.Room,
    RoomEvent.MyMembership,
    RoomEvent.Timeline,
    RoomEvent.Redaction,
    RoomMemberEvent.Typing,
    RoomMemberEvent.Membership,
    RoomStateEvent.Events,
  ] as const;
  for (const nom of evenements) c.on(nom, prevenir);
  prevenir();
  return () => {
    arrete = true;
    if (minuterie !== null) clearTimeout(minuterie);
    for (const nom of evenements) c.off(nom, prevenir);
  };
}

type CarteAppareils = Record<string, string[]>;

function lireAppareils(): CarteAppareils {
  try {
    const brut = localStorage.getItem(CLE_APPAREILS);
    if (brut === null) return {};
    const donnees: unknown = JSON.parse(brut);
    if (typeof donnees !== 'object' || donnees === null || Array.isArray(donnees)) return {};
    const propre: CarteAppareils = {};
    for (const [roomId, ids] of Object.entries(donnees).slice(-BULLES_MAX_APPAREILS)) {
      if (!estIdSalon(roomId) || !Array.isArray(ids)) continue;
      propre[roomId] = ids
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 255)
        .slice(0, APPAREILS_MAX);
    }
    return propre;
  } catch {
    return {};
  }
}

function retenirAppareils(roomId: string, ids: readonly string[]): void {
  const carte = Object.entries(lireAppareils()).filter(([id]) => id !== roomId);
  const nouvelle = [...carte, [roomId, ids.slice(0, APPAREILS_MAX)] as const].slice(
    -BULLES_MAX_APPAREILS,
  );
  try {
    localStorage.setItem(CLE_APPAREILS, JSON.stringify(Object.fromEntries(nouvelle)));
  } catch {
    // Stockage plein ou interdit : les appareils seront relus au prochain envoi.
  }
}

/** Identifiants des appareils actuels de `userId` (liste demandée au serveur si besoin). */
async function appareilsDe(c: MatrixClient, userId: string): Promise<string[]> {
  const crypto = c.getCrypto();
  if (!crypto) throw new Error('Chiffrement indisponible.');
  const carte = await crypto.getUserDeviceInfo([userId], true);
  return [...(carte.get(userId)?.keys() ?? [])];
}

/**
 * Anti homme du milieu : au premier échange, retient les appareils de l'autre ; ensuite, signale
 * « nouveau » si l'autre a un appareil inconnu (l'envoi sera alors refusé).
 */
function comparerAppareils(roomId: string, actuels: readonly string[]): 'connus' | 'nouveau' {
  const connus = lireAppareils()[roomId];
  if (connus === undefined) {
    if (actuels.length > 0) retenirAppareils(roomId, actuels);
    return 'connus';
  }
  return actuels.some((id) => !connus.includes(id)) ? 'nouveau' : 'connus';
}

/** L'autre participant lu dans l'état io.sia.bulle : une présomption, le verdict complet est refait ensuite. */
function autrePresume(salon: Room, moiId: string): string | null {
  const etat = lireEtat(salon);
  return etat ? (Object.keys(etat.participants).find((id) => id !== moiId) ?? null) : null;
}

/*
 * Vérifications lourdes (chiffrement, 2 membres, appareils de l'autre) faites UNE fois à l'ouverture
 * de la bulle, puis refaites seulement quand l'état, les membres ou les appareils changent.
 * Le résultat en mémoire n'est utilisé QUE pendant qu'une surveillance est active (sinon, personne
 * ne l'invaliderait) : sans surveillance, chaque envoi refait toutes les vérifications.
 */
type Preparation = { autreId: string; appareils: 'connus' | 'nouveau' };
const preparees = new Map<string, Preparation>();
const enPreparation = new Map<string, Promise<Preparation>>();
const surveillances = new Map<string, number>();
/** Augmente à chaque invalidation : une vérification commencée avant un changement est refaite. */
const versions = new Map<string, number>();
const ESSAIS_PREPARATION = 3;

function clePreparation(c: MatrixClient, roomId: string): string {
  return `${c.getUserId() ?? ''}|${roomId}`;
}

/** Contrôle sans réseau, juste avant l'envoi : bulle rejointe, état SIA, megolm annoncé, toujours à 2. */
function etatSainEnMemoire(salon: Room, moiId: string): Verdict {
  if (salon.getMyMembership() !== KnownMembership.Join || !lireEtat(salon)) {
    throw new Error('Bulle fermée.');
  }
  const algo = salon.currentState.getStateEvents('m.room.encryption', '')?.getContent().algorithm;
  if (!salon.hasEncryptionStateEvent() || algo !== ALGORITHME_BULLE) {
    throw new Error('Bulle non chiffrée : envoi refusé.');
  }
  return examinerBulle(salon, moiId);
}

/** Refuse (et quitte si suspecte) une bulle qui n'est pas saine. */
async function exigerSaine(c: MatrixClient, roomId: string, verdict: Verdict): Promise<string> {
  if (verdict.statut === 'suspecte') {
    await c.leave(roomId).catch(() => undefined);
    throw new Error('Bulle invalide : quittée.');
  }
  if (verdict.statut !== 'saine') throw new Error('Bulle fermée.');
  return verdict.autreId;
}

async function preparerUneFois(c: MatrixClient, roomId: string): Promise<Preparation> {
  const salon = salonValide(c, roomId);
  const moiId = moi(c);
  etatSainEnMemoire(salon, moiId);
  if (!(await estChiffree(c, roomId))) throw new Error('Bulle non chiffrée : envoi refusé.');
  // Liste des membres et appareils de l'autre : deux demandes au serveur indépendantes, parties ensemble
  // (un aller-retour au lieu de deux). Les appareils sont demandés pour l'autre lu dans l'état de la
  // bulle ; le verdict complet (2 membres, créateur…) est refait sur la liste chargée, avant de s'en servir.
  const presume = autrePresume(salon, moiId);
  const appareils = presume === null ? null : appareilsDe(c, presume);
  appareils?.catch(() => undefined); // son échec éventuel est relu plus bas, pas ici
  await chargerMembres(salon);
  const autreId = await exigerSaine(c, roomId, examinerBulle(salon, moiId));
  const actuels =
    appareils !== null && autreId === presume ? await appareils : await appareilsDe(c, autreId);
  return { autreId, appareils: comparerAppareils(roomId, actuels) };
}

/** Lance (ou rejoint) la préparation de la bulle ; le résultat n'est gardé que si la bulle est surveillée. */
function preparer(c: MatrixClient, roomId: string): Promise<Preparation> {
  const cle = clePreparation(c, roomId);
  const deja = enPreparation.get(cle);
  if (deja) return deja;
  const promesse = preparerUneFois(c, roomId)
    .then((p) => {
      if (enPreparation.get(cle) === promesse && surveillances.has(cle)) preparees.set(cle, p);
      return p;
    })
    .finally(() => {
      if (enPreparation.get(cle) === promesse) enPreparation.delete(cle);
    });
  enPreparation.set(cle, promesse);
  return promesse;
}

function oublierPreparation(cle: string): void {
  preparees.delete(cle);
  enPreparation.delete(cle);
  versions.set(cle, (versions.get(cle) ?? 0) + 1);
}

/*
 * Préchauffage du chiffrement : le premier message d'une bulle coûte cher (clés de l'autre, sessions Olm,
 * envoi de la clé du salon : plusieurs allers-retours). `prepareToEncrypt` fait ce travail à l'avance, en
 * arrière-plan. Jamais avant que les vérifications soient passées : bulle chiffrée, à 2, appareils de
 * l'autre connus (sinon la clé partirait vers un appareil que l'utilisateur n'a pas encore accepté).
 */

/** Dernier partage anticipé demandé, par client puis par bulle (limite : un toutes les 3 s). */
const dernierChauffage = new WeakMap<MatrixClient, Map<string, number>>();

/** Vrai (et note l'instant) si le dernier partage anticipé de cette bulle date de plus de 3 s. */
function chauffagePermis(c: MatrixClient, roomId: string, maintenant: number): boolean {
  const parBulle = dernierChauffage.get(c) ?? new Map<string, number>();
  const dernier = parBulle.get(roomId);
  if (dernier !== undefined && maintenant - dernier < PAUSE_CHAUFFAGE_MS) return false;
  if (parBulle.size >= BULLES_MAX_CHAUFFAGE) parBulle.clear();
  parBulle.set(roomId, maintenant);
  dernierChauffage.set(c, parBulle);
  return true;
}

/** Partage la clé du salon à l'avance si la préparation `p` est sûre et toujours vraie en mémoire. Jamais d'erreur. */
function chaufferSiSur(c: MatrixClient, roomId: string, p: Preparation): void {
  try {
    if (p.appareils !== 'connus') return;
    const salon = salonValide(c, roomId);
    const verdict = etatSainEnMemoire(salon, moi(c));
    if (verdict.statut !== 'saine' || verdict.autreId !== p.autreId) return;
    const crypto = c.getCrypto();
    if (!crypto || !chauffagePermis(c, roomId, Date.now())) return;
    crypto.prepareToEncrypt(salon);
  } catch {
    // Préchauffage facultatif : jamais d'erreur, jamais bloquant.
  }
}

/** Prépare la bulle (vérifications), puis préchauffe si tout est sûr. Ne rejette jamais, ne bloque pas. */
function preparerEtChauffer(c: MatrixClient, roomId: string): void {
  const cle = clePreparation(c, roomId);
  const version = versions.get(cle) ?? 0;
  void preparer(c, roomId)
    .then((p) => {
      // Un changement arrivé pendant l'attente rend ce résultat caduc : le suivant s'en occupera.
      if ((versions.get(cle) ?? 0) === version) chaufferSiSur(c, roomId, p);
    })
    .catch(() => undefined);
}

/**
 * Prépare le chiffrement d'une bulle pour que le prochain message parte en un seul aller-retour (clé du
 * salon partagée à l'avance). À appeler quand la bulle s'ouvre, devient ouverte, vient d'être acceptée ou
 * à la première frappe. Ne bloque jamais, ne rejette jamais ; ne fait rien si la bulle n'est pas sûre.
 */
export function prechaufferBulle(c: MatrixClient, roomId: string): void {
  try {
    if (!estIdSalon(roomId)) return;
    const connue = preparationConnue(c, roomId);
    if (connue) chaufferSiSur(c, roomId, connue);
    else preparerEtChauffer(c, roomId);
  } catch {
    // Préchauffage facultatif : jamais d'erreur, jamais bloquant.
  }
}

/**
 * Surveille la bulle ouverte à l'écran : prépare les vérifications tout de suite, puis les refait à
 * chaque changement d'état, de membres ou d'appareils. Rend la fonction qui arrête la surveillance.
 * Chaque préparation réussie préchauffe le chiffrement (voir plus haut).
 */
export function surveillerBulle(c: MatrixClient, roomId: string): () => void {
  if (!estIdSalon(roomId)) return () => undefined;
  const cle = clePreparation(c, roomId);
  surveillances.set(cle, (surveillances.get(cle) ?? 0) + 1);
  const rafraichir = (): void => {
    oublierPreparation(cle);
    preparerEtChauffer(c, roomId);
  };
  const surEtat = (ev: MatrixEvent): void => {
    if (ev.getRoomId() === roomId) rafraichir();
  };
  const surMembre = (_ev: MatrixEvent, etat: RoomState): void => {
    if (etat.roomId === roomId) rafraichir();
  };
  const surSalon = (salon: Room): void => {
    if (salon.roomId === roomId) rafraichir();
  };
  const surAppareils = (comptes: string[]): void => {
    const autreId = preparees.get(cle)?.autreId;
    if (autreId === undefined || (Array.isArray(comptes) && comptes.includes(autreId)))
      rafraichir();
  };
  c.on(RoomStateEvent.Events, surEtat);
  c.on(RoomStateEvent.Members, surMembre);
  c.on(RoomEvent.MyMembership, surSalon);
  c.on(CryptoEvent.DevicesUpdated, surAppareils);
  rafraichir();
  return () => {
    c.off(RoomStateEvent.Events, surEtat);
    c.off(RoomStateEvent.Members, surMembre);
    c.off(RoomEvent.MyMembership, surSalon);
    c.off(CryptoEvent.DevicesUpdated, surAppareils);
    const reste = (surveillances.get(cle) ?? 1) - 1;
    if (reste > 0) {
      surveillances.set(cle, reste);
      return;
    }
    surveillances.delete(cle);
    oublierPreparation(cle);
  };
}

/** L'utilisateur accepte les appareils actuels de l'autre (après une erreur « nouvel-appareil »). */
export async function accepterNouvelAppareil(c: MatrixClient, roomId: string): Promise<void> {
  const salon = salonValide(c, roomId);
  await chargerMembres(salon);
  const verdict = examinerBulle(salon, moi(c));
  if (verdict.statut !== 'saine') throw new Error('Bulle fermée ou invalide.');
  retenirAppareils(roomId, await appareilsDe(c, verdict.autreId));
  const cle = clePreparation(c, roomId);
  oublierPreparation(cle);
  if (surveillances.has(cle)) {
    preparees.set(cle, { autreId: verdict.autreId, appareils: 'connus' });
  }
}

/** Préparation gardée en mémoire (seulement si la bulle est surveillée), sinon undefined. */
function preparationConnue(c: MatrixClient, roomId: string): Preparation | undefined {
  const cle = clePreparation(c, roomId);
  return surveillances.has(cle) ? preparees.get(cle) : undefined;
}

/**
 * Toutes les vérifications maintenant. Si un changement (état, membres, appareils) arrive pendant
 * l'attente, le résultat est jeté et les vérifications sont refaites.
 */
async function preparationFraiche(c: MatrixClient, roomId: string): Promise<Preparation> {
  const cle = clePreparation(c, roomId);
  if (!surveillances.has(cle)) oublierPreparation(cle);
  for (let essai = 0; essai < ESSAIS_PREPARATION; essai += 1) {
    const version = versions.get(cle) ?? 0;
    const p = await preparer(c, roomId);
    if ((versions.get(cle) ?? 0) === version) return p;
    const connue = preparationConnue(c, roomId);
    if (connue) return connue;
  }
  throw new Error('Bulle en cours de vérification.');
}

/** Contrôle final, sans réseau, à partir de l'état en mémoire. */
function controleAvantEnvoi(c: MatrixClient, roomId: string, p: Preparation): void {
  const salon = salonValide(c, roomId);
  const verdict = etatSainEnMemoire(salon, moi(c));
  if (verdict.statut === 'suspecte') {
    oublierPreparation(clePreparation(c, roomId));
    void c.leave(roomId).catch(() => undefined);
    throw new Error('Bulle invalide : quittée.');
  }
  if (verdict.statut !== 'saine' || verdict.autreId !== p.autreId) throw new Error('Bulle fermée.');
  if (p.appareils === 'nouveau') throw new ErreurEnvoiBulle('nouvel-appareil');
}

async function envoyerVerifie(
  c: MatrixClient,
  roomId: string,
  envoi: () => Promise<{ event_id: string }>,
): Promise<string> {
  let reponse: { event_id: string };
  try {
    reponse = await envoi();
  } catch {
    // L'écho local reste dans le fil (statut « pas envoyé ») : l'écran propose de réessayer.
    throw new ErreurEnvoiBulle('pas-envoye');
  }
  marquerAffiche(c, roomId, reponse.event_id);
  return reponse.event_id;
}

/**
 * Envoie un message texte dans une bulle CHIFFRÉE et saine (refus sinon). Il s'effacera 1 min plus tard.
 * Le message apparaît tout de suite dans le fil (écho local du SDK, statut « envoi… »).
 * Rejette avec ErreurEnvoiBulle('nouvel-appareil') si l'autre a un appareil inconnu : rien n'est envoyé.
 * Rejette avec ErreurEnvoiBulle('pas-envoye') si le serveur ne l'a pas reçu (réessayable).
 */
export async function envoyerMessage(
  c: MatrixClient,
  roomId: string,
  texte: string,
): Promise<string> {
  const corps = typeof texte === 'string' ? texte.trim() : '';
  if (corps === '' || corps.length > LONGUEUR_MAX_MESSAGE) throw new Error('Message invalide.');
  salonValide(c, roomId);
  // Bulle surveillée et déjà vérifiée : aucun aller-retour avant sendMessage.
  const preparation = preparationConnue(c, roomId) ?? (await preparationFraiche(c, roomId));
  controleAvantEnvoi(c, roomId, preparation);
  return envoyerVerifie(c, roomId, () =>
    c.sendMessage(roomId, { msgtype: MsgType.Text, body: corps }),
  );
}

/**
 * Envoie une PHOTO dans une bulle chiffrée et saine. La photo est d'abord réduite et réencodée en JPEG
 * (cela retire le GPS et le modèle du téléphone), puis chiffrée sur CE téléphone : le serveur ne reçoit qu'un
 * paquet d'octets illisibles, sans type d'image ni nom de fichier. La clé voyage dans l'événement chiffré, et
 * disparaît quand il s'efface (1 min, ou robot). Mêmes refus que pour un message texte.
 */
export async function envoyerPhoto(c: MatrixClient, roomId: string, image: Blob): Promise<string> {
  if (!(image instanceof Blob)) throw new Error('Photo invalide.');
  salonValide(c, roomId);
  // Verrou avant même de préparer/envoyer : bulle fermée ou appareil inconnu => rien ne part.
  const preparation = preparationConnue(c, roomId) ?? (await preparationFraiche(c, roomId));
  controleAvantEnvoi(c, roomId, preparation);

  const jpeg = await preparerPhoto(image as File);
  let largeur = 0;
  let hauteur = 0;
  try {
    const bitmap = await createImageBitmap(jpeg);
    largeur = bitmap.width;
    hauteur = bitmap.height;
    bitmap.close();
  } catch {
    // Dimensions facultatives : l'affichage s'adapte sans elles.
  }
  const { chiffre, file } = await chiffrerImage(jpeg);
  const paquet = new Blob([chiffre as BlobPart], { type: 'application/octet-stream' });
  const { content_uri } = await c.uploadContent(paquet, {
    type: 'application/octet-stream',
    includeFilename: false,
  });

  // Dernier contrôle, au plus près de l'envoi (le téléversement a pu prendre du temps).
  const fraiche = preparationConnue(c, roomId) ?? preparation;
  controleAvantEnvoi(c, roomId, fraiche);
  const contenu = {
    msgtype: MsgType.Image,
    body: 'Photo',
    info: {
      mimetype: 'image/jpeg',
      size: chiffre.length,
      ...(largeur && hauteur ? { w: largeur, h: hauteur } : {}),
    },
    file: { ...file, url: content_uri },
  };
  return envoyerVerifie(c, roomId, () => c.sendMessage(roomId, contenu as never));
}

/**
 * Télécharge les octets chiffrés d'une photo reçue et les déchiffre. Rend un Blob affichable, ou null si le
 * téléchargement, l'empreinte ou le déchiffrement échoue (jamais d'exception). Le serveur n'a vu que le paquet chiffré.
 */
export async function chargerPhoto(c: MatrixClient, file: FichierChiffre): Promise<Blob | null> {
  if (!estFichierChiffre(file)) return null;
  const url = c.mxcUrlToHttp(file.url, undefined, undefined, undefined, false, true, true);
  if (!url) return null;
  const jeton = c.getAccessToken();
  try {
    const reponse = await fetch(url, {
      headers: jeton ? { Authorization: `Bearer ${jeton}` } : {},
    });
    if (!reponse.ok) return null;
    // Plafond de taille : un correspondant malveillant pourrait pointer vers un paquet énorme. Une vraie
    // photo réduite pèse moins d'1 Mo ; on refuse au-delà, d'abord par l'en-tête, puis sur les octets reçus.
    const annonce = Number(reponse.headers.get('content-length'));
    if (Number.isFinite(annonce) && annonce > TAILLE_PAQUET_MAX) return null;
    const octets = new Uint8Array(await reponse.arrayBuffer());
    if (octets.length > TAILLE_PAQUET_MAX) return null;
    return await dechiffrerImage(file, octets);
  } catch {
    return null;
  }
}

/** Mon message resté « pas envoyé » dans cette bulle (écho local), ou null. */
function monMessageNonEnvoye(c: MatrixClient, salon: Room, eventId: string): MatrixEvent | null {
  const ev = salon
    .getLiveTimeline()
    .getEvents()
    .find((e) => e.getId() === eventId);
  if (!ev || ev.status !== EventStatus.NOT_SENT || ev.getSender() !== c.getUserId()) return null;
  return ev.getType() === 'm.room.message' && ev.getRoomId() === salon.roomId ? ev : null;
}

/** « Toucher pour réessayer » : renvoie mon message non envoyé, avec les mêmes contrôles qu'un envoi. */
export async function reessayerMessage(
  c: MatrixClient,
  roomId: string,
  eventId: string,
): Promise<string> {
  const salon = salonValide(c, roomId);
  const ev = typeof eventId === 'string' ? monMessageNonEnvoye(c, salon, eventId) : null;
  if (!ev) throw new Error('Message introuvable.');
  // Bulle surveillée et déjà vérifiée : aucun aller-retour avant sendMessage.
  const preparation = preparationConnue(c, roomId) ?? (await preparationFraiche(c, roomId));
  controleAvantEnvoi(c, roomId, preparation);
  return envoyerVerifie(c, roomId, () => c.resendEvent(ev, salon));
}

/** « En train d'écrire… » (m.typing standard). */
export async function signalerEcriture(
  c: MatrixClient,
  roomId: string,
  oui: boolean,
): Promise<void> {
  const salon = salonValide(c, roomId);
  if (salon.getMyMembership() !== KnownMembership.Join) return;
  await c.sendTyping(roomId, oui === true, DUREE_ECRITURE_MS);
}

/** Silence Radio : efface tous les messages que je peux effacer, puis quitte la bulle. */
export async function silenceRadio(c: MatrixClient, roomId: string): Promise<void> {
  salonValide(c, roomId);
  await effacerTout(c, roomId);
  await c.leave(roomId);
}
