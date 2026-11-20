import { etatVerrou } from '../appareil/verrou';
import { lireSession } from '../matrix/session';

/**
 * Où en est la porte de l'appli (F12) :
 * - `ouverte` : on voit les écrans (pas connecté, ou code déjà tapé) ;
 * - `code-a-taper` : connecté, l'appli est fermée à clé ;
 * - `code-a-choisir` : connecté, mais ce téléphone n'a pas encore de code.
 */
export type Porte = 'ouverte' | 'code-a-taper' | 'code-a-choisir';

export function porteActuelle(): Porte {
  if (lireSession() === null) return 'ouverte';
  const etat = etatVerrou();
  if (etat === 'ferme') return 'code-a-taper';
  if (etat === 'sans-code') return 'code-a-choisir';
  return 'ouverte';
}
