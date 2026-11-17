import type { Session } from './auth';

/*
 * Session gardée dans localStorage, en clair.
 * À REVOIR à l'étape 8 (code secret) : le jeton d'accès devra être protégé.
 */

const CLE_STOCKAGE = 'sia.session';

/** Taille maximale acceptée pour chaque champ d'une session (identifiant, jeton, appareil). */
export const LONGUEUR_MAX_CHAMP_SESSION = 1024;

function estTexteValide(valeur: unknown): valeur is string {
  return (
    typeof valeur === 'string' && valeur.length > 0 && valeur.length <= LONGUEUR_MAX_CHAMP_SESSION
  );
}

/** Vrai si la valeur est un objet aux 3 champs texte d'une session (non vides, taille bornée). */
export function estSession(valeur: unknown): valeur is Session {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return false;
  const objet = valeur as Record<string, unknown>;
  return (
    estTexteValide(objet.userId) &&
    estTexteValide(objet.accessToken) &&
    estTexteValide(objet.deviceId)
  );
}

export function enregistrerSession(s: Session): void {
  const copie: Session = { userId: s.userId, accessToken: s.accessToken, deviceId: s.deviceId };
  localStorage.setItem(CLE_STOCKAGE, JSON.stringify(copie));
}

export function lireSession(): Session | null {
  let brut: string | null;
  try {
    brut = localStorage.getItem(CLE_STOCKAGE);
  } catch {
    return null;
  }
  if (brut === null) return null;
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!estSession(donnees)) return null;
  return { userId: donnees.userId, accessToken: donnees.accessToken, deviceId: donnees.deviceId };
}

export function effacerSession(): void {
  localStorage.removeItem(CLE_STOCKAGE);
}
