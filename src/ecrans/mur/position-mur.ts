/** Ce que le Mur retient quand on le quitte, pour le retrouver au retour par la flèche. */
export interface PositionMur {
  texte: string;
  quartier: string | undefined;
  defilement: number;
}

const CLE = 'sia.mur.position';

export function memoriserPosition(position: PositionMur): void {
  try {
    sessionStorage.setItem(CLE, JSON.stringify(position));
  } catch {
    // Stockage refusé : on perd juste la position, rien de grave.
  }
}

/** Lit la position gardée (une seule fois utile : `effacerPosition` la retire ensuite). */
export function lirePosition(): PositionMur | null {
  try {
    const brut = sessionStorage.getItem(CLE);
    if (!brut) return null;
    const v = JSON.parse(brut) as Partial<PositionMur>;
    if (typeof v.texte !== 'string' || typeof v.defilement !== 'number') return null;
    return {
      texte: v.texte,
      quartier: typeof v.quartier === 'string' ? v.quartier : undefined,
      defilement: v.defilement,
    };
  } catch {
    return null;
  }
}

export function effacerPosition(): void {
  try {
    sessionStorage.removeItem(CLE);
  } catch {
    // Rien à retirer.
  }
}
