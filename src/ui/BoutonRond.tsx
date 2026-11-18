import { Link } from 'react-router-dom';
import { IconePlus } from './icones';

type Proprietes = {
  to: string;
  /** Lu par le lecteur d'écran quand le bouton est un « + » sans texte. */
  libelle: string;
  /** Texte visible : le bouton devient une gélule au lieu d'un rond. */
  texte?: string;
};

/** Bouton accent fixé en bas à droite, au-dessus de la barre Android : « + » ou texte court. */
export function BoutonRond({ to, libelle, texte }: Proprietes) {
  return (
    <Link
      to={to}
      className={texte ? 'rond-flottant rond-flottant--texte' : 'rond-flottant'}
      aria-label={texte ? undefined : libelle}
    >
      {texte ?? <IconePlus />}
    </Link>
  );
}
