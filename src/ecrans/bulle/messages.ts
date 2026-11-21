import { useEffect, useState } from 'react';
import { EventStatus, MatrixEventEvent, MsgType, RoomEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { DUREE_MESSAGE_MS } from '../../config';
import { LONGUEUR_MAX_MESSAGE, lireEtat } from '../../matrix/bulles';
import { echeanceEffacement } from '../../matrix/ephemere';
import { estFichierChiffre, type FichierChiffre } from '../../matrix/piece-jointe';

/*
 * Messages texte d'une bulle, lus dans le fil Matrix déjà déchiffré.
 * Seul le texte (body) est gardé, coupé à la longueur maximale ; un message effacé disparaît.
 * Sécurité : seuls les messages CHIFFRÉS, bien déchiffrés, et envoyés par l'un des 2 participants
 * inscrits dans l'état io.sia.bulle sont montrés. Seule exception : MON message de CETTE bulle encore
 * en cours d'envoi (écho local du SDK, jamais venu du réseau), affiché tout de suite. Tout le reste est ignoré.
 */

/** État d'envoi de mon message : confirmé par le serveur, en cours, ou pas envoyé (réessayable). */
export type EtatEnvoi = 'confirme' | 'en-cours' | 'echec';

/**
 * `cle` reste la même quand l'écho local devient le message confirmé (son `id` change).
 * `photo` est présent pour un message image (alors `texte` est vide) : la référence du fichier chiffré,
 * à télécharger et déchiffrer au moment de l'afficher.
 */
export type Message = {
  id: string;
  cle: string;
  texte: string;
  moi: boolean;
  envoi: EtatEnvoi;
  photo?: FichierChiffre;
};

/** Statuts d'un écho local (les autres, dont « annulé », ne sont pas montrés). */
const ETATS_ECHO = new Map<EventStatus, EtatEnvoi>([
  [EventStatus.ENCRYPTING, 'en-cours'],
  [EventStatus.QUEUED, 'en-cours'],
  [EventStatus.SENDING, 'en-cours'],
  [EventStatus.SENT, 'confirme'],
  [EventStatus.NOT_SENT, 'echec'],
]);

/** Premier affichage connu sur cet appareil (si la file d'effacement est illisible). */
const premierAffichage = new Map<string, number>();

/** Mon écho local (status non nul : créé sur cet appareil par sendMessage), de cette bulle. */
function etatEcho(ev: MatrixEvent, moi: string | null, roomId: string): EtatEnvoi | null {
  const etat = ev.status === null ? undefined : ETATS_ECHO.get(ev.status);
  if (etat === undefined || moi === null) return null;
  return ev.getSender() === moi && ev.getRoomId() === roomId ? etat : null;
}

function lireMessage(
  ev: MatrixEvent,
  moi: string | null,
  roomId: string,
  participants: ReadonlySet<string>,
): Message | null {
  const id = ev.getId();
  if (!id || ev.isRedacted() || ev.isState() || ev.getType() !== 'm.room.message') return null;
  const echo = etatEcho(ev, moi, roomId);
  if (echo === null && (!ev.isEncrypted() || ev.isDecryptionFailure())) return null;
  const expediteur = ev.getSender();
  if (!expediteur || !participants.has(expediteur)) return null;
  const contenu = ev.getContent();
  const txn = ev.getTxnId();
  const cle = typeof txn === 'string' && txn !== '' ? `txn:${txn}` : id;
  const commun = { id, cle, moi: expediteur === moi, envoi: echo ?? 'confirme' } as const;
  // Message PHOTO : le fichier chiffré est vérifié ici ; les octets sont téléchargés et déchiffrés à l'affichage.
  if (contenu.msgtype === MsgType.Image && estFichierChiffre(contenu.file)) {
    return { ...commun, texte: '', photo: contenu.file };
  }
  const corps: unknown = contenu.body;
  if (typeof corps !== 'string' || corps.trim() === '') return null;
  return { ...commun, texte: corps.slice(0, LONGUEUR_MAX_MESSAGE) };
}

/** Les 2 comptes inscrits dans l'état io.sia.bulle, ou null si l'état est absent ou invalide. */
function participantsDe(c: MatrixClient, roomId: string): Set<string> | null {
  const salon = c.getRoom(roomId);
  const etat = salon ? lireEtat(salon) : null;
  if (!etat) return null;
  const participants = new Set(Object.keys(etat.participants));
  return participants.size === 2 ? participants : null;
}

/** Compte Matrix de l'autre participant (jamais affiché : sert à retrouver son pseudo). */
export function autreDeLaBulle(c: MatrixClient, roomId: string): string | null {
  const moi = c.getUserId();
  const participants = participantsDe(c, roomId);
  if (!moi || !participants?.has(moi)) return null;
  return [...participants].find((id) => id !== moi) ?? null;
}

function lire(c: MatrixClient, roomId: string): Message[] {
  const moi = c.getUserId();
  const salon = c.getRoom(roomId);
  const participants = participantsDe(c, roomId);
  if (!salon || !participants) return [];
  return salon
    .getLiveTimeline()
    .getEvents()
    .map((ev) => lireMessage(ev, moi, roomId, participants))
    .filter((m): m is Message => m !== null);
}

/** Messages de la bulle, tenus à jour (nouveaux, déchiffrés, effacés). */
export function useMessages(c: MatrixClient | null, roomId: string): Message[] {
  const [etat, setEtat] = useState<{ cle: string; messages: Message[] } | null>(null);
  const cle = c ? `${c.getUserId()}|${roomId}` : '';

  useEffect(() => {
    if (!c) return;
    const relire = (): void => setEtat({ cle, messages: lire(c, roomId) });
    const surDechiffre = (ev: MatrixEvent): void => {
      if (ev.getRoomId() === roomId) relire();
    };
    const surEcho = (_ev: MatrixEvent, salon: Room): void => {
      if (salon.roomId === roomId) relire();
    };
    c.on(RoomEvent.Timeline, relire);
    c.on(RoomEvent.Redaction, relire);
    c.on(MatrixEventEvent.Decrypted, surDechiffre);
    c.on(RoomEvent.LocalEchoUpdated, surEcho);
    relire();
    return () => {
      c.off(RoomEvent.Timeline, relire);
      c.off(RoomEvent.Redaction, relire);
      c.off(MatrixEventEvent.Decrypted, surDechiffre);
      c.off(RoomEvent.LocalEchoUpdated, surEcho);
    };
  }, [c, roomId, cle]);

  if (!c) return [];
  return etat?.cle === cle ? etat.messages : lire(c, roomId);
}

/** Temps restant avant l'effacement d'un message affiché (ms, entre 0 et 1 minute). */
export function tempsRestant(eventId: string, maintenant: number): number {
  let echeance = echeanceEffacement(eventId);
  if (echeance === null) {
    const vu = premierAffichage.get(eventId) ?? maintenant;
    premierAffichage.set(eventId, vu);
    echeance = vu + DUREE_MESSAGE_MS;
  }
  return Math.min(DUREE_MESSAGE_MS, Math.max(0, echeance - maintenant));
}
