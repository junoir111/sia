import {
  ClientEvent,
  KnownMembership,
  MsgType,
  Preset,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  Visibility,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import type { DemandeClient } from '../logique/demande';
import {
  etatAffiche,
  nettoyerEtatBulle,
  type EtatAffiche,
  type EtatBulle,
  type ParticipantBulle,
} from '../logique/etat-bulle';
import { avecRef, lireRaison, offresSoeurs, type InvitationRecue } from '../logique/offres';
import { LIMITES, texteSur } from '../logique/profil';
import { noterPseudo, pseudoDe } from './annuaire';
import { dejaAffiche, effacerTout, marquerAffiche } from './ephemere';
import {
  ALGORITHME_BULLE,
  estIdSalon,
  NOM_BULLE,
  TYPE_BULLE,
  type ContenuEtatBulle,
} from './evenements';
import { maDemandeValable, oublierDemandeLocale, retirerDemande, trouverDemande } from './mur';

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
};

/** Longueur maximale d'un message (pas fixée par le document 5 : garde-fou contre les envois énormes). */
export const LONGUEUR_MAX_MESSAGE = 1000;
const DUREE_ECRITURE_MS = 5000;
const ATTENTE_CHIFFREMENT_MS = 10_000;
const PAS_ATTENTE_MS = 250;
const DELAI_REGROUPEMENT_MS = 50;
const FORME_RAISON = /^(.+) \(([^()]+)\) dit oui$/;
const TYPES_MESSAGE = new Set(['m.room.message', 'm.room.encrypted']);
const DEDANS = new Set<string>([KnownMembership.Join, KnownMembership.Invite]);
/** Bulles déjà en train d'être quittées sans bruit (évite de relancer leave à chaque rafraîchissement). */
const enDepart = new Set<string>();
/** Appareils connus de l'autre, par bulle (identifiants seulement). */
const CLE_APPAREILS = 'sia.appareils';
const BULLES_MAX_APPAREILS = 200;
const APPAREILS_MAX = 100;

/** Erreur d'envoi que l'écran doit traiter à part. */
export type ErreurEnvoi = 'nouvel-appareil';
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

/**
 * Prestataire : « Je dis oui » à une demande. Crée la bulle chiffrée et invite le client.
 * La demande est relue sur le Mur (source sûre de l'expéditeur) et doit être identique à celle affichée.
 */
export async function direOui(
  c: MatrixClient,
  demande: DemandeClient,
  eventId: string,
  moiPublic: ParticipantBulle,
): Promise<string> {
  const presta = participantSur(moiPublic);
  const annonce = await trouverDemande(c, eventId);
  if (!annonce || !memeDemande(annonce.demande, demande)) throw new Error('Demande introuvable.');
  if (annonce.demande.fin <= Date.now()) throw new Error('Demande expirée.');
  const client = annonce.expediteur;
  const moiId = moi(c);
  if (client === moiId) throw new Error('Impossible de répondre à sa propre demande.');

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
    await c.leave(room_id).catch(() => undefined);
    throw erreur;
  }
  return room_id;
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
  if (!demande || !noterPseudo(autreId, pseudo)) return null;
  return { autreId, ref: raison.ref, autre: { pseudo, zone }, demande };
}

/**
 * Client : accepte une offre. Rejoint la bulle, vérifie qu'elle est chiffrée et bien à 2 (moi et le
 * prestataire qui m'a invité) — sinon la quitte —, refuse les autres offres pour la même demande,
 * puis retire la demande du Mur et l'oublie sur ce téléphone.
 */
export async function accepterOffre(c: MatrixClient, roomId: string): Promise<void> {
  const salon = salonValide(c, roomId);
  const moiId = moi(c);
  if (salon.getMyMembership() !== KnownMembership.Invite) throw new Error('Offre introuvable.');
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
  for (const soeur of soeurs) await c.leave(soeur).catch(() => undefined);
  await retirerDemande(c, offre.ref).catch(() => undefined);
  oublierDemandeLocale();
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

function lireEtat(salon: Room): EtatBulle | null {
  return nettoyerEtatBulle(salon.currentState.getStateEvents(TYPE_BULLE, '')?.getContent());
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

function resumeInvitation(c: MatrixClient, salon: Room, moiId: string): ResumeBulle | null {
  const offre = lireOffre(c, salon, moiId);
  if (!offre) {
    // Offre qui ne répond pas à MA demande encore valable : refusée sans bruit.
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

/** Pseudo de l'autre : celui de l'annuaire pour son vrai compte ; null si son pseudo est usurpé. */
function autreAffiche(autreId: string, declare: ParticipantBulle): ParticipantBulle | null {
  const connu = pseudoDe(autreId);
  if (connu !== null) return { pseudo: connu, zone: declare.zone };
  return noterPseudo(autreId, declare.pseudo) ? declare : null;
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

/** Bulles et offres reçues, la plus récente d'abord. */
export function listerBulles(c: MatrixClient): ResumeBulle[] {
  const moiId = c.getUserId();
  if (!moiId) return [];
  return c
    .getRooms()
    .map((salon) => {
      const appartenance = salon.getMyMembership();
      if (appartenance === KnownMembership.Invite)
        return { salon, r: resumeInvitation(c, salon, moiId) };
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

/** Appelle `rappel` avec la liste à jour à chaque changement. Rend une fonction qui arrête l'écoute. */
export function ecouterBulles(c: MatrixClient, rappel: (b: ResumeBulle[]) => void): () => void {
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  let arrete = false;
  const prevenir = (): void => {
    if (minuterie !== null || arrete) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      if (arrete) return;
      void fermerBullesRefusees(c);
      rappel(listerBulles(c));
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
 * Anti homme du milieu : au premier échange, retient les appareils de l'autre ; ensuite, refuse
 * d'envoyer si l'autre a un appareil inconnu.
 */
async function verifierAppareils(c: MatrixClient, roomId: string, autreId: string): Promise<void> {
  const actuels = await appareilsDe(c, autreId);
  const connus = lireAppareils()[roomId];
  if (connus === undefined) {
    if (actuels.length > 0) retenirAppareils(roomId, actuels);
    return;
  }
  if (actuels.some((id) => !connus.includes(id))) throw new ErreurEnvoiBulle('nouvel-appareil');
}

/** L'utilisateur accepte les appareils actuels de l'autre (après une erreur « nouvel-appareil »). */
export async function accepterNouvelAppareil(c: MatrixClient, roomId: string): Promise<void> {
  const salon = salonValide(c, roomId);
  await chargerMembres(salon);
  const verdict = examinerBulle(salon, moi(c));
  if (verdict.statut !== 'saine') throw new Error('Bulle fermée ou invalide.');
  retenirAppareils(roomId, await appareilsDe(c, verdict.autreId));
}

/**
 * Envoie un message texte dans une bulle CHIFFRÉE et saine (refus sinon). Il s'effacera 1 min plus tard.
 * Rejette avec ErreurEnvoiBulle('nouvel-appareil') si l'autre a un appareil inconnu : rien n'est envoyé.
 */
export async function envoyerMessage(
  c: MatrixClient,
  roomId: string,
  texte: string,
): Promise<string> {
  const corps = typeof texte === 'string' ? texte.trim() : '';
  if (corps === '' || corps.length > LONGUEUR_MAX_MESSAGE) throw new Error('Message invalide.');
  const salon = salonValide(c, roomId);
  const moiId = moi(c);
  if (salon.getMyMembership() !== KnownMembership.Join || !lireEtat(salon)) {
    throw new Error('Bulle fermée.');
  }
  if (!(await estChiffree(c, roomId))) throw new Error('Bulle non chiffrée : envoi refusé.');
  await chargerMembres(salon);
  const verdict = examinerBulle(salon, moiId);
  if (verdict.statut === 'suspecte') {
    await c.leave(roomId).catch(() => undefined);
    throw new Error('Bulle invalide : quittée.');
  }
  if (verdict.statut !== 'saine') throw new Error('Bulle fermée.');
  await verifierAppareils(c, roomId, verdict.autreId);
  const { event_id } = await c.sendMessage(roomId, { msgtype: MsgType.Text, body: corps });
  marquerAffiche(c, roomId, event_id);
  return event_id;
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
