import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHEMINS } from '../../chemins';
import { cheminApresConnexion } from '../../coquille/apres-connexion';
import { normaliserIdentifiant } from '../../logique/inscription';
import { connecter } from '../../matrix/auth';
import type { ResultatConnexion, Session } from '../../matrix/auth';
import { enregistrerSession } from '../../matrix/session';
import { Bandeau } from '../../ui/Bandeau';
import { BoutonPrincipal } from '../../ui/BoutonPrincipal';
import { Champ } from '../../ui/Champ';
import { IconeRetour } from '../../ui/icones';
import './connexion.css';

const MESSAGES = {
  identifiants: 'Identifiant ou mot de passe incorrect.',
  reseau: 'Pas de connexion. Réessaie dans un instant.',
  inconnue: 'Un problème est survenu. Réessaie.',
  stockage: 'Le téléphone refuse de garder ta connexion. Réessaie.',
} as const;

/** E2 Se connecter (même style que E3). */
export function Connexion() {
  const navigate = useNavigate();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [bandeau, setBandeau] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Connexion réussie mais suite impossible (réseau) : on ne recrée pas un appareil au nouvel essai.
  const [connecte, setConnecte] = useState<Session | null>(null);

  const complet = identifiant.trim() !== '' && motDePasse !== '';

  function modifier(champ: 'identifiant' | 'motDePasse', valeur: string) {
    if (champ === 'identifiant') setIdentifiant(valeur);
    else setMotDePasse(valeur);
    setErreur(null);
  }

  async function allerPlusLoin(session: Session) {
    const suite = await cheminApresConnexion(session).catch(() => null);
    if (suite?.ok) {
      navigate(suite.chemin, { replace: true });
      return;
    }
    if (suite?.erreur === 'session') {
      setConnecte(null);
      setBandeau(MESSAGES.inconnue);
      return;
    }
    setBandeau(suite?.erreur === 'reseau' ? MESSAGES.reseau : MESSAGES.inconnue);
  }

  async function seConnecter(): Promise<Session | null> {
    const resultat = await connecter(normaliserIdentifiant(identifiant), motDePasse).catch(
      (): ResultatConnexion => ({ ok: false, erreur: 'inconnue' }),
    );
    if (!resultat.ok) {
      if (resultat.erreur === 'identifiants') setErreur(MESSAGES.identifiants);
      else setBandeau(MESSAGES[resultat.erreur]);
      return null;
    }
    try {
      enregistrerSession(resultat.session);
    } catch {
      setBandeau(MESSAGES.stockage);
      return null;
    }
    setConnecte(resultat.session);
    return resultat.session;
  }

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (!complet || envoi) return;
    setBandeau(null);
    setErreur(null);
    setEnvoi(true);
    const session = connecte ?? (await seConnecter());
    if (session) await allerPlusLoin(session);
    setEnvoi(false);
  }

  return (
    <main className="ecran connexion">
      <button
        type="button"
        className="retour"
        aria-label="Retour"
        onClick={() => navigate(CHEMINS.accueil)}
      >
        <IconeRetour />
      </button>
      <h1 className="connexion__titre">Se connecter</h1>

      <form className="connexion__formulaire" onSubmit={envoyer} noValidate>
        <div className="connexion__champs">
          <Champ
            libelle="Identifiant"
            valeur={identifiant}
            onChange={(v) => modifier('identifiant', v)}
            aide="Le nom choisi à l'inscription."
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Champ
            libelle="Mot de passe"
            valeur={motDePasse}
            onChange={(v) => modifier('motDePasse', v)}
            erreur={erreur ?? undefined}
            secret
            autoComplete="current-password"
          />
        </div>

        <div className="connexion__bas">
          {bandeau && <Bandeau message={bandeau} />}
          <BoutonPrincipal type="submit" disabled={!complet} chargement={envoi}>
            {envoi ? 'Connexion…' : 'Entrer'}
          </BoutonPrincipal>
        </div>
      </form>
    </main>
  );
}
