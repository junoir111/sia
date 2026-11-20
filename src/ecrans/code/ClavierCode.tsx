import { useEffect } from 'react';
import { IconeEffacer } from '../../ui/icones';

const CHIFFRES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const UN_CHIFFRE = /^[0-9]$/;

type Proprietes = {
  /** Plus rien ne s'écrit (attente, fenêtre ouverte). */
  desactive: boolean;
  /** Il y a un chiffre à effacer. */
  effacable: boolean;
  onChiffre: (chiffre: string) => void;
  onEffacer: () => void;
};

/** Clavier de 0 à 9 et « effacer » ; marche aussi avec le clavier de l'ordinateur (aperçu, version web). */
export function ClavierCode({ desactive, effacable, onChiffre, onEffacer }: Proprietes) {
  useEffect(() => {
    if (desactive) return;
    function touche(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (UN_CHIFFRE.test(e.key)) onChiffre(e.key);
      else if (e.key === 'Backspace') onEffacer();
    }
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [desactive, onChiffre, onEffacer]);

  return (
    <div className="code__clavier" role="group" aria-label="Clavier de chiffres">
      {CHIFFRES.map((chiffre) => (
        <button
          key={chiffre}
          type="button"
          className="code__touche"
          disabled={desactive}
          onClick={() => onChiffre(chiffre)}
        >
          {chiffre}
        </button>
      ))}
      <span aria-hidden="true" />
      <button
        type="button"
        className="code__touche"
        disabled={desactive}
        onClick={() => onChiffre('0')}
      >
        0
      </button>
      <button
        type="button"
        className="code__touche code__touche--effacer"
        aria-label="Effacer"
        disabled={desactive || !effacable}
        onClick={onEffacer}
      >
        <IconeEffacer />
      </button>
    </div>
  );
}
