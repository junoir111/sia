// F9 / F11 — Bulle : lecture sûre de l'état io.sia.bulle et état affiché dans la liste des bulles
// (7-contrats-mise-en-relation.md). Sans écran, sans réseau.

import { TEXTE_DEMANDE_MAX, texteFacultatifSur } from './demande';
import { estIdEvenement } from './offres';
import { LIMITES, estObjet, texteSur } from './profil';

export type ParticipantBulle = { pseudo: string; zone: string };
export type EtatBulle = {
  demande: { annonce: string; service: string; zone: string; budget: number; texte: string };
  participants: Record<string, ParticipantBulle>;
};

const PARTICIPANTS_MAX = 2;
const ID_UTILISATEUR_MAX = 255;
const FORME_ID_UTILISATEUR = /^@[^:\s]+:\S+$/;

function demandeSure(v: unknown): EtatBulle['demande'] | null {
  if (!estObjet(v) || !estIdEvenement(v.annonce)) return null;
  const service = texteSur(v.service, LIMITES.service);
  const zone = texteSur(v.zone, LIMITES.zone);
  const texte = texteFacultatifSur(v.texte, TEXTE_DEMANDE_MAX);
  const budget = v.budget;
  if (service === null || zone === null || texte === null) return null;
  if (
    typeof budget !== 'number' ||
    !Number.isInteger(budget) ||
    budget < 1 ||
    budget > LIMITES.prixMax
  )
    return null;
  return { annonce: v.annonce, service, zone, budget, texte };
}

function participantSur(userId: string, v: unknown): [string, ParticipantBulle] | null {
  if (userId.length > ID_UTILISATEUR_MAX || !FORME_ID_UTILISATEUR.test(userId) || !estObjet(v))
    return null;
  const pseudo = texteSur(v.pseudo, LIMITES.pseudo);
  const zone = texteSur(v.zone, LIMITES.zone);
  return pseudo === null || zone === null ? null : [userId, { pseudo, zone }];
}

export function nettoyerEtatBulle(inconnu: unknown): EtatBulle | null {
  if (!estObjet(inconnu) || !estObjet(inconnu.participants)) return null;
  const demande = demandeSure(inconnu.demande);
  const brut = Object.entries(inconnu.participants);
  if (demande === null || brut.length === 0 || brut.length > PARTICIPANTS_MAX) return null;
  const surs = brut.map(([id, p]) => participantSur(id, p));
  if (surs.some((p) => p === null)) return null;
  // Object.fromEntries crée de vraies propriétés : pas de piège « __proto__ ».
  const participants = Object.fromEntries(
    surs.filter((p): p is [string, ParticipantBulle] => p !== null),
  );
  return { demande, participants };
}

export type EtatAffiche = 'invitation-recue' | 'en-attente' | 'ouverte' | 'fermee';

// Appartenances Matrix : 'invite' | 'join' | 'leave' | 'ban' | 'knock' ; undefined = inconnue.
export function etatAffiche(e: {
  monAppartenance: string | undefined;
  autreAppartenance: string | undefined;
  autreEcrit: boolean;
}): { etat: EtatAffiche; texte: string } {
  const jeSuisDedans = e.monAppartenance === 'join' || e.monAppartenance === 'invite';
  const autreParti = e.autreAppartenance === 'leave' || e.autreAppartenance === 'ban';
  if (!jeSuisDedans || autreParti) return { etat: 'fermee', texte: 'La bulle est fermée.' };
  if (e.monAppartenance === 'invite')
    return { etat: 'invitation-recue', texte: 'Dit oui. Tu veux discuter ?' };
  if (e.autreAppartenance !== 'join') return { etat: 'en-attente', texte: 'En attente' };
  return { etat: 'ouverte', texte: e.autreEcrit ? 'En train d’écrire…' : '' };
}

/**
 * Ce que dit une invitation reçue, après « X (quartier) » : « dit oui » (offre à ma demande), « vous demande »
 * (un client me demande directement) ou « vous écrit » (un prestataire m'écrit).
 */
export function verbeInvitation(b: {
  invitationDirecte?: boolean;
  invitationEcrit?: boolean;
}): 'dit oui' | 'vous demande' | 'vous écrit' {
  if (b.invitationEcrit) return 'vous écrit';
  return b.invitationDirecte ? 'vous demande' : 'dit oui';
}
