type Proprietes = {
  /** Vert : la personne est visible. */
  allume: boolean;
  /** Faux : le bouton est grisé et ne réagit pas. */
  actif: boolean;
  chargement?: boolean;
  /** Identifiant de la phrase qui explique l'état (sous le bouton). */
  idPhrase?: string;
  onClick: () => void;
};

/** Gros bouton « SIA » : gris quand on n'est pas visible, vert accent quand on l'est. */
export function BoutonSia({ allume, actif, chargement = false, idPhrase, onClick }: Proprietes) {
  return (
    <button
      type="button"
      className={allume ? 'bouton-sia bouton-sia--allume' : 'bouton-sia'}
      aria-pressed={allume}
      aria-busy={chargement || undefined}
      aria-describedby={idPhrase}
      disabled={!actif || chargement}
      onClick={onClick}
    >
      SIA
    </button>
  );
}
