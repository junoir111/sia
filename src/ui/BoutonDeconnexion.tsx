import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHEMINS } from '../chemins';
import { deconnecter } from '../matrix/auth';
import { lireSession } from '../matrix/session';
import { BoutonSecondaire } from './BoutonSecondaire';
import { FeuilleConfirmation } from './FeuilleConfirmation';

/** Bouton discret « Se déconnecter » + confirmation ; efface ce téléphone puis retourne à l'accueil. */
export function BoutonDeconnexion() {
  const navigate = useNavigate();
  const [ouverte, setOuverte] = useState(false);
  const [enCours, setEnCours] = useState(false);

  async function confirmer() {
    setEnCours(true);
    const session = lireSession();
    if (session) await deconnecter(session);
    navigate(CHEMINS.accueil, { replace: true });
  }

  return (
    <div className="deconnexion">
      <BoutonSecondaire className="deconnexion__bouton" onClick={() => setOuverte(true)}>
        Se déconnecter
      </BoutonSecondaire>
      {ouverte && (
        <FeuilleConfirmation
          titre="Te déconnecter ?"
          texte="Tes bulles en cours seront fermées sur ce téléphone."
          confirmer="Se déconnecter"
          chargement={enCours}
          onConfirmer={() => void confirmer()}
          onAnnuler={() => setOuverte(false)}
        />
      )}
    </div>
  );
}
