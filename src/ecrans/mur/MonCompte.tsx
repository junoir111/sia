import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { CHEMINS } from '../../chemins';
import { BoutonDeconnexion } from '../../ui/BoutonDeconnexion';
import { RondInitiale } from '../../ui/RondInitiale';
import { IconeBulles, IconeChevron } from '../../ui/icones';
import type { Moi } from './useMoi';

type Proprietes = {
  pseudo: string;
  moi: Moi | null;
  nouveautes: number;
  onFermer: () => void;
};

/** « Mon compte » : panneau qui monte du bas (profil, bulles, Se déconnecter). */
export function MonCompte({ pseudo, moi, nouveautes, onFermer }: Proprietes) {
  const idTitre = useId();
  const fermer = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fermer.current?.focus();
  }, []);

  function clavier(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') onFermer();
  }

  const cheminProfil =
    moi?.role === 'prestataire' ? CHEMINS.profilPrestataire : CHEMINS.profilClient;

  return (
    <div className="feuille" onKeyDown={clavier}>
      <div className="feuille__voile" aria-hidden="true" onClick={onFermer} />
      <div
        className="feuille__panneau compte"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
      >
        <div className="compte__qui">
          <RondInitiale nom={pseudo} />
          <div className="compte__textes">
            <h2 id={idTitre} className="compte__pseudo">
              {pseudo}
            </h2>
            {moi && (
              <p className="compte__role">
                {moi.role === 'prestataire' ? 'Prestataire' : 'Client'}
              </p>
            )}
          </div>
        </div>
        <ul className="compte__liens">
          {moi && (
            <li>
              <Link className="compte__lien" to={cheminProfil}>
                <span>Mon profil</span>
                <IconeChevron />
              </Link>
            </li>
          )}
          <li>
            <Link className="compte__lien" to={CHEMINS.bulles}>
              <IconeBulles className="compte__icone" />
              <span>Voir mes bulles</span>
              {nouveautes > 0 && (
                <span className="badge">{nouveautes > 9 ? '9+' : nouveautes}</span>
              )}
              <IconeChevron />
            </Link>
          </li>
        </ul>
        <BoutonDeconnexion />
        <button
          ref={fermer}
          type="button"
          className="bouton bouton--secondaire compte__fermer"
          onClick={onFermer}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
