import { useCallback, useLayoutEffect, useRef } from 'react';
import type { RefCallback } from 'react';

/*
 * Liste vivante : quand une entrée arrive, part ou change de place, les autres GLISSENT vers leur
 * nouvelle place au lieu de sauter, et la nouvelle apparaît en douceur. Rien à toucher ni à recharger.
 * Chaque enfant direct du conteneur porte `data-glisse="<clé>"` (la clé reste la même d'un affichage à l'autre).
 * Seuls `transform` et `opacity` bougent. « Moins d'animations » demandé au téléphone : tout est instantané.
 */

const DUREE_MS = 220;
const COURBE = 'cubic-bezier(0.16, 1, 0.3, 1)';

type Position = { x: number; y: number };
type Options = {
  /** Faux : les nouvelles entrées ne s'estompent pas (elles ont déjà leur propre arrivée). */
  arrivee?: boolean;
};

/** Compare la place de chaque entrée à celle de la fois d'avant, lance les mouvements, rend les places d'aujourd'hui. */
function glisser(
  racine: HTMLElement,
  avant: ReadonlyMap<string, Position>,
  arrivee: boolean,
): Map<string, Position> {
  const calme = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const apres = new Map<string, Position>();
  for (const enfant of Array.from(racine.children)) {
    if (!(enfant instanceof HTMLElement) || !enfant.dataset.glisse) continue;
    const cle = enfant.dataset.glisse;
    const place = { x: enfant.offsetLeft, y: enfant.offsetTop };
    apres.set(cle, place);
    // Premier affichage de la liste : tout est déjà en place, rien ne bouge.
    if (calme || avant.size === 0 || typeof enfant.animate !== 'function') continue;
    const ancienne = avant.get(cle);
    if (!ancienne) {
      if (arrivee) {
        enfant.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUREE_MS, easing: COURBE });
      }
    } else if (ancienne.x !== place.x || ancienne.y !== place.y) {
      enfant.animate(
        [
          { transform: `translate(${ancienne.x - place.x}px, ${ancienne.y - place.y}px)` },
          { transform: 'none' },
        ],
        { duration: DUREE_MS, easing: COURBE },
      );
    }
  }
  return apres;
}

/** À poser (`ref={…}`) sur le conteneur de la liste. */
export function useGlisse<T extends HTMLElement>({ arrivee = true }: Options = {}): RefCallback<T> {
  const racine = useRef<T | null>(null);
  const guetteur = useRef<MutationObserver | null>(null);
  const positions = useRef(new Map<string, Position>());
  const avecArrivee = useRef(arrivee);

  const comparer = useCallback(() => {
    if (racine.current)
      positions.current = glisser(racine.current, positions.current, avecArrivee.current);
  }, []);

  // Le conteneur peut apparaître ou disparaître au fil des affichages : on le suit à la pose de la ref.
  const poser = useCallback(
    (element: T | null) => {
      guetteur.current?.disconnect();
      guetteur.current = null;
      racine.current = element;
      // Nouveau conteneur : c'est un premier affichage, pas un déplacement (rien ne glisse d'une ancienne liste).
      positions.current = new Map();
      if (element && typeof MutationObserver !== 'undefined') {
        // Une entrée qui change d'état seule (la liste ne se redessine pas) fait aussi glisser les autres.
        guetteur.current = new MutationObserver(comparer);
        guetteur.current.observe(element, { childList: true, subtree: true });
      }
    },
    [comparer],
  );

  // À chaque affichage de l'écran.
  useLayoutEffect(() => {
    avecArrivee.current = arrivee;
    comparer();
  });

  return poser;
}
