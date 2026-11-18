import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHEMINS, cheminBulle } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { formaterPrix } from '../../logique/profil';
import { accepterOffre, refuserOffre } from '../../matrix/bulles';
import type { ResumeBulle } from '../../matrix/bulles';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonDeconnexion } from '../../ui/BoutonDeconnexion';
import { RondInitiale } from '../../ui/RondInitiale';
import { IconeHorloge, IconeRetour } from '../../ui/icones';
import { familleErreur } from '../profil-client/branchements';
import { useBulles } from './useBulles';
import './bulles.css';

const PAS_DE_RESEAU = 'Pas de connexion. Réessaie dans un instant.';
const PROBLEME = 'Un problème est survenu. Réessaie.';

/** Petit texte d'état à droite de la ligne, et sa couleur. */
function etatLigne(b: ResumeBulle): { texte: string; vif: boolean } {
  if (b.etat === 'invitation-recue') {
    return { texte: b.invitationDirecte ? 'vous demande' : 'dit oui', vif: true };
  }
  if (b.etat === 'en-attente') return { texte: 'en attente', vif: false };
  if (b.etat === 'fermee') return { texte: 'fermée', vif: false };
  return b.autreEcrit ? { texte: "en train d'écrire…", vif: true } : { texte: '', vif: false };
}

function sousTitre(b: ResumeBulle): string {
  if (!b.demande) return b.autre.zone;
  return `${b.demande.zone} · ${formaterPrix(b.demande.budget)} FCFA`;
}

type ProprietesLigne = {
  bulle: ResumeBulle;
  ouverte: boolean;
  occupee: boolean;
  onToucher: () => void;
  onRepondre: (oui: boolean) => void;
};

function LigneBulle({ bulle, ouverte, occupee, onToucher, onRepondre }: ProprietesLigne) {
  const etat = etatLigne(bulle);
  const nonLus = bulle.nonLus > 0 ? `, ${bulle.nonLus} non lu${bulle.nonLus > 1 ? 's' : ''}` : '';
  return (
    <li className="bulles__ligne">
      <button
        type="button"
        className="bulles__toucher"
        aria-expanded={bulle.etat === 'invitation-recue' ? ouverte : undefined}
        aria-label={`${bulle.autre.pseudo}, ${sousTitre(bulle)}${etat.texte ? `, ${etat.texte}` : ''}${nonLus}`}
        onClick={onToucher}
      >
        <RondInitiale nom={bulle.autre.pseudo} taille="moyen" />
        <span className="bulles__textes" aria-hidden="true">
          <span className="bulles__haut">
            <span className="bulles__pseudo">{bulle.autre.pseudo}</span>
            {etat.texte && (
              <span className={etat.vif ? 'bulles__etat bulles__etat--vif' : 'bulles__etat'}>
                {etat.texte}
              </span>
            )}
          </span>
          <span className="bulles__bas">
            <span className="bulles__info">{sousTitre(bulle)}</span>
            {bulle.nonLus > 0 && <span className="badge">{bulle.nonLus}</span>}
          </span>
        </span>
      </button>
      {ouverte && (
        <div className="bulles__choix">
          <span className="bulles__question">Tu veux discuter ?</span>
          <button
            type="button"
            className="petit-bouton"
            disabled={occupee}
            onClick={() => onRepondre(false)}
          >
            Non
          </button>
          <button
            type="button"
            className="petit-bouton petit-bouton--plein"
            disabled={occupee}
            aria-busy={occupee || undefined}
            onClick={() => onRepondre(true)}
          >
            Oui
          </button>
        </div>
      )}
    </li>
  );
}

/** M3 Liste des bulles. */
export function Bulles() {
  const navigate = useNavigate();
  const { client, etat } = useMatrix();
  const bulles = useBulles(client);
  const [choix, setChoix] = useState<string | null>(null);
  const [occupee, setOccupee] = useState(false);
  const [bandeau, setBandeau] = useState<string | null>(null);

  function retour() {
    // « Mon compte » vient du Mur : la flèche y ramène toujours (jamais d'impasse).
    navigate(CHEMINS.mur);
  }

  function toucher(b: ResumeBulle) {
    if (b.etat === 'invitation-recue') setChoix((avant) => (avant === b.roomId ? null : b.roomId));
    else navigate(cheminBulle(b.roomId));
  }

  async function repondre(roomId: string, oui: boolean) {
    if (!client || occupee) return;
    setOccupee(true);
    setBandeau(null);
    try {
      if (oui) await accepterOffre(client, roomId);
      else await refuserOffre(client, roomId);
      setChoix(null);
      if (oui) navigate(cheminBulle(roomId));
    } catch (e) {
      setBandeau(familleErreur(e) === 'reseau' ? PAS_DE_RESEAU : PROBLEME);
    } finally {
      setOccupee(false);
    }
  }

  let contenu;
  if (etat === 'erreur-reseau') contenu = <Bandeau message={PAS_DE_RESEAU} />;
  else if (!bulles) contenu = <p className="bulles__vide">Chargement…</p>;
  else if (bulles.length === 0)
    contenu = <p className="bulles__vide">Aucune bulle pour l'instant.</p>;
  else
    contenu = (
      <ul className="bulles__liste">
        {bulles.map((b) => (
          <LigneBulle
            key={b.roomId}
            bulle={b}
            ouverte={choix === b.roomId && b.etat === 'invitation-recue'}
            occupee={occupee}
            onToucher={() => toucher(b)}
            onRepondre={(oui) => void repondre(b.roomId, oui)}
          />
        ))}
      </ul>
    );

  return (
    <main className="ecran bulles">
      <button type="button" className="retour" aria-label="Retour" onClick={retour}>
        <IconeRetour />
      </button>
      <h1 className="bulles__titre">Bulles</h1>
      <p className="bulles__rappel">
        <IconeHorloge className="bulles__horloge" />
        Les messages s'effacent après 1 minute.
      </p>
      {bandeau && <Bandeau message={bandeau} />}
      {contenu}
      <BoutonDeconnexion />
    </main>
  );
}
