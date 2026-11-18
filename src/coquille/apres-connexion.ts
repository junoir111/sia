import { CHEMINS, cheminApresInscription } from '../chemins';
import type { Session } from '../matrix/auth';
import { lireProfil, lireProfilClient, type ErreurProfil } from '../matrix/profil';

export type ResultatApresConnexion =
  { ok: true; chemin: string } | { ok: false; erreur: ErreurProfil };

/**
 * Après une connexion réussie (E2) : où aller selon le profil enregistré sur le serveur.
 * Un profil (prestataire ou client) → le Mur (E7), aucun profil → E4 (choix du rôle).
 */
export async function cheminApresConnexion(session: Session): Promise<ResultatApresConnexion> {
  const prestataire = await lireProfil(session);
  if (!prestataire.ok) return prestataire;
  if (prestataire.profil) return { ok: true, chemin: CHEMINS.mur };
  const client = await lireProfilClient(session);
  if (!client.ok) return client;
  return {
    ok: true,
    chemin: cheminApresInscription(client.profil ? 'client' : null, client.profil !== null),
  };
}
