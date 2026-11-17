/*
 * Interrupteur « Disponible » du prestataire, gardé sur l'appareil.
 * PROVISOIRE : à l'étape 5 (Le Mur), la disponibilité sera publiée sur le Mur
 * (événement io.sia.statut, 24 h au plus) ; cet état local ne servira plus qu'à l'affichage.
 */

const CLE_STOCKAGE = 'sia.disponible';

export function lireDisponible(): boolean {
  try {
    return localStorage.getItem(CLE_STOCKAGE) === 'oui';
  } catch {
    return false;
  }
}

export function ecrireDisponible(oui: boolean): void {
  localStorage.setItem(CLE_STOCKAGE, oui ? 'oui' : 'non');
}
