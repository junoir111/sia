type Proprietes = {
  nom: string;
  /** grand : 64 px (profil) ; moyen : 48 px (liste des bulles) ; petit : 40 px (en-tête de bulle). */
  taille?: 'grand' | 'moyen' | 'petit';
};

/** Rond avec la première lettre du pseudo (pas de photo) : simple décor, le pseudo est écrit à côté. */
export function RondInitiale({ nom, taille = 'grand' }: Proprietes) {
  const initiale = [...nom.trim()][0]?.toLocaleUpperCase('fr') ?? '';
  const classe = taille === 'grand' ? 'rond-initiale' : `rond-initiale rond-initiale--${taille}`;
  return (
    <span className={classe} aria-hidden="true">
      {initiale}
    </span>
  );
}
