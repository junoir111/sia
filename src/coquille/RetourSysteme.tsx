import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { reculerSurEcran } from '../appareil/retour-systeme';
import { CHEMINS } from '../chemins';

/** Pages de départ : le retour y quitte l'appli, comme partout sur Android. */
const PAGES_DE_DEPART: ReadonlySet<string> = new Set([CHEMINS.accueil, CHEMINS.mur]);

/**
 * Bouton « retour » du téléphone (Android seulement) : fait comme la flèche du haut de l'écran. Sur une page sans
 * flèche (profil), il ramène au Mur ; sur le Mur ou l'accueil, il quitte l'appli. Sans cette écoute, Android ferme
 * l'appli à chaque appui, depuis n'importe quel écran. Ne montre rien.
 */
export function RetourSysteme() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // L'écoute n'est posée qu'une fois : elle lit la page d'aujourd'hui ici.
  const courant = useRef({ navigate, pathname });
  useEffect(() => {
    courant.current = { navigate, pathname };
  });

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    const poignee = App.addListener('backButton', () => {
      if (reculerSurEcran()) return;
      const { navigate: aller, pathname: page } = courant.current;
      if (PAGES_DE_DEPART.has(page)) void App.exitApp();
      else aller(CHEMINS.mur);
    });
    return () => {
      void poignee.then((p) => p.remove());
    };
  }, []);

  return null;
}
