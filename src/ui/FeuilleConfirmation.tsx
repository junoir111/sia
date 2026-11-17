import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';

type Proprietes = {
  titre: string;
  texte: string;
  /** Libellé du bouton rouge qui confirme. */
  confirmer: string;
  chargement?: boolean;
  /** Message d'échec affiché dans le panneau. */
  erreur?: string | null;
  onConfirmer: () => void;
  onAnnuler: () => void;
};

/** Panneau qui monte du bas pour confirmer une action qui ne se défait pas (brief §5). */
export function FeuilleConfirmation({
  titre,
  texte,
  confirmer,
  chargement = false,
  erreur,
  onConfirmer,
  onAnnuler,
}: Proprietes) {
  const idTitre = useId();
  const annuler = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    annuler.current?.focus();
  }, []);

  function clavier(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && !chargement) onAnnuler();
  }

  return (
    <div className="feuille" onKeyDown={clavier}>
      <div
        className="feuille__voile"
        aria-hidden="true"
        onClick={chargement ? undefined : onAnnuler}
      />
      <div className="feuille__panneau" role="dialog" aria-modal="true" aria-labelledby={idTitre}>
        <h2 id={idTitre} className="feuille__titre">
          {titre}
        </h2>
        <p className="feuille__texte">{texte}</p>
        {erreur && (
          <p className="feuille__erreur" role="alert">
            {erreur}
          </p>
        )}
        <div className="feuille__actions">
          <button
            type="button"
            className="bouton bouton--alerte"
            disabled={chargement}
            aria-busy={chargement || undefined}
            onClick={onConfirmer}
          >
            {chargement ? 'Effacement…' : confirmer}
          </button>
          <button
            ref={annuler}
            type="button"
            className="bouton bouton--secondaire"
            disabled={chargement}
            onClick={onAnnuler}
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
