import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cheminBulle } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { libelleModalite, prixIndicatif } from '../../logique/mur';
import { demanderA } from '../../matrix/bulles';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonPrincipal } from '../../ui/BoutonPrincipal';
import { LienRetour } from '../../ui/LienRetour';
import { RondInitiale } from '../../ui/RondInitiale';
import { familleErreur } from '../profil-client/branchements';
import { cheminRetourFiche, etatSucces } from '../mur/navigation-mur';
import { useMoi } from '../mur/useMoi';
import { useMur } from '../mur/useMur';
import './fiche-prestataire.css';

const PAS_DE_RESEAU = 'Pas de connexion. Réessaie dans un instant.';
const PROBLEME = 'Un problème est survenu. Réessaie.';

/** E9 Fiche d'un prestataire : qui il est, ses prix indicatifs, et « Demander ». */
export function FichePrestataire() {
  const { eventId = '' } = useParams();
  const [requete] = useSearchParams();
  const metierOrigine = requete.get('metier');
  const quartier = requete.get('quartier') ?? undefined;
  const navigate = useNavigate();
  const { client, etat } = useMatrix();
  const vue = useMur(client);
  const { moi, userId, chargement } = useMoi();
  const [envoi, setEnvoi] = useState(false);
  const [bandeau, setBandeau] = useState<string | null>(null);

  const retour = cheminRetourFiche(metierOrigine, quartier);
  const statut = vue.statuts.find((s) => s.eventId === eventId && s.fin > vue.maintenant);
  const reseauKo = etat === 'erreur-reseau' || vue.erreur;

  async function demander() {
    if (!client || !moi || !statut || envoi) return;
    setEnvoi(true);
    setBandeau(null);
    let resultat;
    try {
      resultat = await demanderA(client, statut.userId, { pseudo: moi.pseudo, zone: moi.zone });
    } catch (e) {
      setEnvoi(false);
      setBandeau(familleErreur(e) === 'reseau' ? PAS_DE_RESEAU : PROBLEME);
      return;
    }
    // Bulle déjà ouverte avec cette personne : on y va directement.
    if (resultat.reutilisee) navigate(cheminBulle(resultat.roomId));
    else navigate(retour, { state: etatSucces(`Demande envoyée à ${statut.pseudo}`) });
  }

  if (reseauKo || !vue.pret || !statut) {
    let message = 'Chargement…';
    if (reseauKo) message = PAS_DE_RESEAU;
    else if (vue.pret) message = "Cette personne n'est plus disponible.";
    return (
      <main className="ecran fiche">
        <header className="entete-page">
          <LienRetour to={retour} />
        </header>
        {reseauKo ? <Bandeau message={message} /> : <p className="fiche__vide">{message}</p>}
      </main>
    );
  }

  const services = statut.services ?? [];
  const peutDemander = moi?.role === 'client' && statut.userId !== userId;

  return (
    <main className="ecran fiche">
      <header className="entete-page">
        <LienRetour to={retour} />
      </header>
      <div className="fiche__qui">
        <RondInitiale nom={statut.pseudo} />
        <div className="fiche__textes">
          <h1 className="fiche__pseudo">{statut.pseudo}</h1>
          <p className="fiche__dispo">
            <span className="fiche__point" aria-hidden="true" />
            Disponible · {statut.zone}
          </p>
        </div>
      </div>
      <p className="fiche__metier">
        {statut.modalite ? `${statut.metier} · ${libelleModalite(statut.modalite)}` : statut.metier}
      </p>
      {services.length > 0 && (
        <section aria-labelledby="fiche-services">
          <h2 id="fiche-services" className="fiche__section">
            Ses services
          </h2>
          <ul className="fiche__services">
            {services.map((s) => (
              <li key={s.label} className="fiche__service">
                <span>{s.label}</span>
                <span className="fiche__prix">{prixIndicatif(s.prix)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="fiche__bas">
        {bandeau && <Bandeau message={bandeau} />}
        {peutDemander && (
          <>
            <BoutonPrincipal chargement={envoi} onClick={() => void demander()}>
              Demander
            </BoutonPrincipal>
            <p className="fiche__note">Ta demande part à lui seul. Pas de photo, pas de nom.</p>
          </>
        )}
        {!peutDemander && !chargement && moi?.role === 'prestataire' && (
          <p className="fiche__note">Seuls les clients peuvent demander un service.</p>
        )}
      </div>
    </main>
  );
}
