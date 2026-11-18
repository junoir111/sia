import { ADRESSE_SERVEUR } from '../config';
import { nettoyerProfil, type ProfilPrestataire } from '../logique/profil';
import { nettoyerProfilClient, type ProfilClient } from '../logique/profil-client';
import type { Session } from './auth';

/*
 * F4 / F5 — Profil prestataire ou client (champ « role »), gardé dans la donnée de compte privée « io.sia.profile »
 * (document 5, table PROFIL). Seuls son propriétaire et le serveur peuvent la lire.
 * Les photos ne vont JAMAIS ici : elles restent sur l'appareil (src/appareil/photo.ts).
 * Rien n'est écrit dans la console (le jeton d'accès passe dans chaque requête).
 */

export const TYPE_PROFIL = 'io.sia.profile';
export type ErreurProfil = 'session' | 'reseau' | 'inconnue';

const DELAI_RESEAU_MS = 20_000;
const TAILLE_MAX_REPONSE = 64 * 1024;
const STATUTS_SERVEUR_INJOIGNABLE = [502, 503, 504];

type Reponse = { statut: number; corps: Record<string, unknown> | null };

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

function adresseProfil(session: Session): string {
  const utilisateur = encodeURIComponent(session.userId);
  return `${ADRESSE_SERVEUR}/_matrix/client/v3/user/${utilisateur}/account_data/${TYPE_PROFIL}`;
}

async function envoyer(
  session: Session,
  methode: 'GET' | 'PUT',
  corps?: ProfilPrestataire | ProfilClient,
): Promise<Reponse | 'reseau'> {
  let reponse: Response;
  let texte: string;
  try {
    reponse = await fetch(adresseProfil(session), {
      method: methode,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(corps ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(corps ? { body: JSON.stringify(corps) } : {}),
      signal: AbortSignal.timeout(DELAI_RESEAU_MS),
    });
    texte = await reponse.text();
  } catch {
    return 'reseau';
  }
  if (texte.length > TAILLE_MAX_REPONSE) return { statut: reponse.status, corps: null };
  try {
    const donnees: unknown = JSON.parse(texte);
    return { statut: reponse.status, corps: estObjet(donnees) ? donnees : null };
  } catch {
    return { statut: reponse.status, corps: null };
  }
}

function traduireErreur(reponse: Reponse): ErreurProfil {
  if (STATUTS_SERVEUR_INJOIGNABLE.includes(reponse.statut) && !reponse.corps) return 'reseau';
  if (reponse.statut === 401 && reponse.corps?.errcode === 'M_UNKNOWN_TOKEN') return 'session';
  return 'inconnue';
}

/** Lit le profil sur le serveur. Profil absent ou mal formé -> profil null. */
export async function lireProfil(
  session: Session,
): Promise<{ ok: true; profil: ProfilPrestataire | null } | { ok: false; erreur: ErreurProfil }> {
  const reponse = await envoyer(session, 'GET');
  if (reponse === 'reseau') return { ok: false, erreur: 'reseau' };
  if (reponse.statut === 200) return { ok: true, profil: nettoyerProfil(reponse.corps) };
  if (reponse.statut === 404 && reponse.corps?.errcode === 'M_NOT_FOUND') {
    return { ok: true, profil: null };
  }
  return { ok: false, erreur: traduireErreur(reponse) };
}

/** Enregistre le profil sur le serveur, après l'avoir revérifié (un profil invalide n'est jamais envoyé). */
export async function enregistrerProfil(
  session: Session,
  profil: ProfilPrestataire,
): Promise<{ ok: true } | { ok: false; erreur: ErreurProfil }> {
  const propre = nettoyerProfil(profil);
  if (!propre) return { ok: false, erreur: 'inconnue' };
  const reponse = await envoyer(session, 'PUT', propre);
  if (reponse === 'reseau') return { ok: false, erreur: 'reseau' };
  if (reponse.statut === 200) return { ok: true };
  return { ok: false, erreur: traduireErreur(reponse) };
}

/*
 * Profil client : même donnée de compte, avec role = 'client'. Un profil prestataire lu ici rend null
 * (et inversement pour lireProfil) : chaque écran ne voit que son rôle.
 */

/** Lit le profil client sur le serveur. Absent, mal formé ou d'un autre rôle -> null. */
export async function lireProfilClient(
  session: Session,
): Promise<{ ok: true; profil: ProfilClient | null } | { ok: false; erreur: ErreurProfil }> {
  const reponse = await envoyer(session, 'GET');
  if (reponse === 'reseau') return { ok: false, erreur: 'reseau' };
  if (reponse.statut === 200) return { ok: true, profil: nettoyerProfilClient(reponse.corps) };
  if (reponse.statut === 404 && reponse.corps?.errcode === 'M_NOT_FOUND') {
    return { ok: true, profil: null };
  }
  return { ok: false, erreur: traduireErreur(reponse) };
}

/** Enregistre le profil client, après l'avoir revérifié (seuls version, role, pseudo, zone partent). */
export async function enregistrerProfilClient(
  session: Session,
  profil: ProfilClient,
): Promise<{ ok: true } | { ok: false; erreur: ErreurProfil }> {
  const propre = nettoyerProfilClient(profil);
  if (!propre) return { ok: false, erreur: 'inconnue' };
  const reponse = await envoyer(session, 'PUT', propre);
  if (reponse === 'reseau') return { ok: false, erreur: 'reseau' };
  if (reponse.statut === 200) return { ok: true };
  return { ok: false, erreur: traduireErreur(reponse) };
}

/** Pseudo déjà enregistré, quel que soit le rôle (pour le reprendre en changeant de rôle). Rien -> null. */
export async function lirePseudoEnregistre(session: Session): Promise<string | null> {
  const reponse = await envoyer(session, 'GET');
  if (reponse === 'reseau' || reponse.statut !== 200) return null;
  return nettoyerProfil(reponse.corps)?.pseudo ?? nettoyerProfilClient(reponse.corps)?.pseudo ?? null;
}
