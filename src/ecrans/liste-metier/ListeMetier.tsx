import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CHEMINS, cheminFichePrestataire, cheminMur } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { libelleModalite, listeMetier } from '../../logique/mur';
import { Bandeau } from '../../ui/Bandeau';
import { BandeauSucces } from '../../ui/BandeauSucces';
import { CartePrestataire } from '../../ui/CartePrestataire';
import { IndicateurMiseAJour } from '../../ui/IndicateurMiseAJour';
import { LienRetour } from '../../ui/LienRetour';
import { useGlisse } from '../../ui/useGlisse';
import { lireSucces } from '../mur/navigation-mur';
import { useMur } from '../mur/useMur';
import { useRattrapage } from '../mur/useRattrapage';
import './liste-metier.css';

const PAS_DE_RESEAU = 'Pas de réseau. Réessaie dans un instant.';

/** E8 Liste d'un métier : prestataires disponibles. */
export function ListeMetier() {
  const { metier = '' } = useParams();
  const [requete] = useSearchParams();
  const quartier = requete.get('quartier') ?? undefined;
  const location = useLocation();
  const navigate = useNavigate();
  const { client, etat } = useMatrix();
  const vue = useMur(client);
  const rattrape = useRattrapage(client);
  const cartes = useGlisse<HTMLUListElement>();
  const [succes] = useState(() => lireSucces(location.state));

  // Le message ne sert qu'une fois : il s'efface de l'état de navigation (pas de retour avec le message).
  useEffect(() => {
    if (lireSucces(location.state)) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate]);

  const prestataires = listeMetier(vue.statuts, metier, quartier, vue.maintenant);
  const titre = [metier, quartier].filter(Boolean).join(' · ');
  const reseauKo = etat === 'erreur-reseau' || vue.erreur;

  let contenu;
  if (reseauKo) contenu = <Bandeau message={PAS_DE_RESEAU} />;
  else if (!vue.pret) contenu = <p className="liste__vide">Chargement…</p>;
  else if (prestataires.length === 0) {
    contenu = <p className="liste__vide">Personne pour l'instant. Reviens un peu plus tard.</p>;
  } else {
    contenu = (
      <>
        {prestataires.length > 0 && (
          <section aria-labelledby="liste-dispos">
            <h2 id="liste-dispos" className="liste__section">
              Disponibles maintenant · {prestataires.length}
            </h2>
            <ul className="liste__cartes" ref={cartes}>
              {prestataires.map((p) => (
                <li key={p.eventId} data-glisse={p.eventId}>
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
      </>
    );
  }

  return (
    <main className="ecran liste">
      <header className="entete-page">
        <LienRetour to={cheminMur(quartier)} />
        <h1 className="entete-page__titre">{titre}</h1>
        <IndicateurMiseAJour actif={rattrape} />
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
