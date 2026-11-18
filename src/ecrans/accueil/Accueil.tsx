import { Navigate, useNavigate } from 'react-router-dom';
import { CHEMINS } from '../../chemins';
import { lireSession } from '../../matrix/session';
import { BoutonPrincipal } from '../../ui/BoutonPrincipal';
import { BoutonSecondaire } from '../../ui/BoutonSecondaire';
import './accueil.css';

/** E1 Accueil : le nom SIA, une phrase, deux boutons en bas. */
export function Accueil() {
  const navigate = useNavigate();
  // Déjà connecté (appli rouverte) : droit au Mur.
  if (lireSession()) return <Navigate to={CHEMINS.mur} replace />;
  return (
    <main className="ecran accueil">
      <div className="accueil__centre">
        <h1 className="accueil__nom">
          <span className="accueil__lettres">SIA</span>
          <span className="accueil__point" aria-hidden="true" />
        </h1>
        <p className="accueil__phrase">
          Des services près de chez toi,
          <br />
          en toute discrétion.
        </p>
      </div>
      <div className="accueil__actions">
        <BoutonPrincipal onClick={() => navigate(CHEMINS.inscription)}>
          Créer mon compte
        </BoutonPrincipal>
        <BoutonSecondaire onClick={() => navigate(CHEMINS.connexion)}>
          J'ai déjà un compte
        </BoutonSecondaire>
        <p className="accueil__note">Sur invitation seulement.</p>
      </div>
    </main>
  );
}
