import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHEMINS, cheminBulle } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { trierClients } from '../../logique/clients';
import type { ContactClient } from '../../logique/clients';
import { ecrireA } from '../../matrix/bulles';
import { retirerClientEnregistre } from '../../matrix/clients';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonDeconnexion } from '../../ui/BoutonDeconnexion';
import { RondInitiale } from '../../ui/RondInitiale';
import { IconeRetour } from '../../ui/icones';
import { useMoi } from '../mur/useMoi';
import { familleErreur } from '../profil-client/branchements';
import { useClients } from './useClients';
import './clients.css';

const PAS_DE_RESEAU = 'Pas de connexion. Réessaie dans un instant.';
const PROBLEME = 'Un problème est survenu. Réessaie.';

function messageErreur(e: unknown): string {
  return familleErreur(e) === 'reseau' ? PAS_DE_RESEAU : PROBLEME;
}

type ProprietesLigne = {
  contact: ContactClient;
  /** Un message part vers ce client. */
  envoi: boolean;
  peutEcrire: boolean;
  onEcrire: () => void;
  onRetirer: () => void;
};

function LigneClient({ contact, envoi, peutEcrire, onEcrire, onRetirer }: ProprietesLigne) {
  return (
    <li className="clients__ligne">
      <RondInitiale nom={contact.pseudo} taille="moyen" />
      <div className="clients__textes">
        <span className="clients__pseudo">{contact.pseudo}</span>
        <span className="clients__zone">{contact.zone}</span>
        <div className="clients__actions">
          <button
            type="button"
            className="clients__ecrire"
            aria-label={`Écrire à ${contact.pseudo}`}
            aria-busy={envoi || undefined}
            disabled={!peutEcrire}
            onClick={onEcrire}
          >
            {envoi ? 'Envoi…' : 'Écrire'}
          </button>
          <button
            type="button"
            className="clients__retirer"
            aria-label={`Retirer ${contact.pseudo} de la liste`}
            disabled={envoi}
            onClick={onRetirer}
          >
            Retirer
          </button>
        </div>
      </div>
    </li>
  );
}

/** « Mes clients » : la liste privée du prestataire. « Écrire » propose une bulle au client, qui peut refuser. */
export function MesClients() {
  const navigate = useNavigate();
  const { client } = useMatrix();
  const liste = useClients(client);
  const { moi } = useMoi();
  /** Le client à qui un message est en train de partir. */
  const [envoi, setEnvoi] = useState<string | null>(null);
  /** Clients retirés : ils disparaissent tout de suite, le serveur confirme ensuite (sinon ils reviennent). */
  const [retires, setRetires] = useState<ReadonlySet<string>>(new Set());
  const [bandeau, setBandeau] = useState<string | null>(null);
  // Faux si on a quitté la page pendant l'envoi : on n'y change plus rien.
  const ici = useRef(false);
  useEffect(() => {
    ici.current = true;
    return () => {
      ici.current = false;
    };
  }, []);

  async function ecrire(contact: ContactClient) {
    if (!client || !moi || envoi !== null) return;
    setEnvoi(contact.userId);
    setBandeau(null);
    try {
      const { roomId } = await ecrireA(client, contact.userId, {
        pseudo: moi.pseudo,
        zone: moi.zone,
      });
      if (ici.current) navigate(cheminBulle(roomId));
    } catch (e) {
      if (ici.current) setBandeau(messageErreur(e));
    } finally {
      if (ici.current) setEnvoi(null);
    }
  }

  async function retirer(contact: ContactClient) {
    if (!client) return;
    setBandeau(null);
    setRetires((avant) => new Set(avant).add(contact.userId));
    try {
      await retirerClientEnregistre(client, contact.userId);
    } catch (e) {
      setRetires((avant) => {
        const reste = new Set(avant);
        reste.delete(contact.userId);
        return reste;
      });
      setBandeau(messageErreur(e));
    }
  }

  const affiches = liste ? trierClients(liste.filter((c) => !retires.has(c.userId))) : null;
  let contenu;
  if (!affiches) contenu = <p className="clients__vide">Chargement…</p>;
  else if (affiches.length === 0) {
    contenu = (
      <p className="clients__vide">
        Aucun client enregistré. Dans une bulle, touche « Enregistrer ce client ».
      </p>
    );
  } else {
    contenu = (
      <ul className="clients__liste">
        {affiches.map((c) => (
          <LigneClient
            key={c.userId}
            contact={c}
            envoi={envoi === c.userId}
            peutEcrire={moi !== null && envoi === null}
            onEcrire={() => void ecrire(c)}
            onRetirer={() => void retirer(c)}
          />
        ))}
      </ul>
    );
  }

  return (
    <main className="ecran clients">
      <button
        type="button"
        className="retour"
        aria-label="Retour"
        onClick={() => navigate(CHEMINS.mur)}
      >
        <IconeRetour />
      </button>
      <h1 className="clients__titre">Mes clients</h1>
      <p className="clients__rappel">
        Une liste rien que pour toi. Chacun peut refuser de discuter.
      </p>
      {bandeau && <Bandeau message={bandeau} />}
      {contenu}
      <BoutonDeconnexion />
    </main>
  );
}
