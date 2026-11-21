import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHEMINS } from '../../chemins';
import { deconnecter } from '../../matrix/auth';
import { lireSession } from '../../matrix/session';
import { FeuilleConfirmation } from '../../ui/FeuilleConfirmation';

type Proprietes = {
  /** `taper` : code oublié ; `choisir` : on veut partir sans choisir de code. */
  mode: 'taper' | 'choisir';
  ouverte: boolean;
  onOuvrir: () => void;
  onFermer: () => void;
};

const TEXTES = {
  taper: {
    lien: 'Code oublié ?',
    titre: 'Code oublié ?',
    texte:
      'Pour entrer sans ton code, tu dois te déconnecter : tes bulles en cours seront fermées sur ce téléphone. ' +
      'Reconnecte-toi ensuite avec ton identifiant et ton mot de passe, puis choisis un nouveau code.',
  },
  choisir: {
    lien: 'Se déconnecter',
    titre: 'Te déconnecter ?',
    texte: 'Tes bulles en cours seront fermées sur ce téléphone.',
  },
} as const;

/** Lien discret en bas de l'écran du code : se déconnecter (seule sortie si le code est oublié). */
export function SortieDuCode({ mode, ouverte, onOuvrir, onFermer }: Proprietes) {
  const navigate = useNavigate();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const textes = TEXTES[mode];

  async function confirmer() {
    setEnCours(true);
    setErreur(null);
    try {
      const session = lireSession();
      if (session) await deconnecter(session);
      // On ne sort que si le téléphone est vraiment effacé (stockage en panne : on reste derrière le code).
      if (lireSession() !== null) throw new Error('session toujours présente');
      navigate(CHEMINS.accueil, { replace: true });
    } catch {
      setErreur('La déconnexion n’a pas marché. Réessaie.');
      setEnCours(false);
    }
  }

  return (
    <div className="code__sortie">
      <button type="button" className="code__lien" onClick={onOuvrir}>
        {textes.lien}
      </button>
      {ouverte && (
        <FeuilleConfirmation
          titre={textes.titre}
          texte={textes.texte}
          confirmer="Se déconnecter"
          chargement={enCours}
          erreur={erreur}
          onConfirmer={() => void confirmer()}
          onAnnuler={onFermer}
        />
      )}
    </div>
  );
}
