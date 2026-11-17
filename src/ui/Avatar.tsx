import { useId, useRef } from 'react';
import { IconeAppareilPhoto, IconeCroix } from './icones';

type Proprietes = {
  /** Adresse locale (URL objet) de la photo, ou null s'il n'y en a pas. */
  url: string | null;
  onChoisir: (fichier: File) => void;
  onRetirer: () => void;
  occupe?: boolean;
};

/** Photo ronde : la toucher ouvre le choix d'image ; petite croix pour la retirer. */
export function Avatar({ url, onChoisir, onRetirer, occupe = false }: Proprietes) {
  const choix = useRef<HTMLInputElement>(null);
  const idAide = useId();
  return (
    <div className="avatar">
      <button
        type="button"
        className="avatar__rond"
        aria-label={url ? 'Changer ma photo' : 'Ajouter une photo'}
        aria-describedby={idAide}
        aria-busy={occupe || undefined}
        disabled={occupe}
        onClick={() => choix.current?.click()}
      >
        {url ? (
          <img className="avatar__image" src={url} alt="" />
        ) : (
          <span className="avatar__vide" aria-hidden="true">
            <IconeAppareilPhoto taille={20} />
            Photo
          </span>
        )}
      </button>
      <span id={idAide} className="masque">
        Reste sur ton téléphone, montrée seulement dans une bulle.
      </span>
      {url && (
        <button
          type="button"
          className="avatar__retirer"
          aria-label="Retirer ma photo"
          onClick={onRetirer}
        >
          <span className="avatar__croix">
            <IconeCroix taille={12} />
          </span>
        </button>
      )}
      <input
        ref={choix}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const fichier = e.target.files?.[0];
          e.target.value = '';
          if (fichier) onChoisir(fichier);
        }}
      />
    </div>
  );
}
