import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHEMINS, cheminBulle } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { formaterPrix } from '../../logique/profil';
import { accepterOffre, refuserOffre } from '../../matrix/bulles';
import type { ResumeBulle } from '../../matrix/bulles';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonDeconnexion } from '../../ui/BoutonDeconnexion';
import { IndicateurMiseAJour } from '../../ui/IndicateurMiseAJour';
import { ReponseOuiNon } from '../../ui/ReponseOuiNon';
import { RondInitiale } from '../../ui/RondInitiale';
import { IconeHorloge, IconeRetour } from '../../ui/icones';
import { useGlisse } from '../../ui/useGlisse';
import {
  commencerReponse,
  enFile,
  finirReponse,
  messageEchec,
  rater,
  reponseParties,
  useReponse,
} from '../bandeau/reponses';
import { useRattrapage } from '../mur/useRattrapage';
import { familleErreur } from '../profil-client/branchements';
import { useBulles } from './useBulles';
import './bulles.css';

const PAS_DE_RESEAU = 'Pas de connexion. Réessaie dans un instant.';

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
  onToucher: () => void;
  onRepondre: (oui: boolean) => void;
};

function LigneBulle({ bulle, ouverte, onToucher, onRepondre }: ProprietesLigne) {
  const reponse = useReponse(bulle.roomId);
  // Réponse confirmée : la ligne s'en va (la liste se met à jour toute seule juste après).
  if (reponse === 'fait') return null;
  const etat = etatLigne(bulle);
  const nonLus = bulle.nonLus > 0 ? `, ${bulle.nonLus} non lu${bulle.nonLus > 1 ? 's' : ''}` : '';
  const invitation = bulle.etat === 'invitation-recue';
  // La question reste là tant qu'une réponse est partie (même donnée depuis le bandeau).
  const choix = invitation && (ouverte || reponse !== 'repos');
  return (
    <li className="bulles__ligne" data-glisse={bulle.roomId}>
      <button
        type="button"
        className="bulles__toucher"
        aria-expanded={invitation ? choix : undefined}
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
      {choix && (
        <ReponseOuiNon
          className="bulles__choix"
          question="Tu veux discuter ?"
          envoi={reponseParties(reponse)}
          erreur={messageEchec(reponse)}
          onOui={() => onRepondre(true)}
          onNon={() => onRepondre(false)}
        />
      )}
    </li>
  );
}

/** M3 Liste des bulles. */
export function Bulles() {
  const navigate = useNavigate();
  const { client, etat } = useMatrix();
  const bulles = useBulles(client);
  const rattrape = useRattrapage(client);
  const liste = useGlisse<HTMLUListElement>();
  const [choix, setChoix] = useState<string | null>(null);

  function retour() {
    // « Mon compte » vient du Mur : la flèche y ramène toujours (jamais d'impasse).
    navigate(CHEMINS.mur);
  }

  function toucher(b: ResumeBulle) {
    if (b.etat === 'invitation-recue') setChoix((avant) => (avant === b.roomId ? null : b.roomId));
    else navigate(cheminBulle(b.roomId));
  }

  /** La ligne change d'état au toucher ; le serveur confirme ensuite (ou refuse : la ligne le dit). */
  async function repondre(roomId: string, oui: boolean) {
    if (!client || !commencerReponse(roomId)) return;
    try {
      if (oui) await enFile(() => accepterOffre(client, roomId));
      else await refuserOffre(client, roomId);
    } catch (e) {
      rater(roomId, familleErreur(e) === 'reseau' ? 'reseau' : 'probleme');
      return;
    }
    // Oui : on entre dans la bulle sans que la ligne disparaisse avant (pas de clignotement).
    if (oui) navigate(cheminBulle(roomId));
    finirReponse(roomId);
    setChoix(null);
  }

  let contenu;
  if (etat === 'erreur-reseau') contenu = <Bandeau message={PAS_DE_RESEAU} />;
  else if (!bulles) contenu = <p className="bulles__vide">Chargement…</p>;
  else if (bulles.length === 0)
    contenu = <p className="bulles__vide">Aucune bulle pour l'instant.</p>;
  else
    contenu = (
      <ul className="bulles__liste" ref={liste}>
        {bulles.map((b) => (
          <LigneBulle
            key={b.roomId}
            bulle={b}
            ouverte={choix === b.roomId}
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
      <div className="bulles__entete">
        <h1 className="bulles__titre">Bulles</h1>
        <IndicateurMiseAJour actif={rattrape} />
      </div>
      <p className="bulles__rappel">
        <IconeHorloge className="bulles__horloge" />
        Les messages s'effacent après 1 minute.
      </p>
      {contenu}
      <BoutonDeconnexion />
    </main>
  );
}
