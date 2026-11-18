import { effacerPhoto } from '../appareil/photo';
import { ADRESSE_SERVEUR } from '../config';
import { arreterClient, clientActif, PREFIXE_BASE_CRYPTO } from './client';
import { toutEffacerMaintenant } from './ephemere';
import { oublierMur, retirerMesPublications } from './mur';
import { effacerSession, estSession } from './session';

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
const URL_CONNEXION = `${ADRESSE_SERVEUR}/_matrix/client/v3/login`;
const URL_DECONNEXION = `${ADRESSE_SERVEUR}/_matrix/client/v3/logout`;
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

async function envoyer(
  corps: Record<string, unknown>,
  url: string = URL_INSCRIPTION,
): Promise<Reponse | 'reseau'> {
  let reponse: Response;
  let texte: string;
  try {
    reponse = await fetch(url, {
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

/** Session donnée par le serveur, ou null si un champ manque, est trop long ou vient d'un autre serveur. */
function lireSessionServeur(corps: Record<string, unknown> | null): Session | null {
  if (!corps) return null;
  const session = {
    userId: corps.user_id,
    accessToken: corps.access_token,
    deviceId: corps.device_id,
  };
  if (!estSession(session)) return null;
  const forme = session.userId.length <= LONGUEUR_MAX_ID_MATRIX && session.userId.startsWith('@');
  if (!forme || !session.userId.endsWith(`:${NOM_SERVEUR}`)) return null;
  return { userId: session.userId, accessToken: session.accessToken, deviceId: session.deviceId };
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
    if (reponse.statut === 200) {
      const session = lireSessionServeur(reponse.corps);
      return session ? { ok: true, session } : echec('inconnue');
    }
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

export type ErreurConnexion = 'identifiants' | 'reseau' | 'inconnue';
export type ResultatConnexion =
  { ok: true; session: Session } | { ok: false; erreur: ErreurConnexion };

/** Mot de passe envoyé à la connexion : 1024 signes au plus (au-delà, refusé sans appel réseau). */
const LONGUEUR_MAX_MOT_DE_PASSE = 1024;

/**
 * Connexion par identifiant (partie avant « : ») et mot de passe (POST /login, m.login.password).
 * Ne journalise jamais le mot de passe ni le jeton d'accès.
 */
export async function connecter(
  identifiant: string,
  motDePasse: string,
): Promise<ResultatConnexion> {
  if (
    typeof identifiant !== 'string' ||
    identifiant.length > LONGUEUR_MAX_IDENTIFIANT ||
    !FORME_IDENTIFIANT.test(identifiant) ||
    typeof motDePasse !== 'string' ||
    motDePasse.length === 0 ||
    motDePasse.length > LONGUEUR_MAX_MOT_DE_PASSE
  ) {
    return { ok: false, erreur: 'identifiants' };
  }
  const reponse = await envoyer(
    {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: identifiant },
      password: motDePasse,
      initial_device_display_name: NOM_APPAREIL,
    },
    URL_CONNEXION,
  );
  if (reponse === 'reseau') return { ok: false, erreur: 'reseau' };
  if (reponse.statut === 200) {
    const session = lireSessionServeur(reponse.corps);
    return session ? { ok: true, session } : { ok: false, erreur: 'inconnue' };
  }
  if (reponse.statut === 403 && reponse.corps?.errcode === 'M_FORBIDDEN') {
    return { ok: false, erreur: 'identifiants' };
  }
  if (STATUTS_SERVEUR_INJOIGNABLE.includes(reponse.statut) && !reponse.corps) {
    return { ok: false, erreur: 'reseau' };
  }
  return { ok: false, erreur: 'inconnue' };
}

/** Clés gardées sur l'appareil par SIA (hors session, effacée à part). */
const CLES_APPAREIL = [
  'sia.disponible',
  'sia.demande',
  'sia.a-effacer',
  'sia.statut',
  'sia.vues',
  'sia.annuaire',
  'sia.appareils',
];
/** Temps laissé aux effacements en attente avant d'annuler le jeton. */
const DELAI_EFFACEMENTS_MS = 10_000;
/** Délai maximal pour retirer mon statut et mes demandes du Mur avant de quitter (hors-ligne : on n'attend pas). */
const DELAI_RETRAIT_MUR_MS = 5_000;
/** Bases IndexedDB du chiffrement Rust (noms fixés par matrix-js-sdk à partir du préfixe). */
function basesChiffrement(): string[] {
  return [
    `${PREFIXE_BASE_CRYPTO}::matrix-sdk-crypto`,
    `${PREFIXE_BASE_CRYPTO}::matrix-sdk-crypto-meta`,
  ];
}

function essayer(action: () => void): void {
  try {
    action();
  } catch {
    // Étape impossible sur cet appareil : on passe à la suivante.
  }
}

async function annulerJeton(session: Session): Promise<void> {
  if (!estSession(session)) return;
  try {
    await fetch(URL_DECONNEXION, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: '{}',
      signal: AbortSignal.timeout(DELAI_RESEAU_MS),
    });
  } catch {
    // Serveur injoignable : on efface quand même l'appareil.
  }
}

function effacerBase(nom: string): Promise<void> {
  return new Promise((resoudre) => {
    try {
      const demande = indexedDB.deleteDatabase(nom);
      demande.onsuccess = () => resoudre();
      demande.onerror = () => resoudre();
      // Base encore ouverte ailleurs : elle sera effacée à sa fermeture, on n'attend pas.
      demande.onblocked = () => resoudre();
    } catch {
      resoudre();
    }
  });
}

/** Attend `tache` au plus `delaiMs` ; n'échoue jamais. */
async function avecDelai(tache: Promise<unknown>, delaiMs: number): Promise<void> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<void>((resoudre) => {
    minuterie = setTimeout(resoudre, delaiMs);
  });
  try {
    await Promise.race([tache.catch(() => undefined), delai]);
  } finally {
    clearTimeout(minuterie);
  }
}

/** Retire mon statut et mes demandes du Mur (il faut encore le jeton), 5 s au plus. */
async function retirerDuMur(): Promise<void> {
  const c = clientActif();
  if (c) await avecDelai(retirerMesPublications(c), DELAI_RETRAIT_MUR_MS);
}

/** Efface tout de suite les messages en file (il faut encore le jeton), 10 s au plus. */
async function effacerMessagesEnAttente(): Promise<void> {
  const c = clientActif();
  if (c) await avecDelai(toutEffacerMaintenant(c), DELAI_EFFACEMENTS_MS);
}

/**
 * Déconnexion (document 5, §4.5) : statut et demandes retirés du Mur, messages en file effacés, jeton annulé sur le serveur, puis données de l'appareil effacées
 * (session, état local, photo, clés de chiffrement). Ne rejette jamais : chaque étape est tentée.
 */
export async function deconnecter(session: Session): Promise<void> {
  await retirerDuMur();
  await effacerMessagesEnAttente();
  await annulerJeton(session);
  essayer(() => arreterClient());
  essayer(() => oublierMur());
  essayer(() => effacerSession());
  for (const cle of CLES_APPAREIL) essayer(() => localStorage.removeItem(cle));
  try {
    await effacerPhoto();
  } catch {
    // Pas de photo ou stockage indisponible.
  }
  for (const nom of basesChiffrement()) await effacerBase(nom);
}
