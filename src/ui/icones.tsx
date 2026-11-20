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

export function IconeLoupe({ taille = 20, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={2}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </svg>
  );
}

export function IconeCrayon({ taille = 22, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={1.7}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L8 20l-4.5 1 1-4.5Z" />
      <path d="m14.5 5.5 4 4" />
    </svg>
  );
}

export function IconeAppareilPhoto({ taille = 22, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={1.7}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h3L9 4.5h6L16.5 7h3A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function IconeCroix({ taille = 14, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={2.4}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconeChevron({ taille = 16, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={2.2}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function IconeHorloge({ taille = 16, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 6.5V12l3.5 2.5" />
    </svg>
  );
}

export function IconeEnvoyer({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={2.2}>
      <path d="M4.5 12h15" />
      <path d="M13.5 6l6 6-6 6" />
    </svg>
  );
}

export function IconePlus({ taille = 28, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={2.2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Deux bulles de discussion : accès à la liste des bulles. */
export function IconeBulles({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={1.7}>
      <path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3.5v-3.5h0a2 2 0 0 1-1.5-2Z" />
      <path d="M16.5 8.5h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2v3l-3.5-3h-4.5a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

export function IconePersonnes({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={1.7}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17.2" cy="9" r="2.5" />
      <path d="M17.5 14.2c2.3.2 3.9 1.9 3.9 4.3" />
    </svg>
  );
}

export function IconeEffacer({ taille = 24, className }: ProprietesIcone) {
  return (
    <svg {...cadre(taille, className)} strokeWidth={1.8}>
      <path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-6.5Z" />
      <path d="m12.5 9.5 5 5m0-5-5 5" />
    </svg>
  );
}
