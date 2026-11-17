// Icônes dessinées à la main (trait de 1,6 à 2 px), en couleur du texte courant.

type ProprietesIcone = { taille?: number; className?: string };

function cadre(taille: number, className: string | undefined) {
  return {
    width: taille,
    height: taille,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className,
  };
}

export function IconeOeil({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={1.6}>
      <path d="M1.5 12c2.6-4.6 6.2-7 10.5-7s7.9 2.4 10.5 7c-2.6 4.6-6.2 7-10.5 7S4.1 16.6 1.5 12Z" />
      <circle cx="12" cy="12" r="3.6" />
    </svg>
  );
}

export function IconeOeilBarre({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={1.6}>
      <path d="M1.5 12c2.6-4.6 6.2-7 10.5-7s7.9 2.4 10.5 7c-2.6 4.6-6.2 7-10.5 7S4.1 16.6 1.5 12Z" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M4 3.5 20 20.5" />
    </svg>
  );
}

export function IconeAlerte({ taille = 16, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={2}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.6v.1" strokeWidth={2.6} />
    </svg>
  );
}

export function IconeRetour({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={2}>
      <path d="M20 12H4" />
      <path d="M10.5 5 4 12l6.5 7" />
    </svg>
  );
}

export function IconeCoche({ taille = 16, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={3}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}
