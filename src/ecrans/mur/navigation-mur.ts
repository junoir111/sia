import { cheminListeMetier, cheminMur } from '../../chemins';

/** Message de succès porté par l'état de navigation (pas par l'adresse). */
export function etatSucces(message: string): { succes: string } {
  return { succes: message };
}

export function lireSucces(etat: unknown): string | null {
  if (typeof etat !== 'object' || etat === null) return null;
  const succes = (etat as { succes?: unknown }).succes;
  return typeof succes === 'string' && succes !== '' ? succes : null;
}

/** Page de retour d'une fiche : la liste du métier d'origine (avec le quartier), sinon le Mur. */
export function cheminRetourFiche(metier: string | null, quartier: string | undefined): string {
  return metier ? cheminListeMetier(metier, quartier) : cheminMur(quartier);
}

/** « il y a 12 min » */
export function ilYa(depuis: number, maintenant: number): string {
  const minutes = Math.floor((maintenant - depuis) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.floor(minutes / 60)} h`;
}
