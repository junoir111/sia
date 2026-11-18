import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CHEMINS, cheminListeMetier } from '../../chemins';
import { useMatrix } from '../../coquille/FournisseurMatrix';
import { grilleMur } from '../../logique/mur';
import { pseudoPropose } from '../../logique/profil';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonRond } from '../../ui/BoutonRond';
import { RondInitiale } from '../../ui/RondInitiale';
import { TuileMetier } from '../../ui/TuileMetier';
import { IconeLoupe } from '../../ui/icones';
import { compterNouveautes, useBulles } from '../bulles/useBulles';
import { MonCompte } from './MonCompte';
import { useMoi } from './useMoi';
import { useMur } from './useMur';
import { effacerPosition, lirePosition, memoriserPosition } from './position-mur';
import './mur.css';

const PAS_DE_RESEAU = 'Pas de connexion. Réessaie dans un instant.';
const LONGUEUR_MAX_RECHERCHE = 40;

/** E7 Le Mur (modèle 1 « grille des métiers »). */
export function Mur() {
  const [requete, setRequete] = useSearchParams();
  const { client, etat } = useMatrix();
  const vue = useMur(client);
  const bulles = useBulles(client);
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
  const nouveauDernier = texte.trim() === '' ? undefined : (quartier ?? dernierQuartier);
  if (nouveauDernier !== dernierQuartier) setDernierQuartier(nouveauDernier);
  const quartierLien = nouveauDernier;

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

  let contenu;
  if (reseauKo) contenu = <Bandeau message={PAS_DE_RESEAU} />;
  else if (!vue.pret) contenu = <p className="mur__attente">Chargement…</p>;
  else if (tuiles.length === 0) {
    const filtre = texte.trim() !== '';
    contenu = (
      <p className="mur__attente" aria-live="polite">
        {filtre ? 'Personne de disponible ici.' : 'Aucun prestataire disponible pour l’instant.'}
      </p>
    );
  } else
    contenu = (
      <ul className="mur__grille">
        {tuiles.map((t) => (
          <li key={t.metier} onClickCapture={memoriser}>
            <TuileMetier tuile={t} to={cheminListeMetier(t.metier, quartierLien)} />
          </li>
        ))}
      </ul>
    );

  return (
    <main className="ecran mur">
      <header className="mur__entete">
        <h1 className="mur__titre">Le Mur</h1>
        <button
          type="button"
          className="mur__compte"
          aria-label="Mon compte"
          aria-haspopup="dialog"
          onClick={() => setCompteOuvert(true)}
        >
          <RondInitiale nom={pseudo} taille="moyen" />
        </button>
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
      {contenu}
      {bouton}
      {compteOuvert && (
        <MonCompte
          pseudo={pseudo}
          moi={moi}
          nouveautes={compterNouveautes(bulles)}
          onFermer={() => setCompteOuvert(false)}
        />
      )}
    </main>
  );
}
