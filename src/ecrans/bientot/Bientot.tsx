import { Link } from 'react-router-dom';
import { CHEMINS } from '../../chemins';

/** Écran provisoire pour les écrans pas encore faits. */
export function Bientot() {
  return (
    <main>
      <p>Bientôt disponible</p>
      <Link to={CHEMINS.accueil}>Retour à l'accueil</Link>
    </main>
  );
}
