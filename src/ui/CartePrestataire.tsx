import { Link } from 'react-router-dom';
import { RondInitiale } from './RondInitiale';

type Proprietes = { pseudo: string; info: string; to: string };

/** Ligne d'une personne disponible : initiale, pseudo, quartier, point vert. */
export function CartePrestataire({ pseudo, info, to }: Proprietes) {
  return (
    <Link className="carte-ligne" to={to} aria-label={`${pseudo}, ${info}, disponible`}>
      <RondInitiale nom={pseudo} taille="petit" />
      <span className="carte-ligne__textes" aria-hidden="true">
        <span className="carte-ligne__pseudo">{pseudo}</span>
        <span className="carte-ligne__info">{info}</span>
      </span>
      <span className="carte-ligne__point" aria-hidden="true" />
    </Link>
  );
}
