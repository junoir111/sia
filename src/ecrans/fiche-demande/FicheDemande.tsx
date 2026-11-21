import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cheminBulle } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { formaterPrix } from '../../logique/profil';
import { direOui } from '../../matrix/bulles';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonPrincipal } from '../../ui/BoutonPrincipal';
import { LienRetour } from '../../ui/LienRetour';
import { RondInitiale } from '../../ui/RondInitiale';
import { familleErreur } from '../profil-client/branchements';
import { cheminRetourFiche, etatSucces, ilYa } from '../mur/navigation-mur';
import { useMoi } from '../mur/useMoi';
import { useMur } from '../mur/useMur';
import '../fiche-prestataire/fiche-prestataire.css';

const PAS_DE_RESEAU = 'Pas de réseau. Réessaie dans un instant.';
const PROBLEME = 'Ça n’a pas marché. Réessaie.';

/** E9 bis Fiche d'une demande (vue d'un prestataire) : le détail, et « D'accord ? ». */
export function FicheDemande() {
  const { eventId = '' } = useParams();
  const [requete] = useSearchParams();
  const metierOrigine = requete.get('metier');
  const quartier = requete.get('quartier') ?? undefined;
  const navigate = useNavigate();
  const { client, etat } = useMatrix();
  const vue = useMur(client);
  const { moi, userId } = useMoi();
  const [envoi, setEnvoi] = useState(false);
  const [bandeau, setBandeau] = useState<string | null>(null);
  // Faux si on a quitté la fiche pendant l'envoi : on ne ramène alors personne en arrière.
  const ici = useRef(false);
  useEffect(() => {
    ici.current = true;
    return () => {
      ici.current = false;
    };
  }, []);

  const retour = cheminRetourFiche(metierOrigine, quartier);
  const demande = vue.demandes.find((d) => d.eventId === eventId && d.fin > vue.maintenant);
  const reseauKo = etat === 'erreur-reseau' || vue.erreur;

  /** Le bouton dit « Réponse envoyée… » au toucher ; le serveur confirme ensuite (sinon : message, bouton rendu). */
  async function dAccord() {
    if (!client || !moi || !demande || envoi) return;
    setEnvoi(true);
    setBandeau(null);
    const { pseudo, service, zone, texte, budget, fin } = demande;
    let resultat;
    try {
      resultat = await direOui(
        client,
        { pseudo, service, zone, texte, budget, fin },
        demande.eventId,
        { pseudo: moi.pseudo, zone: moi.zone },
      );
    } catch (e) {
      setEnvoi(false);
      setBandeau(familleErreur(e) === 'reseau' ? PAS_DE_RESEAU : PROBLEME);
      return;
    }
    if (!ici.current) return;
    // Bulle déjà ouverte avec ce client : on y va directement.
    if (resultat.reutilisee) navigate(cheminBulle(resultat.roomId));
    else navigate(retour, { state: etatSucces(`Réponse envoyée à ${pseudo}`) });
  }

  if (reseauKo || !vue.pret || !demande) {
    let message = 'Chargement…';
    if (vue.pret) message = "Cette demande n'est plus là.";
    return (
      <main className="ecran fiche">
        <header className="entete-page">
          <LienRetour to={retour} />
        </header>
        {reseauKo ? <Bandeau message={PAS_DE_RESEAU} /> : <p className="fiche__vide">{message}</p>}
      </main>
    );
  }

  const peutRepondre = moi?.role === 'prestataire' && demande.userId !== userId;

  return (
    <main className="ecran fiche">
      <header className="entete-page">
        <LienRetour to={retour} />
      </header>
      <div className="fiche__qui">
        <RondInitiale nom={demande.pseudo} />
        <div className="fiche__textes">
          <h1 className="fiche__pseudo">{demande.pseudo}</h1>
          <p className="fiche__metier fiche__metier--serre">
            Client · {ilYa(demande.creeLe, vue.maintenant)}
          </p>
        </div>
      </div>
      <p className="fiche__resume">
        {demande.zone} · {formaterPrix(demande.budget)} FCFA · {demande.service}
      </p>
      {demande.texte && <p className="fiche__texte">{demande.texte}</p>}
      <div className="fiche__bas">
        {bandeau && <Bandeau message={bandeau} />}
        {peutRepondre && (
          <>
            <BoutonPrincipal
              envoye={envoi ? 'Réponse envoyée…' : undefined}
              onClick={() => void dAccord()}
            >
              D'accord ?
            </BoutonPrincipal>
            <p className="fiche__note">Ta réponse part à ce client seul. Il choisit ensuite.</p>
          </>
        )}
      </div>
    </main>
  );
}
