import { App } from '@capacitor/app';
import { doitVerrouiller } from '../logique/code-secret';

/**
 * Surveille les départs et les retours de l'appli (téléphone : changement d'état de l'appli ; navigateur : onglet
 * caché ou non, le plugin le traduit pareil). Au retour, si on est resté dehors assez longtemps, appelle
 * `apresAbsenceLongue`. Rend la fonction qui arrête de surveiller.
 */
export function surveillerAbsence(
  apresAbsenceLongue: () => void,
  maintenant: () => number = () => Date.now(),
): () => void {
  let sortieA: number | null = null;
  const poignee = App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      sortieA ??= maintenant();
      return;
    }
    const depuis = sortieA;
    sortieA = null;
    if (doitVerrouiller(depuis, maintenant())) apresAbsenceLongue();
  });
  return () => {
    void poignee.then((p) => p.remove());
  };
}
