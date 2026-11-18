import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CHEMINS, cheminFicheDemande, cheminFichePrestataire, cheminMur } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { libelleModalite, listeMetier } from '../../logique/mur';
import { formaterPrix } from '../../logique/profil';
import { Bandeau } from '../../ui/Bandeau';
import { BandeauSucces } from '../../ui/BandeauSucces';
import { CarteAnnonce } from '../../ui/CarteAnnonce';
import { CartePrestataire } from '../../ui/CartePrestataire';
import { LienRetour } from '../../ui/LienRetour';
import { ilYa, lireSucces } from '../mur/navigation-mur';
import { useMoi } from '../mur/useMoi';
import { useMur } from '../mur/useMur';
import './liste-metier.css';

const PAS_DE_RESEAU = 'Pas de connexion. Réessaie dans un instant.';

/** E8 Liste d'un métier : personnes disponibles, puis demandes de clients. */
export function ListeMetier() {
  const { metier = '' } = useParams();
  const [requete] = useSearchParams();
  const quartier = requete.get('quartier') ?? undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const { client, etat } = useMatrix();
  const vue = useMur(client);
  const { moi } = useMoi();
  const [succes] = useState(() => lireSucces(location.state));

  // Le message ne sert qu'une fois : il s'efface de l'état de navigation (pas de retour avec le message).
  useEffect(() => {
    if (lireSucces(location.state)) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate]);

  const { prestataires, demandes } = listeMetier(
    vue.statuts,
    vue.demandes,
    metier,
    quartier,
    vue.maintenant,
  );
  const titre = [metier, quartier].filter(Boolean).join(' · ');
  const reseauKo = etat === 'erreur-reseau' || vue.erreur;
  const peutRepondre = moi?.role === 'prestataire';

  let contenu;
  if (reseauKo) contenu = <Bandeau message={PAS_DE_RESEAU} />;
  else if (!vue.pret) contenu = <p className="liste__vide">Chargement…</p>;
  else if (prestataires.length === 0 && demandes.length === 0) {
    contenu = <p className="liste__vide">Personne pour l'instant. Reviens un peu plus tard.</p>;
  } else {
    contenu = (
      <>
        {prestataires.length > 0 && (
          <section aria-labelledby="liste-dispos">
            <h2 id="liste-dispos" className="liste__section">
              Disponibles maintenant · {prestataires.length}
            </h2>
            <ul className="liste__cartes">
              {prestataires.map((p) => (
                <li key={p.eventId}>
                  <CartePrestataire
                    pseudo={p.pseudo}
                    info={p.modalite ? `${p.zone} · ${libelleModalite(p.modalite)}` : p.zone}
                    to={cheminFichePrestataire(p.eventId, metier, quartier)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        {demandes.length > 0 && (
          <section aria-labelledby="liste-demandes">
            <h2 id="liste-demandes" className="liste__section">
              {demandes.length === 1
                ? 'Demande de client · 1'
                : `Demandes de clients · ${demandes.length}`}
            </h2>
            <ul className="liste__cartes">
              {demandes.map((d) => (
                <li key={d.eventId}>
                  <CarteAnnonce
                    pseudo={d.pseudo}
                    quand={ilYa(d.creeLe, vue.maintenant)}
                    resume={`${d.zone} · ${formaterPrix(d.budget)} FCFA · ${d.service}`}
                    texte={d.texte || undefined}
                    avecAction={peutRepondre}
                    to={cheminFicheDemande(d.eventId, metier, quartier)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <main className="ecran liste">
      <header className="entete-page">
        <LienRetour to={cheminMur(quartier)} />
        <h1 className="entete-page__titre">{titre}</h1>
      </header>
      {succes && (
        <BandeauSucces message={succes}>
          <Link className="bandeau-succes__lien" to={CHEMINS.bulles}>
            Voir mes bulles
          </Link>
        </BandeauSucces>
      )}
      {contenu}
    </main>
  );
}
