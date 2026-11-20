import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHEMINS, cheminApresInscription } from '../../chemins';
import {
  formulaireComplet,
  lireCodeInvitation,
  normaliserIdentifiant,
  verifierInscription,
} from '../../logique/inscription';
import { nettoyerSaisieCode } from '../../logique/code-secret';
import type {
  ChampInscription,
  ErreursInscription,
  ValeursInscription,
} from '../../logique/inscription';
import { definirCode } from '../../appareil/verrou';
import { creerCompte } from '../../matrix/auth';
import type { ErreurInscription, ResultatInscription } from '../../matrix/auth';
import { enregistrerSession } from '../../matrix/session';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonPrincipal } from '../../ui/BoutonPrincipal';
import { CaseACocher } from '../../ui/CaseACocher';
import { Champ } from '../../ui/Champ';
import { IconeRetour } from '../../ui/icones';
import './inscription.css';

const VIDE: ValeursInscription = {
  identifiant: '',
  motDePasse: '',
  confirmation: '',
  codeSecret: '',
  code: '',
  majeur: false,
};

/** Ce que l'écran affiche pour chaque refus du serveur : sous un champ, ou dans le bandeau. */
type Reponse = { champ: ChampInscription; message: string } | { bandeau: true; message: string };

const REPONSES_SERVEUR: Record<ErreurInscription, Reponse> = {
  'code-invalide': {
    champ: 'code',
    message: "Code d'invitation inconnu. Demande-le à la personne qui t'a invité.",
  },
  'identifiant-pris': {
    champ: 'identifiant',
    message: 'Ce nom est déjà pris. Essaie-en un autre.',
  },
  'identifiant-invalide': {
    champ: 'identifiant',
    message: 'Le serveur refuse ce nom. Essaie-en un autre.',
  },
  'mot-de-passe-faible': {
    champ: 'motDePasse',
    message: 'Mot de passe trop simple. Mélange lettres et chiffres.',
  },
  reseau: { bandeau: true, message: 'Pas de connexion. Réessaie dans un instant.' },
  'trop-de-demandes': {
    bandeau: true,
    message: 'Trop d’essais en même temps. Attends quelques secondes et réessaie.',
  },
  inconnue: { bandeau: true, message: 'Un problème est survenu. Réessaie.' },
};

/** E3 Créer mon compte. */
export function Inscription() {
  const navigate = useNavigate();
  const [valeurs, setValeurs] = useState<ValeursInscription>(VIDE);
  const [erreurs, setErreurs] = useState<ErreursInscription>({});
  const [bandeau, setBandeau] = useState<string | null>(null);
  const [codeRefuse, setCodeRefuse] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const boutonActif = formulaireComplet(valeurs) && valeurs.code !== codeRefuse;

  function modifier<K extends keyof ValeursInscription>(champ: K, valeur: ValeursInscription[K]) {
    setValeurs((avant) => ({ ...avant, [champ]: valeur }));
    // Le message d'un champ disparaît dès qu'on le corrige.
    setErreurs((avant) => (avant[champ] ? { ...avant, [champ]: undefined } : avant));
  }

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!boutonActif || envoiEnCours) return;
    setBandeau(null);

    const erreursLocales = verifierInscription(valeurs);
    if (Object.keys(erreursLocales).length > 0) {
      setErreurs(erreursLocales);
      return;
    }

    const { jeton, role } = lireCodeInvitation(valeurs.code);
    setEnvoiEnCours(true);
    const resultat = await creerCompte(
      normaliserIdentifiant(valeurs.identifiant),
      valeurs.motDePasse,
      jeton,
    ).catch((): ResultatInscription => ({ ok: false, erreur: 'inconnue' }));

    if (resultat.ok) {
      try {
        enregistrerSession(resultat.session);
      } catch {
        // Compte créé mais téléphone incapable de garder la session : on le dit au lieu de rester bloqué.
        setEnvoiEnCours(false);
        setBandeau('Ton compte est créé, mais le téléphone refuse de le garder. Connecte-toi.');
        return;
      }
      // Le code choisi ici verrouille l'appli. Le bouton reste occupé pendant son calcul (pas de deuxième envoi).
      // Si le téléphone refuse de le garder, l'écran « Choisis ton code » le redemandera.
      await definirCode(valeurs.codeSecret).catch(() => undefined);
      navigate(cheminApresInscription(role));
      return;
    }

    setEnvoiEnCours(false);
    const reponse = REPONSES_SERVEUR[resultat.erreur];
    if ('bandeau' in reponse) {
      setBandeau(reponse.message);
      return;
    }
    if (resultat.erreur === 'code-invalide') setCodeRefuse(valeurs.code);
    setErreurs({ [reponse.champ]: reponse.message });
  }

  return (
    <main className="ecran inscription">
      <button
        type="button"
        className="retour"
        aria-label="Retour"
        onClick={() => navigate(CHEMINS.accueil)}
      >
        <IconeRetour />
      </button>
      <h1 className="inscription__titre">Créer mon compte</h1>

      <form className="inscription__formulaire" onSubmit={envoyer} noValidate>
        <div className="inscription__champs">
          <Champ
            libelle="Identifiant"
            valeur={valeurs.identifiant}
            onChange={(v) => modifier('identifiant', v)}
            aide="C'est ton nom dans SIA, pas ton vrai nom."
            erreur={erreurs.identifiant}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Champ
            libelle="Mot de passe"
            valeur={valeurs.motDePasse}
            onChange={(v) => modifier('motDePasse', v)}
            aide="10 signes minimum."
            erreur={erreurs.motDePasse}
            secret
            autoComplete="new-password"
          />
          <Champ
            libelle="Confirme le mot de passe"
            valeur={valeurs.confirmation}
            onChange={(v) => modifier('confirmation', v)}
            erreur={erreurs.confirmation}
            secret
            autoComplete="new-password"
          />
          <Champ
            libelle="Code secret (4 chiffres)"
            valeur={valeurs.codeSecret}
            onChange={(v) => modifier('codeSecret', nettoyerSaisieCode(v))}
            aide="Il verrouille SIA à chaque ouverture. Retiens-le bien."
            erreur={erreurs.codeSecret}
            secret
            nomSecret="le code"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
          />
          <Champ
            libelle="Code d'invitation"
            valeur={valeurs.code}
            onChange={(v) => modifier('code', v)}
            aide="Donné par la personne qui t'invite."
            erreur={erreurs.code}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="inscription__case">
          <CaseACocher
            libelle="J'ai 18 ans ou plus"
            cochee={valeurs.majeur}
            onChange={(v) => modifier('majeur', v)}
            erreur={erreurs.majeur}
          />
        </div>

        <div className="inscription__bas">
          {bandeau && <Bandeau message={bandeau} />}
          <BoutonPrincipal type="submit" disabled={!boutonActif} chargement={envoiEnCours}>
            {envoiEnCours ? 'Création…' : 'Créer mon compte'}
          </BoutonPrincipal>
        </div>
      </form>
    </main>
  );
}
