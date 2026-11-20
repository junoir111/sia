// F12 — Code secret à 4 chiffres : règles (sans écran, sans réseau, sans stockage).
// Choisi à l'inscription, il verrouille l'appli. Le stockage et le calcul de l'empreinte sont dans src/appareil/verrou.ts.

export const LONGUEUR_CODE = 4;
/** Codes faux de suite avant l'attente. */
export const ESSAIS_AVANT_ATTENTE = 5;
export const ATTENTE_MS = 30_000;
/** Temps passé hors de l'appli à partir duquel le code est redemandé. */
export const ABSENCE_MAX_MS = 60_000;

const FORME_CODE = /^[0-9]{4}$/;

export function codeValide(brut: unknown): brut is string {
  return typeof brut === 'string' && FORME_CODE.test(brut);
}

/** Ce qu'on tape : seulement des chiffres, 4 au plus. */
export function nettoyerSaisieCode(brut: string): string {
  return brut.replace(/[^0-9]/g, '').slice(0, LONGUEUR_CODE);
}

export type EtatEssais = { echecs: number; attenteJusqua: number };

export const ESSAIS_NEUFS: EtatEssais = { echecs: 0, attenteJusqua: 0 };

/**
 * Millisecondes à attendre encore avant de pouvoir réessayer (0 : on peut). Jamais plus que l'attente prévue :
 * une horloge avancée puis remise à l'heure ne doit pas bloquer des heures.
 */
export function attenteRestante(e: EtatEssais, maintenant: number): number {
  return Math.min(ATTENTE_MS, Math.max(0, e.attenteJusqua - maintenant));
}

/** État après un code faux : au 5e de suite, 30 secondes d'attente et le compte repart de zéro. */
export function apresEchec(e: EtatEssais, maintenant: number): EtatEssais {
  const echecs = e.echecs + 1;
  if (echecs >= ESSAIS_AVANT_ATTENTE) return { echecs: 0, attenteJusqua: maintenant + ATTENTE_MS };
  return { echecs, attenteJusqua: e.attenteJusqua };
}

/**
 * Vrai si on est resté assez longtemps hors de l'appli pour redemander le code. Une horloge reculée pendant
 * l'absence (durée négative) compte aussi : on referme.
 */
export function doitVerrouiller(sortieA: number | null, maintenant: number): boolean {
  if (sortieA === null) return false;
  return maintenant < sortieA || maintenant - sortieA >= ABSENCE_MAX_MS;
}

/** Relit l'état gardé : rien de ce qui vient du stockage n'est cru sur parole (étrange : état neuf). */
export function lireEtatEssais(brut: unknown): EtatEssais {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return ESSAIS_NEUFS;
  const { echecs, attenteJusqua } = brut as Record<string, unknown>;
  if (
    typeof echecs !== 'number' ||
    !Number.isInteger(echecs) ||
    echecs < 0 ||
    echecs >= ESSAIS_AVANT_ATTENTE ||
    typeof attenteJusqua !== 'number' ||
    !Number.isFinite(attenteJusqua) ||
    attenteJusqua < 0
  ) {
    return ESSAIS_NEUFS;
  }
  return { echecs, attenteJusqua };
}
