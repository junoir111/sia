import { useSyncExternalStore } from 'react';

/*
 * Réponses « Oui » / « Non » en route vers le serveur, pour toute l'appli (bandeau ET liste des bulles).
 * Une carte dont la réponse part montre tout de suite « Réponse envoyée… » sans attendre le serveur ;
 * si le serveur refuse, elle revient avec un message. Gardé en mémoire seulement (rien sur le téléphone).
 * Une même carte ne peut jamais recevoir deux réponses, même si elle est montrée à deux endroits.
 */

/**
 * - `repos` : rien en route (la carte pose sa question).
 * - `envoi` : la réponse part, le serveur n'a pas encore confirmé.
 * - `fait` : le serveur a confirmé (la carte s'en va ; elle reste en « envoyée » jusque-là).
 * - `reseau` / `probleme` : le serveur a refusé, la carte revient avec un message.
 */
export type EtatReponse = 'repos' | 'envoi' | 'fait' | 'reseau' | 'probleme';

/** Au-delà, les réponses les plus anciennes sont oubliées (une demande vit 2 h : largement assez). */
const NOMBRE_MAX = 50;

const MESSAGES_ECHEC = {
  reseau: 'Pas de connexion. Réessaie.',
  probleme: 'Un problème est survenu. Réessaie.',
} as const;

const etats = new Map<string, EtatReponse>();
const ecouteurs = new Set<() => void>();

function changer(cle: string, etat: EtatReponse): void {
  etats.delete(cle); // la plus récente passe en fin de liste
  etats.set(cle, etat);
  for (const ancienne of [...etats.keys()].slice(0, Math.max(0, etats.size - NOMBRE_MAX))) {
    etats.delete(ancienne);
  }
  for (const rappel of [...ecouteurs]) rappel();
}

export function etatReponse(cle: string): EtatReponse {
  return etats.get(cle) ?? 'repos';
}

/** Vrai tant que la carte montre « Réponse envoyée… » (en route, ou déjà confirmée). */
export function reponseParties(etat: EtatReponse): boolean {
  return etat === 'envoi' || etat === 'fait';
}

/** Le message à montrer sur la carte quand le serveur a refusé, sinon null. */
export function messageEchec(etat: EtatReponse): string | null {
  return etat === 'reseau' || etat === 'probleme' ? MESSAGES_ECHEC[etat] : null;
}

/** Commence une réponse. Faux si cette carte a déjà une réponse en route ou confirmée : on ne répond pas deux fois. */
export function commencerReponse(cle: string): boolean {
  if (reponseParties(etatReponse(cle))) return false;
  changer(cle, 'envoi');
  return true;
}

/** Le serveur a confirmé : la carte s'en va (jusque-là elle reste en « Réponse envoyée… »). */
export function finirReponse(cle: string): void {
  changer(cle, 'fait');
}

/** Le serveur a refusé : la carte revient avec un message et on peut répondre à nouveau. */
export function rater(cle: string, famille: 'reseau' | 'probleme'): void {
  changer(cle, famille);
}

function abonner(rappel: () => void): () => void {
  ecouteurs.add(rappel);
  return () => {
    ecouteurs.delete(rappel);
  };
}

/** L'état de la réponse d'une carte, tenu à jour (la carte se redessine seule). */
export function useReponse(cle: string): EtatReponse {
  return useSyncExternalStore(abonner, () => etatReponse(cle));
}

let derniere: Promise<unknown> = Promise.resolve();

/**
 * Fait passer les acceptations d'offres une par une : en accepter deux en même temps, elles se
 * refuseraient l'une l'autre. La carte, elle, change d'état tout de suite ; seul l'envoi attend son tour.
 */
export function enFile<T>(tache: () => Promise<T>): Promise<T> {
  const suite = derniere.then(tache);
  derniere = suite.catch(() => undefined);
  return suite;
}

/** Pour les tests : oublie toutes les réponses. */
export function oublierReponses(): void {
  etats.clear();
  derniere = Promise.resolve();
  for (const rappel of [...ecouteurs]) rappel();
}
