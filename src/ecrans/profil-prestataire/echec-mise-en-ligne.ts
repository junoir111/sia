import type { SaisieProfil } from '../../logique/profil';

/*
 * Quand SIA est touché, on file au Mur sans attendre le serveur. Si le serveur refuse ensuite, le message et ce qui
 * était tapé sont déposés ici ; la page du profil les reprend, qu'elle soit déjà ouverte (refus très rapide) ou qu'on
 * la rouvre. Gardé en mémoire seulement (rien sur le téléphone).
 */
export type EchecMiseEnLigne = { message: string; saisie: SaisieProfil };

let depose: EchecMiseEnLigne | null = null;
const ecouteurs = new Set<() => void>();

export function deposerEchec(echec: EchecMiseEnLigne): void {
  depose = echec;
  for (const rappel of [...ecouteurs]) rappel();
}

/** Rend l'échec déposé, une seule fois ; null s'il n'y en a pas. */
export function reprendreEchec(): EchecMiseEnLigne | null {
  const echec = depose;
  depose = null;
  return echec;
}

/** Prévient quand un échec est déposé. Rend la fonction qui arrête d'écouter. */
export function ecouterEchec(rappel: () => void): () => void {
  ecouteurs.add(rappel);
  return () => {
    ecouteurs.delete(rappel);
  };
}

/** Pour les tests : oublie l'échec déposé. */
export function oublierEchec(): void {
  depose = null;
}
