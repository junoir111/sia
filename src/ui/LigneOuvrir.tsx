type Proprietes = {
  onOuvrir: () => void;
  className?: string;
};

/**
 * Ligne d'une carte d'alerte qui n'a qu'une action : « Ouvrir la bulle » et UN bouton « Ouvrir ».
 * Même mise en page et même hauteur que la ligne Non / Oui (ReponseOuiNon) : les cartes s'empilent à l'identique.
 */
export function LigneOuvrir({ onOuvrir, className }: Proprietes) {
  return (
    <div className={className ? `reponse ${className}` : 'reponse'}>
      <p className="reponse__texte">Ouvrir la bulle</p>
      <button type="button" className="petit-bouton petit-bouton--plein" onClick={onOuvrir}>
        Ouvrir
      </button>
    </div>
  );
}
