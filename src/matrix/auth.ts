import { ADRESSE_SERVEUR } from '../config';
import { estSession } from './session';

/*
 * Inscription Matrix (spec client-serveur v3, POST /register) avec le jeton d'invitation
 * (étape « m.login.registration_token »). Écrit avec fetch plutôt qu'avec matrix-js-sdk :
 * deux requêtes suffisent, chaque champ de la réponse est vérifié ici, et les tests
 * n'ont qu'à simuler fetch.
 */

export type Session = { userId: string; accessToken: string; deviceId: string };
export type ErreurInscription =
  | 'code-invalide'
  | 'identifiant-pris'
  | 'identifiant-invalide'
  | 'mot-de-passe-faible'
  | 'reseau'
  | 'inconnue';
export type ResultatInscription =
  { ok: true; session: Session } | { ok: false; erreur: ErreurInscription };

const URL_INSCRIPTION = `${ADRESSE_SERVEUR}/_matrix/client/v3/register?kind=user`;
const NOM_SERVEUR = new URL(ADRESSE_SERVEUR).hostname;
const NOM_APPAREIL = 'SIA';
const DELAI_RESEAU_MS = 20_000;
const TAILLE_MAX_REPONSE = 64 * 1024;
const MAX_ETAPES = 3;

/** Mot de passe : 10 signes minimum (document 5, table COMPTE). */
export const MOT_DE_PASSE_MIN = 10;
/** Identifiant Matrix complet : 255 signes au plus (spec Matrix). */
const LONGUEUR_MAX_ID_MATRIX = 255;
const LONGUEUR_MAX_IDENTIFIANT = LONGUEUR_MAX_ID_MATRIX - `@:${NOM_SERVEUR}`.length;
const FORME_IDENTIFIANT = /^[a-z0-9._=\-/+]+$/;
/** Jeton d'inscription : 64 signes au plus, alphabet [A-Za-z0-9._~-] (spec Matrix). */
const FORME_CODE = /^[A-Za-z0-9._~-]{1,64}$/;
const LONGUEUR_MAX_SESSION_UIA = 255;

const ETAPE_JETON = 'm.login.registration_token';
const ETAPE_VIDE = 'm.login.dummy';
const ETAPES_GEREES = [ETAPE_JETON, ETAPE_VIDE];
const STATUTS_SERVEUR_INJOIGNABLE = [502, 503, 504];

type Reponse = { statut: number; corps: Record<string, unknown> | null };
type EtatUia = { session: string; flux: string[][]; faites: string[] };

function echec(erreur: ErreurInscription): ResultatInscription {
  return { ok: false, erreur };
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

function estListeDeTextes(valeur: unknown): valeur is string[] {
  return Array.isArray(valeur) && valeur.every((element) => typeof element === 'string');
}

function verifierSaisie(
  identifiant: string,
  motDePasse: string,
  code: string,
): ErreurInscription | null {
  if (
    typeof identifiant !== 'string' ||
    identifiant.length > LONGUEUR_MAX_IDENTIFIANT ||
    !FORME_IDENTIFIANT.test(identifiant)
  ) {
    return 'identifiant-invalide';
  }
  if (typeof motDePasse !== 'string' || motDePasse.length < MOT_DE_PASSE_MIN)
    return 'mot-de-passe-faible';
  if (typeof code !== 'string' || !FORME_CODE.test(code)) return 'code-invalide';
  return null;
}

async function envoyer(corps: Record<string, unknown>): Promise<Reponse | 'reseau'> {
  let reponse: Response;
  let texte: string;
  try {
    reponse = await fetch(URL_INSCRIPTION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
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

function lireEtatUia(corps: Record<string, unknown> | null): EtatUia | null {
  if (!corps) return null;
  const session = corps.session;
  if (
    typeof session !== 'string' ||
    session.length === 0 ||
    session.length > LONGUEUR_MAX_SESSION_UIA
  )
    return null;
  if (!Array.isArray(corps.flows)) return null;
  const flux: string[][] = [];
  for (const element of corps.flows) {
    if (!estObjet(element) || !estListeDeTextes(element.stages)) return null;
    flux.push(element.stages);
  }
  const faites = corps.completed === undefined ? [] : corps.completed;
  if (!estListeDeTextes(faites)) return null;
  return { session, flux, faites };
}

/** Prochaine étape d'un flux qui contient le jeton et dont toutes les étapes sont gérées par SIA. */
function prochaineEtape(etat: EtatUia): string | null {
  const flux = etat.flux.find(
    (etapes) =>
      etapes.includes(ETAPE_JETON) && etapes.every((etape) => ETAPES_GEREES.includes(etape)),
  );
  return flux?.find((etape) => !etat.faites.includes(etape)) ?? null;
}

function lireSessionServeur(corps: Record<string, unknown> | null): ResultatInscription {
  if (!corps) return echec('inconnue');
  const session = {
    userId: corps.user_id,
    accessToken: corps.access_token,
    deviceId: corps.device_id,
  };
  if (!estSession(session)) return echec('inconnue');
  const forme = session.userId.length <= LONGUEUR_MAX_ID_MATRIX && session.userId.startsWith('@');
  if (!forme || !session.userId.endsWith(`:${NOM_SERVEUR}`)) return echec('inconnue');
  return { ok: true, session };
}

function traduireErreur(reponse: Reponse, jetonEnvoye: boolean): ErreurInscription {
  if (STATUTS_SERVEUR_INJOIGNABLE.includes(reponse.statut) && !reponse.corps) return 'reseau';
  const code = reponse.corps?.errcode;
  if (code === 'M_USER_IN_USE') return 'identifiant-pris';
  if (code === 'M_INVALID_USERNAME') return 'identifiant-invalide';
  if (code === 'M_WEAK_PASSWORD') return 'mot-de-passe-faible';
  if (jetonEnvoye && (code === 'M_FORBIDDEN' || code === 'M_UNAUTHORIZED')) return 'code-invalide';
  return 'inconnue';
}

/**
 * Crée un compte sur le serveur SIA avec le code d'invitation.
 * Ne journalise jamais le mot de passe, le code ni le jeton d'accès.
 */
export async function creerCompte(
  identifiant: string,
  motDePasse: string,
  code: string,
): Promise<ResultatInscription> {
  const saisieInvalide = verifierSaisie(identifiant, motDePasse, code);
  if (saisieInvalide) return echec(saisieInvalide);

  const base = {
    username: identifiant,
    password: motDePasse,
    initial_device_display_name: NOM_APPAREIL,
    inhibit_login: false,
  };
  let reponse = await envoyer(base);
  let jetonEnvoye = false;

  for (let etapes = 0; etapes <= MAX_ETAPES; etapes += 1) {
    if (reponse === 'reseau') return echec('reseau');
    if (reponse.statut === 200) return lireSessionServeur(reponse.corps);
    if (reponse.statut !== 401) return echec(traduireErreur(reponse, jetonEnvoye));

    const etat = lireEtatUia(reponse.corps);
    if (!etat) return echec('inconnue');
    if (jetonEnvoye && !etat.faites.includes(ETAPE_JETON)) return echec('code-invalide');
    const etape = prochaineEtape(etat);
    if (!etape) return echec('inconnue');

    const auth =
      etape === ETAPE_JETON
        ? { type: ETAPE_JETON, token: code, session: etat.session }
        : { type: etape, session: etat.session };
    jetonEnvoye = jetonEnvoye || etape === ETAPE_JETON;
    reponse = await envoyer({ ...base, auth });
  }
  return echec('inconnue');
}
