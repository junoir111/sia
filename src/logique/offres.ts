// F9 — Offres : raison d'invitation « <pseudo> (<zone>) dit oui [ref:<eventId>] » et offres sœurs
// (7-contrats-mise-en-relation.md). Sans écran, sans réseau.

import { LIMITES, contientCaracterePiege } from './profil';

const ID_EVENEMENT_MAX = 255; // taille maximale d'un identifiant Matrix
// Un identifiant d'événement Matrix commence par « $ » ; pas d'espace ni de crochet.
const FORME_ID_EVENEMENT = /^\$[^\s[\]]+$/;
// Texte visible : « <pseudo> (<zone>) dit oui ».
export const TEXTE_RAISON_MAX = LIMITES.pseudo + LIMITES.zone + ' () dit oui'.length;
const REF_FINALE = /\s*\[ref:([^\s[\]]+)\]$/;

export function estIdEvenement(v: unknown): v is string {
  return typeof v === 'string' && v.length <= ID_EVENEMENT_MAX && FORME_ID_EVENEMENT.test(v);
}

export function avecRef(texte: string, ref: string): string {
  if (!estIdEvenement(ref)) throw new Error('Référence de demande invalide.');
  return `${texte} [ref:${ref}]`;
}

export function lireRaison(raison: unknown): { texte: string; ref?: string } {
  if (typeof raison !== 'string' || contientCaracterePiege(raison)) return { texte: '' };
  const trouve = REF_FINALE.exec(raison);
  const ref = trouve?.[1];
  if (trouve && estIdEvenement(ref)) {
    return { texte: raison.slice(0, trouve.index).trim().slice(0, TEXTE_RAISON_MAX), ref };
  }
  return { texte: raison.trim().slice(0, TEXTE_RAISON_MAX) };
}

export type InvitationRecue = { roomId: string; raison: unknown };

// Les autres offres pour la même demande que la bulle choisie (à refuser).
export function offresSoeurs(invitations: readonly InvitationRecue[], roomId: string): string[] {
  const choisie = invitations.find((i) => i.roomId === roomId);
  const ref = choisie ? lireRaison(choisie.raison).ref : undefined;
  if (ref === undefined) return [];
  return invitations
    .filter((i) => i.roomId !== roomId && lireRaison(i.raison).ref === ref)
    .map((i) => i.roomId);
}
