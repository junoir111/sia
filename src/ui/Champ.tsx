import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { IconeOeil, IconeOeilBarre } from './icones';
import { MessageErreur } from './MessageErreur';

type Proprietes = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
  libelle: string;
  valeur: string;
  onChange: (valeur: string) => void;
  /** Petite phrase d'aide sous le champ (cachée quand il y a une erreur). */
  aide?: string;
  /** Message rouge sous le champ : bord rouge et icône. */
  erreur?: string;
  /** Mot de passe : texte caché, avec un œil pour l'afficher. */
  secret?: boolean;
};

/** Champ de saisie : libellé au-dessus, aide ou erreur en dessous. */
export function Champ({
  libelle,
  valeur,
  onChange,
  aide,
  erreur,
  secret = false,
  id,
  ...reste
}: Proprietes) {
  const idAuto = useId();
  const idChamp = id ?? idAuto;
  const idSousTexte = `${idChamp}-sous-texte`;
  const [visible, setVisible] = useState(false);
  const sousTexte = erreur ?? aide;

  return (
    <div className="champ">
      <label className="champ__libelle" htmlFor={idChamp}>
        {libelle}
      </label>
      <div className="champ__cadre">
        <input
          {...reste}
          id={idChamp}
          className={secret ? 'champ__saisie champ__saisie--oeil' : 'champ__saisie'}
          type={secret && !visible ? 'password' : 'text'}
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={sousTexte ? idSousTexte : undefined}
        />
        {secret && (
          <button
            type="button"
            className="champ__oeil"
            aria-label={visible ? 'Cacher le mot de passe' : 'Afficher le mot de passe'}
            aria-controls={idChamp}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <IconeOeilBarre /> : <IconeOeil />}
          </button>
        )}
      </div>
      {erreur ? (
        <MessageErreur id={idSousTexte} message={erreur} />
      ) : (
        aide && (
          <p id={idSousTexte} className="champ__aide">
            {aide}
          </p>
        )
      )}
    </div>
  );
}
