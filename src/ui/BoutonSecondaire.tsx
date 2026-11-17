import type { ButtonHTMLAttributes } from 'react';

/** Bouton à contour fin, texte normal, toute la largeur. */
export function BoutonSecondaire({
  type = 'button',
  className,
  ...reste
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...reste}
      type={type}
      className={['bouton', 'bouton--secondaire', className].filter(Boolean).join(' ')}
    />
  );
}
