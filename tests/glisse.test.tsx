import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useGlisse } from '../src/ui/useGlisse';

/*
 * jsdom ne dessine rien : on simule la place de chaque entrée (100 px par rang, une colonne) et on regarde
 * si le hook demande le bon mouvement. Le vrai effet se voit sur le téléphone.
 */

const animer = vi.fn();
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const avant = {
  offsetTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'),
  offsetLeft: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft'),
  animate: proto.animate,
};

function Liste({ cles, arrivee }: { cles: string[]; arrivee?: boolean }) {
  const ref = useGlisse<HTMLUListElement>(arrivee === undefined ? {} : { arrivee });
  return (
    <ul ref={ref}>
      {cles.map((c) => (
        <li key={c} data-glisse={c}>
          {c}
        </li>
      ))}
      <li>sans clé : ne bouge jamais</li>
    </ul>
  );
}

/** Une entrée qui disparaît toute seule quand on la touche : la liste (le parent) ne se redessine pas. */
function EntreeQuiPart({ cle }: { cle: string }) {
  const [la, setLa] = useState(true);
  if (!la) return null;
  return (
    <li data-glisse={cle}>
      <button type="button" onClick={() => setLa(false)}>
        retirer {cle}
      </button>
    </li>
  );
}

function ListeAutonome() {
  const ref = useGlisse<HTMLUListElement>();
  return (
    <ul ref={ref}>
      <EntreeQuiPart cle="a" />
      <EntreeQuiPart cle="b" />
    </ul>
  );
}

describe('liste vivante : les entrées glissent au lieu de sauter', () => {
  beforeEach(() => {
    animer.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        return Array.from(this.parentElement?.children ?? []).indexOf(this) * 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
      configurable: true,
      get: () => 0,
    });
    proto.animate = animer;
  });

  afterEach(() => {
    if (avant.offsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', avant.offsetTop);
    if (avant.offsetLeft) {
      Object.defineProperty(HTMLElement.prototype, 'offsetLeft', avant.offsetLeft);
    }
    proto.animate = avant.animate;
    vi.unstubAllGlobals();
  });

  it('premier affichage : tout est déjà en place, rien ne bouge', () => {
    render(<Liste cles={['a', 'b', 'c']} />);
    expect(animer).not.toHaveBeenCalled();
  });

  it('rien ne change : rien ne bouge', () => {
    const { rerender } = render(<Liste cles={['a', 'b']} />);
    rerender(<Liste cles={['a', 'b']} />);
    expect(animer).not.toHaveBeenCalled();
  });

  it('une entrée arrive en tête : les autres glissent vers le bas et la nouvelle apparaît en douceur', () => {
    const { rerender, getByText } = render(<Liste cles={['a', 'b']} />);
    rerender(<Liste cles={['n', 'a', 'b']} />);
    // a et b étaient à 0 et 100 px, elles sont à 100 et 200 px : elles partent 100 px plus haut.
    const mouvements = animer.mock.calls.map(([images]) => images as Record<string, string>[]);
    const glisse = mouvements.filter((images) => images[0]?.transform !== undefined);
    expect(glisse).toHaveLength(2);
    expect(glisse[0]).toEqual([{ transform: 'translate(0px, -100px)' }, { transform: 'none' }]);
    const fondu = mouvements.filter((images) => images[0]?.opacity !== undefined);
    expect(fondu).toEqual([[{ opacity: 0 }, { opacity: 1 }]]);
    expect(getByText('n')).toBeInTheDocument();
  });

  it('une entrée part : celles d’en dessous remontent en glissant', () => {
    const { rerender } = render(<Liste cles={['a', 'b', 'c']} />);
    rerender(<Liste cles={['a', 'c']} />);
    const images = animer.mock.calls.map(([i]) => i as Record<string, string>[]);
    // c passe de 200 px à 100 px : elle part 100 px plus bas.
    expect(images).toEqual([[{ transform: 'translate(0px, 100px)' }, { transform: 'none' }]]);
  });

  it('arrivee: false : les nouvelles entrées ne s’estompent pas (elles ont leur propre arrivée)', () => {
    const { rerender } = render(<Liste cles={['a']} arrivee={false} />);
    rerender(<Liste cles={['n', 'a']} arrivee={false} />);
    const images = animer.mock.calls.map(([i]) => i as Record<string, string>[]);
    expect(images.every((i) => i[0]?.opacity === undefined)).toBe(true);
    expect(images).toHaveLength(1); // a a glissé
  });

  it('« moins d’animations » demandé au téléphone : tout est instantané', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { rerender } = render(<Liste cles={['a', 'b']} />);
    rerender(<Liste cles={['n', 'a', 'b']} />);
    expect(animer).not.toHaveBeenCalled();
  });

  it('navigateur sans animations : aucune erreur', () => {
    proto.animate = undefined;
    const { rerender } = render(<Liste cles={['a', 'b']} />);
    expect(() => rerender(<Liste cles={['n', 'a', 'b']} />)).not.toThrow();
  });

  it('une entrée change d’état seule (la liste ne se redessine pas) : les autres glissent quand même', async () => {
    render(<ListeAutonome />);
    expect(animer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'retirer a' }));
    await act(async () => undefined); // laisse passer l'observation du DOM
    const images = animer.mock.calls.map(([i]) => i as Record<string, string>[]);
    // b remonte de 100 px : elle part 100 px plus bas.
    expect(images).toEqual([[{ transform: 'translate(0px, 100px)' }, { transform: 'none' }]]);
  });

  it('le conteneur apparaît après coup (liste d’abord vide) : il est suivi dès qu’il est là', async () => {
    function Apres({ montrer, cles }: { montrer: boolean; cles: string[] }) {
      const ref = useGlisse<HTMLUListElement>();
      return montrer ? (
        <ul ref={ref}>
          {cles.map((c) => (
            <li key={c} data-glisse={c}>
              {c}
            </li>
          ))}
        </ul>
      ) : null;
    }
    const { rerender } = render(<Apres montrer={false} cles={[]} />);
    rerender(<Apres montrer cles={['a', 'b']} />);
    expect(animer).not.toHaveBeenCalled(); // premier affichage de la liste
    rerender(<Apres montrer cles={['n', 'a', 'b']} />);
    expect(animer).toHaveBeenCalled(); // la liste est bien suivie
  });

  it('la liste disparaît puis revient : c’est un nouveau premier affichage, rien ne glisse depuis l’ancienne', () => {
    function Revient({ montrer, cles }: { montrer: boolean; cles: string[] }) {
      const ref = useGlisse<HTMLUListElement>();
      return montrer ? (
        <ul ref={ref}>
          {cles.map((c) => (
            <li key={c} data-glisse={c}>
              {c}
            </li>
          ))}
        </ul>
      ) : null;
    }
    const { rerender } = render(<Revient montrer cles={['a', 'b', 'c']} />);
    rerender(<Revient montrer={false} cles={[]} />);
    rerender(<Revient montrer cles={['c', 'a']} />);
    expect(animer).not.toHaveBeenCalled();
  });

  it('liste vide au départ : la première entrée apparaît sans animation (rien à comparer)', () => {
    const { rerender } = render(<Liste cles={[]} />);
    rerender(<Liste cles={['a']} />);
    expect(animer).not.toHaveBeenCalled();
  });
});
