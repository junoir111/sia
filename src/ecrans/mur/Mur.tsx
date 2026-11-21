import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CHEMINS,
  cheminFicheDemande,
  cheminFichePrestataire,
  cheminListeMetier,
} from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { cleTexte, grilleMur, libelleModalite, listeMetier } from '../../logique/mur';
import { formaterPrix, pseudoPropose } from '../../logique/profil';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonRond } from '../../ui/BoutonRond';
import { CarteAnnonce } from '../../ui/CarteAnnonce';
import { CartePrestataire } from '../../ui/CartePrestataire';
import { IndicateurMiseAJour } from '../../ui/IndicateurMiseAJour';
import { RondInitiale } from '../../ui/RondInitiale';
import { TuileMetier } from '../../ui/TuileMetier';
import { IconeCloche, IconeLoupe } from '../../ui/icones';
import { useGlisse } from '../../ui/useGlisse';
import { compterNouveautes, useBulles } from '../bulles/useBulles';
import { MonCompte } from './MonCompte';
import { ilYa } from './navigation-mur';
import { useMoi } from './useMoi';
import { useMur } from './useMur';
import { useRattrapage } from './useRattrapage';
import { effacerPosition, lirePosition, memoriserPosition } from './position-mur';
import './mur.css';

const PAS_DE_RESEAU = 'Pas de réseau. Réessaie dans un instant.';
const LONGUEUR_MAX_RECHERCHE = 40;

/** E7 Le Mur : filtres par métier, prestataires disponibles, et demandes des clients (pour les prestataires). */
export function Mur() {
  const [requete, setRequete] = useSearchParams();
  const { client, etat } = useMatrix();
  const vue = useMur(client);
  const bulles = useBulles(client);
  const rattrape = useRattrapage(client);
  const grille = useGlisse<HTMLUListElement>();
  const { moi, userId, chargement } = useMoi();
  // Au retour d'une page fille, on retrouve le texte tapé (et plus bas, la position).
  const [position] = useState(() => lirePosition());
  const [texte, setTexte] = useState(
    requete.get('q') ?? position?.texte ?? requete.get('quartier') ?? '',
  );
  // Dernier quartier connu : il survit à la saisie d'un métier.
  const [dernierQuartier, setDernierQuartier] = useState<string | undefined>(
    requete.get('quartier') ?? position?.quartier ?? undefined,
  );
  const [compteOuvert, setCompteOuvert] = useState(false);

  // Le texte tapé est un métier s'il en existe un (présent sur le Mur) qui le contient ; sinon, c'est un quartier.
  const parMetier =
    texte.trim() !== '' &&
    grilleMur(vue.statuts, { recherche: texte, maintenant: vue.maintenant }).length > 0;
  const quartier = parMetier || texte.trim() === '' ? undefined : texte.trim();
  const tuiles = grilleMur(vue.statuts, {
    quartier,
    recherche: parMetier ? texte : undefined,
    maintenant: vue.maintenant,
  });
  // Mis à jour pendant l'affichage (permis par React) : vide si on efface tout, sinon le dernier quartier tapé.
  // Tant que le Mur n'est pas prêt, on ne touche à rien : un métier tapé paraîtrait un instant être un quartier
  // (aucune case connue) et écraserait le vrai quartier.
  const nouveauDernier = !vue.pret
    ? dernierQuartier
    : texte.trim() === ''
      ? undefined
      : (quartier ?? dernierQuartier);
  if (nouveauDernier !== dernierQuartier) setDernierQuartier(nouveauDernier);
  const quartierLien = nouveauDernier;

  // Puces de filtre : « Tout » + un métier par case présente sur le Mur. Toucher une puce filtre comme si on
  // le tapait. La puce active suit le texte (exactement ce métier), sinon « Tout ».
  const metiers = vue.pret
    ? grilleMur(vue.statuts, { maintenant: vue.maintenant }).map((t) => t.metier)
    : [];
  const cleCourante = cleTexte(texte);

  // Les demandes des clients, montrées sur le Mur (section « Clients ») SEULEMENT aux prestataires : ce sont
  // eux le public, et un client n'écrit pas à un autre client. Un prestataire pas disponible les retrouve en
  // revenant. Filtrées comme les prestataires (par quartier, ou par métier tapé).
  const motMetier = texte.trim().toLowerCase();
  const demandesVisibles =
    moi?.role !== 'prestataire'
      ? []
      : vue.demandes.filter((d) => {
          if (d.fin <= vue.maintenant || d.userId === userId) return false;
          if (quartier && !d.zone.toLowerCase().includes(quartier.toLowerCase())) return false;
          if (parMetier && !d.service.toLowerCase().includes(motMetier)) return false;
          return true;
        });

  // Le quartier (et le métier tapé) restent dans l'adresse : pages filles et retour les reprennent.
  const cible = quartierLien ?? '';
  const cibleTexte = parMetier ? texte.trim() : '';
  useEffect(() => {
    if ((requete.get('quartier') ?? '') === cible && (requete.get('q') ?? '') === cibleTexte) return;
    const suivante: Record<string, string> = {};
    if (cible) suivante.quartier = cible;
    if (cibleTexte) suivante.q = cibleTexte;
    setRequete(suivante, { replace: true });
  }, [cible, cibleTexte, requete, setRequete]);

  // Position de défilement retrouvée une fois la grille affichée.
  const restauree = useRef(false);
  useLayoutEffect(() => {
    if (!vue.pret || restauree.current) return;
    restauree.current = true;
    if (position) window.scrollTo(0, position.defilement);
    effacerPosition();
  }, [vue.pret, position]);

  function memoriser() {
    memoriserPosition({ texte, quartier: quartierLien, defilement: window.scrollY });
  }

  const pseudo = moi?.pseudo ?? (userId ? pseudoPropose(userId) : '');
  const reseauKo = etat === 'erreur-reseau' || vue.erreur;
  const nonLus = compterNouveautes(bulles);

  let bouton = null;
  if (moi?.role === 'prestataire') {
    bouton = (
      <BoutonRond
        to={CHEMINS.profilPrestataire}
        libelle="Me rendre disponible"
        texte="Je suis disponible"
      />
    );
  } else if (moi?.role === 'client') {
    bouton = <BoutonRond to={CHEMINS.profilClient} libelle="Publier une demande" />;
  } else if (!chargement) {
    bouton = <BoutonRond to={CHEMINS.role} libelle="Commencer" />;
  }

  // Un seul métier retenu par le filtre : on montre les PERSONNES (cartes) ; sinon la grille des métiers.
  const metierUnique = parMetier && tuiles.length === 1 ? (tuiles[0]?.metier ?? null) : null;
  const gens = metierUnique
    ? listeMetier(vue.statuts, metierUnique, quartierLien, vue.maintenant)
    : [];

  let prestataires;
  if (reseauKo) prestataires = <Bandeau message={PAS_DE_RESEAU} />;
  else if (!vue.pret) prestataires = <p className="mur__attente">Chargement…</p>;
  else if (tuiles.length === 0) {
    const filtre = texte.trim() !== '';
    prestataires = (
      <p className="mur__attente" aria-live="polite">
        {filtre ? 'Personne de disponible ici.' : 'Aucun prestataire disponible pour l’instant.'}
      </p>
    );
  } else if (metierUnique) {
    prestataires = (
      <section className="mur__bloc" aria-label="Prestataires disponibles">
        <h2 className="mur__section">Prestataires</h2>
        <ul className="mur__cartes" ref={grille}>
          {gens.map((p) => (
            <li key={p.eventId} data-glisse={p.eventId} onClickCapture={memoriser}>
              <CartePrestataire
                pseudo={p.pseudo}
                info={p.modalite ? `${p.zone} · ${libelleModalite(p.modalite)}` : p.zone}
                to={cheminFichePrestataire(p.eventId, '', quartierLien)}
              />
            </li>
          ))}
        </ul>
      </section>
    );
  } else {
    prestataires = (
      <section className="mur__bloc" aria-label="Prestataires disponibles">
        <h2 className="mur__section">Prestataires</h2>
        <ul className="mur__grille" ref={grille}>
          {tuiles.map((t) => (
            <li key={t.metier} data-glisse={t.metier} onClickCapture={memoriser}>
              <TuileMetier tuile={t} to={cheminListeMetier(t.metier, quartierLien)} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <main className="ecran mur">
      <header className="mur__entete">
        <h1 className="mur__titre">Le Mur</h1>
        <div className="mur__actions">
          <IndicateurMiseAJour actif={rattrape} />
          <Link
            className="mur__cloche"
            to={CHEMINS.bulles}
            aria-label={nonLus > 0 ? `Mes bulles, ${nonLus} nouveau(x)` : 'Mes bulles'}
          >
            <IconeCloche />
            {nonLus > 0 && <span className="mur__pastille" aria-hidden="true" />}
          </Link>
          <button
            type="button"
            className="mur__compte"
            aria-label="Mon compte"
            aria-haspopup="dialog"
            onClick={() => setCompteOuvert(true)}
          >
            <RondInitiale nom={pseudo} taille="moyen" />
          </button>
        </div>
      </header>
      <div className="mur__recherche">
        <IconeLoupe className="mur__loupe" />
        <input
          type="search"
          className="champ__saisie mur__saisie"
          aria-label="Chercher un quartier ou un métier"
          placeholder="Un quartier ou un métier"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={LONGUEUR_MAX_RECHERCHE}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
      </div>
      {metiers.length > 0 && (
        <div className="mur__puces" role="group" aria-label="Filtrer par métier">
          <button
            type="button"
            className={!parMetier ? 'mur__puce mur__puce--active' : 'mur__puce'}
            aria-pressed={!parMetier}
            onClick={() => setTexte('')}
          >
            Tout
          </button>
          {metiers.map((m) => {
            const actif = cleCourante === cleTexte(m);
            return (
              <button
                key={m}
                type="button"
                className={actif ? 'mur__puce mur__puce--active' : 'mur__puce'}
                aria-pressed={actif}
                onClick={() => setTexte(m)}
              >
                {m}
              </button>
            );
          })}
        </div>
      )}
      {prestataires}
      {demandesVisibles.length > 0 && (
        <section className="mur__bloc mur__clients" aria-label="Demandes des clients">
          <h2 className="mur__section">Clients</h2>
          <ul className="mur__demandes">
            {demandesVisibles.map((d) => (
              <li key={d.eventId} onClickCapture={memoriser}>
                <CarteAnnonce
                  pseudo={d.pseudo}
                  quand={ilYa(d.creeLe, vue.maintenant)}
                  resume={`${d.zone} · ${formaterPrix(d.budget)} FCFA · ${d.service}`}
                  texte={d.texte || undefined}
                  avecAction
                  to={cheminFicheDemande(d.eventId, '', quartierLien)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {bouton}
      {compteOuvert && (
        <MonCompte
          pseudo={pseudo}
          moi={moi}
          nouveautes={nonLus}
          onFermer={() => setCompteOuvert(false)}
        />
      )}
    </main>
  );
}
