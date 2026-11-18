import { Link } from 'react-router-dom';
import type { TuileMur } from '../logique/mur';

/** Case de la grille du Mur : métier et nombre de prestataires disponibles. */
export function TuileMetier({ tuile, to }: { tuile: TuileMur; to: string }) {
  const { metier, dispo } = tuile;
  return (
    <Link className="tuile" to={to}>
      <span className="tuile__nom">{metier}</span>
      <span className="tuile__ligne tuile__ligne--dispo">
        <span className="tuile__point" aria-hidden="true" />
        {dispo} dispo
      </span>
    </Link>
  );
}
