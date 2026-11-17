/** Envoyé par la page prestataire quand il devient disponible : le bandeau relit les demandes en cours. */
export const EVENEMENT_DISPONIBLE = 'sia:disponible';

/** Envoyé par le bandeau quand le client a accepté une offre : sa page repasse au gris « Tu as choisi. ». */
export const EVENEMENT_CHOISI = 'sia:choisi';

/** Le client a choisi une offre depuis l'ouverture de l'appli (gardé en mémoire seulement). */
let choixFait = false;

export function signalerDisponible(): void {
  window.dispatchEvent(new Event(EVENEMENT_DISPONIBLE));
}

export function signalerChoix(): void {
  choixFait = true;
  window.dispatchEvent(new Event(EVENEMENT_CHOISI));
}

export function aChoisi(): boolean {
  return choixFait;
}

/** Une nouvelle demande part : on oublie le choix précédent. */
export function oublierChoix(): void {
  choixFait = false;
}
