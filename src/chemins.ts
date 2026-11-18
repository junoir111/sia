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
  /** Motifs de route du Mur ; pour un lien, utiliser les fabriques ci-dessous. */
  listeMetier: '/mur/metier/:metier',
  fichePrestataire: '/mur/prestataire/:eventId',
  ficheDemande: '/mur/demande/:eventId',
  bulles: '/bulles',
  /** Motif de route ; pour un lien, utiliser cheminBulle(roomId). */
  bulle: '/bulle/:roomId',
} as const;

/** Adresse d'une bulle (M4) ; l'identifiant du salon est encodé (il contient « ! » et « : »). */
export function cheminBulle(roomId: string): string {
  return '/bulle/' + encodeURIComponent(roomId);
}

/** Ajoute `?quartier=…` et `?metier=…` (contexte hérité) quand ils sont donnés. */
function avecContexte(base: string, contexte: { quartier?: string; metier?: string }): string {
  const requete = new URLSearchParams();
  if (contexte.metier) requete.set('metier', contexte.metier);
  if (contexte.quartier) requete.set('quartier', contexte.quartier);
  const texte = requete.toString();
  return texte ? base + '?' + texte : base;
}

/** Le Mur (E7), avec le quartier tapé s'il y en a un. */
export function cheminMur(quartier?: string): string {
  return avecContexte(CHEMINS.mur, { quartier });
}

/** Liste d'un métier (E8) ; le quartier du Mur est repris. */
export function cheminListeMetier(metier: string, quartier?: string): string {
  return avecContexte('/mur/metier/' + encodeURIComponent(metier), { quartier });
}

/** Fiche d'un prestataire (E9) ; `metier` et `quartier` servent au retour vers la liste. */
export function cheminFichePrestataire(eventId: string, metier: string, quartier?: string): string {
  return avecContexte('/mur/prestataire/' + encodeURIComponent(eventId), { metier, quartier });
}

/** Fiche d'une demande (vue d'un prestataire) ; `metier` et `quartier` servent au retour. */
export function cheminFicheDemande(eventId: string, metier: string, quartier?: string): string {
  return avecContexte('/mur/demande/' + encodeURIComponent(eventId), { metier, quartier });
}

/**
 * Après une inscription réussie : profil selon le rôle du code, sinon choix du rôle (E4).
 * Profil déjà complet (cas rare) : le Mur.
 */
export function cheminApresInscription(
  role: 'prestataire' | 'client' | null,
  profilComplet = false,
): string {
  if (profilComplet) return CHEMINS.mur;
  if (role === 'prestataire') return CHEMINS.profilPrestataire;
  if (role === 'client') return CHEMINS.profilClient;
  return CHEMINS.role;
}
