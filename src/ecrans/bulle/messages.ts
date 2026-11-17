import { useEffect, useState } from 'react';
import { MatrixEventEvent, RoomEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { DUREE_MESSAGE_MS } from '../../config';
import { nettoyerEtatBulle } from '../../logique/etat-bulle';
import { LONGUEUR_MAX_MESSAGE } from '../../matrix/bulles';
import { echeanceEffacement } from '../../matrix/ephemere';
import { TYPE_BULLE } from '../../matrix/evenements';

/*
 * Messages texte d'une bulle, lus dans le fil Matrix déjà déchiffré.
 * Seul le texte (body) est gardé, coupé à la longueur maximale ; un message effacé disparaît.
 * Sécurité : seuls les messages CHIFFRÉS, bien déchiffrés, et envoyés par l'un des 2 participants
 * inscrits dans l'état io.sia.bulle sont montrés. Tout le reste est ignoré.
 */

export type Message = { id: string; texte: string; moi: boolean };

/** Premier affichage connu sur cet appareil (si la file d'effacement est illisible). */
const premierAffichage = new Map<string, number>();

function lireMessage(
  ev: MatrixEvent,
  moi: string | null,
  participants: ReadonlySet<string>,
): Message | null {
  const id = ev.getId();
  if (!id || ev.isRedacted() || ev.isState() || ev.getType() !== 'm.room.message') return null;
  if (!ev.isEncrypted() || ev.isDecryptionFailure()) return null;
  const expediteur = ev.getSender();
  if (!expediteur || !participants.has(expediteur)) return null;
  const corps: unknown = ev.getContent().body;
  if (typeof corps !== 'string' || corps.trim() === '') return null;
  return { id, texte: corps.slice(0, LONGUEUR_MAX_MESSAGE), moi: ev.getSender() === moi };
}

/** Les 2 comptes inscrits dans l'état io.sia.bulle, ou null si l'état est absent ou invalide. */
function participantsDe(c: MatrixClient, roomId: string): Set<string> | null {
  const salon = c.getRoom(roomId);
  const etat = nettoyerEtatBulle(salon?.currentState.getStateEvents(TYPE_BULLE, '')?.getContent());
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
    .map((ev) => lireMessage(ev, moi, participants))
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
    c.on(RoomEvent.Timeline, relire);
    c.on(RoomEvent.Redaction, relire);
    c.on(MatrixEventEvent.Decrypted, surDechiffre);
    relire();
    return () => {
      c.off(RoomEvent.Timeline, relire);
      c.off(RoomEvent.Redaction, relire);
      c.off(MatrixEventEvent.Decrypted, surDechiffre);
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
