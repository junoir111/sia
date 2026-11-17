import { useId } from 'react';
import { IconeCoche } from './icones';
import { MessageErreur } from './MessageErreur';

type Proprietes = {
  libelle: string;
  cochee: boolean;
  onChange: (cochee: boolean) => void;
  erreur?: string;
};

/** Case à cocher : toute la rangée (48 px) se touche. */
export function CaseACocher({ libelle, cochee, onChange, erreur }: Proprietes) {
  const id = useId();
  const idErreur = `${id}-erreur`;
  return (
    <div>
      <label className="case" htmlFor={id}>
        <input
          id={id}
          className="case__saisie"
          type="checkbox"
          checked={cochee}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? idErreur : undefined}
        />
        <span className="case__boite" aria-hidden="true">
          <IconeCoche className="case__coche" />
        </span>
        <span>{libelle}</span>
      </label>
      {erreur && <MessageErreur id={idErreur} message={erreur} />}
    </div>
  );
}
