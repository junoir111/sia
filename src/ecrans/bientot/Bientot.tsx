import { Link } from 'react-router-dom';
import { CHEMINS } from '../../chemins';
import { LienRetour } from '../../ui/LienRetour';

/** Écran provisoire pour les écrans pas encore faits. */
export function Bientot() {
  return (
    <main className="ecran">
      <LienRetour to={CHEMINS.mur} />
      <p>Bientôt disponible</p>
      <Link to={CHEMINS.accueil}>Retour à l'accueil</Link>
    </main>
  );
}
