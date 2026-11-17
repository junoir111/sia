import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ecrireDisponible, lireDisponible } from '../src/appareil/disponible';
import { effacerPhoto, enregistrerPhoto, lirePhoto, preparerPhoto } from '../src/appareil/photo';

/*
 * Petit faux IndexedDB (fake-indexeddb n'est pas installé) : juste ce que photo.ts utilise
 * — open, onupgradeneeded, createObjectStore, transaction, put/get/delete, oncomplete.
 */
type Demande = {
  result: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
};

function fauxIndexedDb() {
  const magasins = new Map<string, Map<string, unknown>>();
  const ouvertures: string[] = [];
  const fabrique = {
    open(nom: string, version: number) {
      ouvertures.push(`${nom}@${version}`);
      const demande: Demande = {
        result: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      const base = {
        objectStoreNames: { contains: (n: string) => magasins.has(n) },
        createObjectStore: (n: string) => magasins.set(n, new Map()),
        close: vi.fn(),
        transaction(nomMagasin: string) {
          const contenu = magasins.get(nomMagasin);
          if (!contenu) throw new Error('magasin absent');
          const transaction = {
            oncomplete: null as (() => void) | null,
            onerror: null,
            onabort: null,
          };
          const terminer = (resultat: unknown) => {
            const requete = { result: resultat };
            queueMicrotask(() => transaction.oncomplete?.());
            return requete;
          };
          return Object.assign(transaction, {
            objectStore: () => ({
              put: (valeur: unknown, cle: string) => terminer(contenu.set(cle, valeur) && cle),
              get: (cle: string) => terminer(contenu.get(cle)),
              delete: (cle: string) => terminer(contenu.delete(cle) && undefined),
            }),
          });
        },
      };
      demande.result = base;
      queueMicrotask(() => {
        if (!magasins.size) demande.onupgradeneeded?.();
        demande.onsuccess?.();
      });
      return demande;
    },
  };
  return { fabrique, magasins, ouvertures };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('photo du profil (IndexedDB)', () => {
  let faux: ReturnType<typeof fauxIndexedDb>;
  beforeEach(() => {
    faux = fauxIndexedDb();
    vi.stubGlobal('indexedDB', faux.fabrique);
  });

  it('enregistre, relit puis efface la photo dans sia / photos / profil', async () => {
    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });

    await enregistrerPhoto(photo);
    expect(faux.ouvertures[0]).toBe('sia@1');
    expect(faux.magasins.get('photos')?.get('profil')).toBe(photo);
    expect(await lirePhoto()).toBe(photo);

    await effacerPhoto();
    expect(await lirePhoto()).toBeNull();
  });

  it('ne rend pas une valeur gardée qui n’est pas une image', async () => {
    await effacerPhoto();
    faux.magasins.get('photos')?.set('profil', 'pas une image');
    expect(await lirePhoto()).toBeNull();
    faux.magasins.get('photos')?.set('profil', new Blob(['<script>'], { type: 'text/html' }));
    expect(await lirePhoto()).toBeNull();
  });

  it('refuse d’enregistrer autre chose qu’une image', async () => {
    await expect(enregistrerPhoto(new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow(
      'pas une image',
    );
  });
});

describe('preparerPhoto', () => {
  function simulerImage(largeur: number, hauteur: number) {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: largeur, height: hauteur, close }),
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      rappel,
    ) {
      rappel(new Blob([`${this.width}x${this.height}`], { type: 'image/jpeg' }));
    });
    return { close, drawImage, toBlob };
  }

  it('réduit à 1024 px au plus et réencode en JPEG qualité 0,7', async () => {
    const { close, drawImage, toBlob } = simulerImage(4000, 3000);

    const resultat = await preparerPhoto(new File(['x'], 'p.png', { type: 'image/png' }));

    expect(resultat.type).toBe('image/jpeg');
    expect(await resultat.text()).toBe('1024x768');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 768);
    expect(toBlob.mock.calls[0]?.slice(1)).toEqual(['image/jpeg', 0.7]);
    expect(close).toHaveBeenCalled();
  });

  it('n’agrandit pas une petite image', async () => {
    simulerImage(300, 500);
    const resultat = await preparerPhoto(new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
    expect(await resultat.text()).toBe('300x500');
  });

  it('refuse un fichier qui n’est pas une image, vide ou trop lourd', async () => {
    await expect(preparerPhoto(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(
      'pas une image',
    );
    await expect(preparerPhoto(new File([], 'v.jpg', { type: 'image/jpeg' }))).rejects.toThrow(
      'trop lourde',
    );
    const lourd = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'l.jpg', { type: 'image/jpeg' });
    await expect(preparerPhoto(lourd)).rejects.toThrow('trop lourde');
  });

  it('refuse une image illisible', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('décodage')));
    await expect(preparerPhoto(new File(['x'], 'p.jpg', { type: 'image/jpeg' }))).rejects.toThrow(
      'illisible',
    );
  });
});

describe('disponible (provisoire)', () => {
  it('vaut faux par défaut, puis garde le choix', () => {
    expect(lireDisponible()).toBe(false);
    ecrireDisponible(true);
    expect(lireDisponible()).toBe(true);
    ecrireDisponible(false);
    expect(lireDisponible()).toBe(false);
  });

  it('vaut faux si le stockage est inaccessible ou contient autre chose', () => {
    localStorage.setItem('sia.disponible', 'peut-être');
    expect(lireDisponible()).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    expect(lireDisponible()).toBe(false);
  });
});
