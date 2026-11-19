import { LIMITES, estObjet, texteSur } from './profil';

/*
 * « Mes clients » : la liste que le prestataire garde de ses clients (enregistrés depuis une bulle), pour pouvoir
 * leur écrire plus tard. Gardée sur son compte (donnée privée `io.sia.clients`), jamais sur le téléphone.
 * Le compte `userId` sert à écrire au client : il n'est JAMAIS affiché (seulement le pseudo et le quartier).
 */

export type ContactClient = { userId: string; pseudo: string; zone: string };

/** Ce qui est écrit sur le compte. */
export type ClientsEnregistres = { version: 1; clients: ContactClient[] };

/** Garde-fou : la liste est gardée sur le compte, elle ne grossit pas sans fin. */
export const NB_CLIENTS_MAX = 200;

const ID_MAX = 255;
const FORME_ID_UTILISATEUR = /^@[^:\s]+:\S+$/;

function estIdUtilisateur(v: unknown): v is string {
  return typeof v === 'string' && v.length <= ID_MAX && FORME_ID_UTILISATEUR.test(v);
}

/** Un client bien formé (compte, pseudo, quartier), sans rien d'autre ; sinon null. */
function contactSur(v: unknown): ContactClient | null {
  if (!estObjet(v) || !estIdUtilisateur(v.userId)) return null;
  const pseudo = texteSur(v.pseudo, LIMITES.pseudo);
  const zone = texteSur(v.zone, LIMITES.zone);
  return pseudo === null || zone === null ? null : { userId: v.userId, pseudo, zone };
}

/**
 * Lit la liste gardée sur le compte. Une entrée mal formée est ignorée (jamais de refus en bloc) ; un compte déjà
 * vu aussi (le premier est gardé) ; au-delà de NB_CLIENTS_MAX, le reste est ignoré.
 */
export function nettoyerClients(brut: unknown): ContactClient[] {
  if (!estObjet(brut) || !Array.isArray(brut.clients)) return [];
  const vus = new Set<string>();
  const liste: ContactClient[] = [];
  for (const entree of brut.clients as unknown[]) {
    if (liste.length >= NB_CLIENTS_MAX) break;
    const contact = contactSur(entree);
    if (contact === null || vus.has(contact.userId)) continue;
    vus.add(contact.userId);
    liste.push(contact);
  }
  return liste;
}

/** La liste avec ce client en plus (à la fin). Déjà là : mis à jour sur place. Invalide ou liste pleine : null. */
export function ajouterClient(
  liste: readonly ContactClient[],
  contact: ContactClient,
): ContactClient[] | null {
  const propre = contactSur(contact);
  if (propre === null) return null;
  const place = liste.findIndex((c) => c.userId === propre.userId);
  if (place >= 0) return liste.map((c, i) => (i === place ? propre : c));
  return liste.length >= NB_CLIENTS_MAX ? null : [...liste, propre];
}

export function retirerClient(liste: readonly ContactClient[], userId: string): ContactClient[] {
  return liste.filter((c) => c.userId !== userId);
}

/** Pour l'affichage : par pseudo, sans tenir compte des majuscules ni des accents. */
export function trierClients(liste: readonly ContactClient[]): ContactClient[] {
  return [...liste].sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
}

export function contenuClients(liste: readonly ContactClient[]): ClientsEnregistres {
  return { version: 1, clients: liste.map((c) => ({ ...c })) };
}
