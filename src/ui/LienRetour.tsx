import { Link } from 'react-router-dom';
import { IconeRetour } from './icones';

/** Flèche retour en haut à gauche (zone de 48 px) : jamais d'impasse. */
export function LienRetour({ to }: { to: string }) {
  return (
    <Link className="retour" to={to} aria-label="Retour">
      <IconeRetour />
    </Link>
  );
}
