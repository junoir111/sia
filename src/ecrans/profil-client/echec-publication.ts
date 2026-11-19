import type { SaisieProfilClient as SaisieClient } from '../../logique/profil-client';
import { creerBoiteEchec } from '../echec-envoi';
import type { EchecEnvoi } from '../echec-envoi';

/*
 * Quand SIA est touché, on file au Mur sans attendre le serveur. Si le serveur refuse ensuite, le message et ce qui
 * était tapé sont déposés ici ; la page du client les reprend (voir ../echec-envoi.ts).
 */
export type EchecPublication = EchecEnvoi<SaisieClient>;

const boite = creerBoiteEchec<SaisieClient>();

export const deposerEchec = boite.deposer;
export const reprendreEchec = boite.reprendre;
export const ecouterEchec = boite.ecouter;
export const oublierEchec = boite.oublier;
