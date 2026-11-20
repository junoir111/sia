import {
  ATTENTE_MS,
  ESSAIS_AVANT_ATTENTE,
  ESSAIS_NEUFS,
  apresEchec,
  attenteRestante,
  codeValide,
  lireEtatEssais,
} from '../logique/code-secret';
import type { EtatEssais } from '../logique/code-secret';

/*
 * Verrou de l'appli (F12) : le code secret à 4 chiffres choisi à l'inscription.
 * Il reste sur CE téléphone et n'est jamais envoyé au serveur. On ne garde pas le code mais son empreinte
 * (PBKDF2-SHA-256, sel au hasard). Limite assumée : 4 chiffres ne résistent pas à quelqu'un qui lit les
 * fichiers du téléphone ; ce verrou écarte un curieux qui a l'appli en main (voir le PRD, F12).
 * « Se déconnecter » efface tout (la clé fait partie de CLES_APPAREIL dans matrix/auth.ts).
 */

export const CLE_VERROU = 'sia.verrou';
const ITERATIONS = 100_000;
const OCTETS_SEL = 16;
const FORME_HEX = /^(?:[0-9a-f]{2})+$/;

type Garde = { sel: string; empreinte: string; iterations: number; essais: EtatEssais };

function enHex(octets: Uint8Array): string {
  return Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');
}

function depuisHex(hex: string): Uint8Array {
  const octets = new Uint8Array(hex.length / 2);
  for (let i = 0; i < octets.length; i += 1) octets[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return octets;
}

async function empreinteDe(code: string, sel: Uint8Array, iterations: number): Promise<string> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sel as BufferSource, iterations },
    base,
    256,
  );
  return enHex(new Uint8Array(bits));
}

/** Comparaison qui ne s'arrête pas au premier signe différent. */
function memeTexte(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

function lire(): Garde | null {
  let brut: unknown;
  try {
    const texte = localStorage.getItem(CLE_VERROU);
    if (texte === null) return null;
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
  const { sel, empreinte, iterations, essais } = brut as Record<string, unknown>;
  if (
    typeof sel !== 'string' ||
    !FORME_HEX.test(sel) ||
    typeof empreinte !== 'string' ||
    !FORME_HEX.test(empreinte) ||
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < 1_000 ||
    iterations > 10_000_000
  ) {
    return null;
  }
  return { sel, empreinte, iterations, essais: lireEtatEssais(essais) };
}

function ecrire(garde: Garde): void {
  localStorage.setItem(CLE_VERROU, JSON.stringify(garde));
}

/** Ce téléphone a-t-il un code secret ? */
export function codeDefini(): boolean {
  return lire() !== null;
}

/** Millisecondes à patienter avant de pouvoir retaper le code (0 : on peut tout de suite). */
export function attenteAvantEssai(maintenant: number = Date.now()): number {
  const garde = lire();
  return garde === null ? 0 : attenteRestante(garde.essais, maintenant);
}

/** Choisit (ou change) le code de ce téléphone. Refuse tout ce qui n'est pas 4 chiffres. L'appli reste ouverte. */
export async function definirCode(code: string): Promise<void> {
  if (!codeValide(code)) throw new Error('Le code doit avoir 4 chiffres.');
  const sel = crypto.getRandomValues(new Uint8Array(OCTETS_SEL));
  const empreinte = await empreinteDe(code, sel, ITERATIONS);
  ecrire({ sel: enHex(sel), empreinte, iterations: ITERATIONS, essais: ESSAIS_NEUFS });
  verrouille = false;
  prevenir();
}

/**
 * - `ok` : bon code, l'appli se déverrouille.
 * - `faux` : mauvais code ; `restants` essais avant l'attente.
 * - `attente` : trop d'essais, on patiente `ms` (même le bon code est refusé pendant l'attente).
 */
export type ResultatCode =
  { etat: 'ok' } | { etat: 'faux'; restants: number } | { etat: 'attente'; ms: number };

export async function verifierCode(
  code: string,
  maintenant: number = Date.now(),
): Promise<ResultatCode> {
  const garde = lire();
  if (garde === null) return { etat: 'faux', restants: ESSAIS_AVANT_ATTENTE };
  const attente = attenteRestante(garde.essais, maintenant);
  if (attente > 0) return { etat: 'attente', ms: attente };
  // L'essai est compté AVANT d'être vérifié (et deux essais à la suite ne se mélangent pas) : si le stockage
  // refuse d'écrire, rien n'est vérifié.
  const essais = apresEchec(garde.essais, maintenant);
  ecrire({ ...garde, essais });
  const bon =
    codeValide(code) &&
    memeTexte(await empreinteDe(code, depuisHex(garde.sel), garde.iterations), garde.empreinte);
  if (bon) {
    try {
      ecrire({ ...garde, essais: ESSAIS_NEUFS });
    } catch {
      // Sans gravité : le bon code ouvre quand même, le compteur sera remis à zéro à la prochaine réussite.
    }
    deverrouiller();
    return { etat: 'ok' };
  }
  if (attenteRestante(essais, maintenant) > 0) return { etat: 'attente', ms: ATTENTE_MS };
  return { etat: 'faux', restants: ESSAIS_AVANT_ATTENTE - essais.echecs };
}

// --- Verrouillé ou non, tenu en mémoire (jamais écrit) ---

// Fermé au départ, quoi qu'on lise au chargement : à chaque démarrage, un code existant doit être tapé
// (même si le stockage était illisible un instant). Sans code, `etatVerrou()` dit « sans-code » et on en choisit un.
let verrouille = true;
const ecouteurs = new Set<() => void>();

function prevenir(): void {
  for (const rappel of [...ecouteurs]) rappel();
}

/** Où en est ce téléphone : `sans-code` (rien de choisi), `ferme` (code à taper) ou `ouvert`. */
export type EtatVerrou = 'sans-code' | 'ferme' | 'ouvert';

export function etatVerrou(): EtatVerrou {
  if (!codeDefini()) return 'sans-code';
  return verrouille ? 'ferme' : 'ouvert';
}

/** Vrai si l'appli est fermée à clé (il y a un code, et on ne l'a pas encore tapé). */
export function estVerrouille(): boolean {
  return verrouille && codeDefini();
}

/** Ferme l'appli à clé (sans code défini, rien à fermer). */
export function verrouiller(): void {
  if (!codeDefini() || verrouille) return;
  verrouille = true;
  prevenir();
}

export function deverrouiller(): void {
  if (!verrouille) return;
  verrouille = false;
  prevenir();
}

/** Prévient quand l'état change. Rend la fonction qui arrête d'écouter. */
export function surVerrou(rappel: () => void): () => void {
  ecouteurs.add(rappel);
  return () => {
    ecouteurs.delete(rappel);
  };
}
