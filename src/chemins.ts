/** Adresses des écrans de SIA, partagées par la navigation et les écrans. */
export const CHEMINS = {
  accueil: '/',
  connexion: '/connexion',
  inscription: '/inscription',
  codeSecret: '/code-secret',
  role: '/role',
  profilPrestataire: '/profil/prestataire',
  profilClient: '/profil/client',
} as const;

/** Après une inscription réussie : profil selon le rôle du code, sinon choix du rôle (E4). */
export function cheminApresInscription(role: 'prestataire' | 'client' | null): string {
  if (role === 'prestataire') return CHEMINS.profilPrestataire;
  if (role === 'client') return CHEMINS.profilClient;
  return CHEMINS.role;
}
