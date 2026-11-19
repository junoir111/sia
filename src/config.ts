/** Adresse du serveur Matrix de SIA. Ne doit jamais changer. */
export const ADRESSE_SERVEUR = 'https://sia.tail94dc60.ts.net';

const SECONDE_MS = 1000;
const HEURE_MS = 60 * 60 * SECONDE_MS;

/** Durée de vie d'un message dans la bulle, comptée à partir de l'affichage. */
export const DUREE_MESSAGE_MS = 60 * SECONDE_MS;

/** Durée maximale d'une annonce sur le Mur. */
export const DUREE_MAX_ANNONCE_MS = 24 * HEURE_MS;

/** Salon du Mur (alias, l'identifiant interne est retrouvé par le serveur). */
export const ALIAS_MUR = '#sia-mur:sia.tail94dc60.ts.net';

/** Identifiant de l'appli côté notifications (celui d'Android). */
export const APP_ID_PUSH = 'io.github.junoir111.sia';

/**
 * Passerelle de notifications de SIA (sur le serveur de la maison) : reçoit le signal de Tuwunel et le transmet à Firebase,
 * sans aucun texte. Port 8444 = réseau privé Tailscale seulement (pas Internet) : seul le serveur lui-même l'appelle.
 */
export const URL_PASSERELLE_PUSH = 'https://sia.tail94dc60.ts.net:8444/_matrix/push/v1/notify';
