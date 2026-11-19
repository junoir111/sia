import type { ButtonHTMLAttributes } from 'react';
import { IconeCoche } from './icones';

type Proprietes = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Pendant une attente : le bouton est bloqué et annoncé « occupé ». */
  chargement?: boolean;
  /**
   * L'action vient de partir, le serveur n'a pas encore confirmé : le bouton prend ce texte
   * (« Demande envoyée… »), reste vert et ne réagit plus. S'il faut revenir en arrière, on l'enlève.
   */
  envoye?: string;
};

/** Bouton plein, couleur accent, toute la largeur. Une seule fois par écran. */
export function BoutonPrincipal({
  chargement = false,
  envoye,
  disabled,
  type = 'button',
  className,
  children,
  ...reste
}: Proprietes) {
  const parti = envoye !== undefined;
  return (
    <button
      {...reste}
      type={type}
      disabled={disabled || chargement || parti}
      aria-busy={chargement || parti || undefined}
      className={['bouton', 'bouton--principal', parti && 'bouton--envoye', className]
        .filter(Boolean)
        .join(' ')}
    >
      {parti ? (
        <>
          <IconeCoche className="bouton__coche" />
          {envoye}
        </>
      ) : (
        children
      )}
    </button>
  );
}
