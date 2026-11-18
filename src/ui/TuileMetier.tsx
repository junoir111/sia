import { Link } from 'react-router-dom';
import type { TuileMur } from '../logique/mur';

function texteDemandes(n: number): string {
  if (n === 0) return 'aucune demande';
  return n === 1 ? '1 demande' : `${n} demandes`;
}

/** Case de la grille du Mur : métier, personnes disponibles et demandes de clients. */
export function TuileMetier({ tuile, to }: { tuile: TuileMur; to: string }) {
  const { metier, dispo, demandes, vide } = tuile;
  return (
    <Link className={vide ? 'tuile tuile--vide' : 'tuile'} to={to}>
      <span className="tuile__nom">{metier}</span>
      {vide ? (
        <span className="tuile__ligne tuile__ligne--rien">personne ici</span>
      ) : (
        <>
          {dispo > 0 ? (
            <span className="tuile__ligne tuile__ligne--dispo">
              <span className="tuile__point" aria-hidden="true" />
              {dispo} dispo
            </span>
          ) : (
            <span className="tuile__ligne">
              <span className="tuile__point tuile__point--gris" aria-hidden="true" />
              personne
            </span>
          )}
          <span className="tuile__ligne">{texteDemandes(demandes)}</span>
        </>
      )}
    </Link>
  );
}
