/** Adresses des écrans de SIA, partagées par la navigation et les écrans. */
export const CHEMINS = {
  accueil: '/',
  connexion: '/connexion',
  inscription: '/inscription',
  codeSecret: '/code-secret',
  role: '/role',
  profilPrestataire: '/profil/prestataire',
  profilClient: '/profil/client',
  mur: '/mur',
  bulles: '/bulles',
  /** Motif de route ; pour un lien, utiliser cheminBulle(roomId). */
  bulle: '/bulle/:roomId',
} as const;

/** Adresse d'une bulle (M4) ; l'identifiant du salon est encodé (il contient « ! » et « : »). */
export function cheminBulle(roomId: string): string {
  return '/bulle/' + encodeURIComponent(roomId);
}

/** Après une inscription réussie : profil selon le rôle du code, sinon choix du rôle (E4). */
export function cheminApresInscription(role: 'prestataire' | 'client' | null): string {
  if (role === 'prestataire') return CHEMINS.profilPrestataire;
  if (role === 'client') return CHEMINS.profilClient;
  return CHEMINS.role;
}
