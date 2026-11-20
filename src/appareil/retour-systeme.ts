/*
 * Android : le bouton « retour » du téléphone doit faire la MÊME chose que la flèche en haut de l'écran
 * (même fonction, même destination). On ne recopie pas la destination de chaque écran : on touche la flèche
 * qui est affichée, donc un nouvel écran avec sa flèche est pris en compte sans rien changer ici.
 */

/**
 * Fait ce que l'écran propose pour reculer : d'abord ferme la fenêtre ouverte (« Mon compte », confirmation),
 * sinon touche la flèche du haut. Rend faux s'il n'y a rien à toucher (page de départ, profil sans flèche).
 * Une fenêtre qui ne peut pas se fermer (action en cours) garde le retour : on ne quitte pas l'écran pendant l'envoi.
 */
export function reculerSurEcran(racine: ParentNode = document): boolean {
  const voile = racine.querySelector<HTMLElement>('.feuille__voile');
  if (voile) {
    voile.click();
    return true;
  }
  const fleche = racine.querySelector<HTMLElement>('.retour');
  if (fleche) {
    fleche.click();
    return true;
  }
  return false;
}
