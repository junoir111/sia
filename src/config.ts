/** Adresse du serveur Matrix de SIA. Ne doit jamais changer. */
export const ADRESSE_SERVEUR = 'https://sia.tail94dc60.ts.net';

const SECONDE_MS = 1000;
const HEURE_MS = 60 * 60 * SECONDE_MS;

/** Durée de vie d'un message dans la bulle, comptée à partir de l'affichage. */
export const DUREE_MESSAGE_MS = 60 * SECONDE_MS;

/** Durée maximale d'une annonce sur le Mur. */
export const DUREE_MAX_ANNONCE_MS = 24 * HEURE_MS;
