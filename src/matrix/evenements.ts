/*
 * Types d'événements propres à SIA (projet/7-contrats-mise-en-relation.md, « Le réseau »).
 * Les contenus déclarés ici sont ce que SIA ÉCRIT. Ce qui est LU reste `unknown` et passe par les
 * fonctions de nettoyage de src/logique/ : rien de ce qui vient du réseau n'est cru sur parole.
 */

export const TYPE_ANNONCE = 'io.sia.annonce';
export const TYPE_STATUT = 'io.sia.statut';
export const TYPE_BULLE = 'io.sia.bulle';
export const TYPE_FICHE = 'io.sia.fiche';
export const NOM_BULLE = 'SIA · Bulle';
export const ALGORITHME_BULLE = 'm.megolm.v1.aes-sha2';

export type ContenuAnnonce = {
  role: 'client';
  pseudo: string;
  service: string;
  zone: string;
  texte: string;
  budget: number;
  fin: number;
};

export type ContenuStatut = { pseudo: string; metier: string; zone: string; fin: number };

export type ContenuEtatBulle = {
  demande: { annonce: string; service: string; zone: string; budget: number; texte: string };
  participants: Record<string, { pseudo: string; zone: string }>;
};

declare module 'matrix-js-sdk/lib/@types/event' {
  interface TimelineEvents {
    'io.sia.annonce': ContenuAnnonce;
    'io.sia.statut': ContenuStatut;
  }
  interface StateEvents {
    'io.sia.bulle': ContenuEtatBulle;
  }
}

/** Identifiant de salon Matrix : « ! » puis signes visibles, 255 au plus. */
const FORME_ID_SALON = /^![^\s]+$/;
const ID_MAX = 255;

export function estIdSalon(v: unknown): v is string {
  return typeof v === 'string' && v.length <= ID_MAX && FORME_ID_SALON.test(v);
}
