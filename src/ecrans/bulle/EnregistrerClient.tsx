import { useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { Link } from 'react-router-dom';
import { CHEMINS } from '../../chemins';
import { autreDeBulle } from '../../matrix/bulles';
import { clientEnregistre, enregistrerClient } from '../../matrix/clients';
import { IconeCoche } from '../../ui/icones';
import { useClients } from '../clients/useClients';
import { useMoi } from '../mur/useMoi';
import { familleErreur } from '../profil-client/branchements';

const PAS_DE_RESEAU = 'Pas de connexion. Réessaie dans un instant.';
const PROBLEME = 'Un problème est survenu. Réessaie.';

type Proprietes = { client: MatrixClient; roomId: string };

function BoutonEnregistrer({ client, roomId }: Proprietes) {
  // Se redessine quand la liste change (la synchro apporte l'enregistrement).
  useClients(client);
  /** Enregistré tout de suite ; le serveur confirme ensuite (sinon le bouton revient avec un message). */
  const [fait, setFait] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // L'autre n'a pas (encore) accepté de discuter : rien à enregistrer.
  if (autreDeBulle(client, roomId) === null) return null;

  if (fait || clientEnregistre(client, roomId)) {
    return (
      <p className="bulle__client bulle__client--ok" role="status">
        <IconeCoche />
        <span>Client enregistré · </span>
        <Link to={CHEMINS.clients}>Mes clients</Link>
      </p>
    );
  }

  function enregistrer() {
    setFait(true);
    setMessage(null);
    enregistrerClient(client, roomId).catch((e: unknown) => {
      setFait(false);
      setMessage(familleErreur(e) === 'reseau' ? PAS_DE_RESEAU : PROBLEME);
    });
  }

  return (
    <div className="bulle__client">
      <button type="button" className="bulle__enregistrer" onClick={enregistrer}>
        Enregistrer ce client
      </button>
      {message && (
        <p className="bulle__client-erreur" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Prestataire : dans une bulle où l'autre a accepté de discuter, « Enregistrer ce client » le range dans
 * « Mes clients » (liste privée), pour pouvoir lui écrire plus tard. Rien pour un client.
 */
export function EnregistrerClient({ client, roomId }: Proprietes) {
  const { moi } = useMoi();
  return moi?.role === 'prestataire' ? <BoutonEnregistrer client={client} roomId={roomId} /> : null;
}
