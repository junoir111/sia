import { IconeCoche } from './icones';

type Proprietes = {
  libelle: string;
  choisie: boolean;
  onChange: (choisie: boolean) => void;
};

/** Pastille ronde de 48 px qu'on allume ou éteint ; une coche verte quand elle est choisie. */
export function PastilleChoix({ libelle, choisie, onChange }: Proprietes) {
  return (
    <button
      type="button"
      className="pastille"
      aria-pressed={choisie}
      onClick={() => onChange(!choisie)}
    >
      {choisie && <IconeCoche className="pastille__coche" taille={18} />}
      {libelle}
    </button>
  );
}
