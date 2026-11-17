import type { ButtonHTMLAttributes } from 'react';

type Proprietes = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Pendant une attente : le bouton est bloqué et annoncé « occupé ». */
  chargement?: boolean;
};

/** Bouton plein, couleur accent, toute la largeur. Une seule fois par écran. */
export function BoutonPrincipal({
  chargement = false,
  disabled,
  type = 'button',
  className,
  ...reste
}: Proprietes) {
  return (
    <button
      {...reste}
      type={type}
      disabled={disabled || chargement}
      aria-busy={chargement || undefined}
      className={['bouton', 'bouton--principal', className].filter(Boolean).join(' ')}
    />
  );
}
