import { Link } from 'react-router-dom';
import { CHEMINS } from '../chemins';
import { IconeBulles } from './icones';

/** Petit accès aux bulles, en haut à droite (E5, E6). `nouveautes` : messages non lus + offres reçues. */
export function AccesBulles({ nouveautes }: { nouveautes: number }) {
  const libelle =
    nouveautes > 0 ? `Bulles, ${nouveautes} nouveau${nouveautes > 1 ? 'x' : ''}` : 'Bulles';
  return (
    <Link className="acces-bulles" to={CHEMINS.bulles} aria-label={libelle}>
      <IconeBulles />
      {nouveautes > 0 && (
        <span className="acces-bulles__badge" aria-hidden="true">
          {nouveautes > 9 ? '9+' : nouveautes}
        </span>
      )}
    </Link>
  );
}
