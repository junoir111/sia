import { LIMITES, texteSur } from '../logique/profil';

/*
 * Annuaire local pseudo ↔ compte (anti-usurpation). Le PREMIER compte vu avec un pseudo le garde :
 * un autre compte qui annonce le même pseudo (même écrit en majuscules) est ignoré.
 * Gardé dans localStorage « sia.annuaire » (500 entrées au plus, les plus anciennes partent).
 */

export const CLE_ANNUAIRE = 'sia.annuaire';
const TAILLE_MAX = 500;
const ID_MAX = 255;
const FORME_ID_UTILISATEUR = /^@[^:\s]+:\S+$/;

type Entree = { userId: string; pseudo: string };

function estUserId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= ID_MAX && FORME_ID_UTILISATEUR.test(v);
}

/** Forme de comparaison : « Puma » et « puma » sont le même pseudo. */
function cle(pseudo: string): string {
  return pseudo.normalize('NFKC').toLowerCase();
}

function lire(): Entree[] {
  try {
    const brut = localStorage.getItem(CLE_ANNUAIRE);
    if (brut === null) return [];
    const donnees: unknown = JSON.parse(brut);
    if (!Array.isArray(donnees)) return [];
    const propres: Entree[] = [];
    for (const e of donnees.slice(-TAILLE_MAX)) {
      if (typeof e !== 'object' || e === null) continue;
      const o = e as Record<string, unknown>;
      const pseudo = texteSur(o.pseudo, LIMITES.pseudo);
      if (estUserId(o.userId) && pseudo !== null) propres.push({ userId: o.userId, pseudo });
    }
    return propres;
  } catch {
    return [];
  }
}

function ecrire(entrees: readonly Entree[]): void {
  try {
    localStorage.setItem(CLE_ANNUAIRE, JSON.stringify(entrees.slice(-TAILLE_MAX)));
  } catch {
    // Stockage plein ou interdit : l'annuaire n'est pas gardé.
  }
}

/** Pseudo le plus récemment noté pour ce compte, ou null. */
export function pseudoDe(userId: string): string | null {
  if (!estUserId(userId)) return null;
  const trouve = lire().filter((e) => e.userId === userId);
  return trouve.at(-1)?.pseudo ?? null;
}

/**
 * Vrai si ce pseudo peut être affiché pour ce compte : libre, ou déjà à lui. N'ENREGISTRE RIEN.
 * À utiliser pour tout pseudo venu d'un texte libre (raison d'invitation, état de bulle) :
 * seuls un statut ou une annonce du Mur ont le droit de réserver un pseudo (noterPseudo).
 */
export function pseudoCompatible(userId: string, pseudo: string): boolean {
  const propre = texteSur(pseudo, LIMITES.pseudo);
  if (!estUserId(userId) || propre === null) return false;
  const proprietaire = lire().find((e) => cle(e.pseudo) === cle(propre));
  return proprietaire === undefined || proprietaire.userId === userId;
}

/**
 * Note qu'un compte utilise un pseudo. Rend false si le pseudo appartient déjà à un AUTRE compte
 * (ou si les données sont invalides) : l'annonce doit alors être ignorée.
 */
export function noterPseudo(userId: string, pseudo: string): boolean {
  const propre = texteSur(pseudo, LIMITES.pseudo);
  if (!estUserId(userId) || propre === null) return false;
  const entrees = lire();
  const proprietaire = entrees.find((e) => cle(e.pseudo) === cle(propre));
  if (proprietaire) return proprietaire.userId === userId;
  ecrire([...entrees, { userId, pseudo: propre }]);
  return true;
}
