import { nettoyerDemande } from '../../logique/demande';
import type { DemandeClient } from '../../logique/demande';

/*
 * Demande publiée par ce téléphone, gardée pour pouvoir la retirer (et la réafficher) après un rechargement.
 * Elle est déjà publique sur le Mur : rien de secret ici.
 */

const CLE_STOCKAGE = 'sia.demande';

export type DemandeEnCours = { eventId: string; demande: DemandeClient };

const LONGUEUR_MAX_EVENT_ID = 255;

/** Demande encore valable, ou null (absente, illisible ou expirée). */
export function lireDemandeEnCours(maintenant: number): DemandeEnCours | null {
  let donnees: unknown;
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (brut === null) return null;
    donnees = JSON.parse(brut);
  } catch {
    return null;
  }
  if (typeof donnees !== 'object' || donnees === null) return null;
  const { eventId, demande } = donnees as Record<string, unknown>;
  const propre = nettoyerDemande(demande);
  if (typeof eventId !== 'string' || eventId === '' || eventId.length > LONGUEUR_MAX_EVENT_ID) {
    return null;
  }
  if (!propre || propre.fin <= maintenant) return null;
  return { eventId, demande: propre };
}

export function ecrireDemandeEnCours(enCours: DemandeEnCours): void {
  localStorage.setItem(CLE_STOCKAGE, JSON.stringify(enCours));
}

export function effacerDemandeEnCours(): void {
  try {
    localStorage.removeItem(CLE_STOCKAGE);
  } catch {
    // Stockage inaccessible : rien à effacer.
  }
}
