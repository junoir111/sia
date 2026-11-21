import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { chargerPhoto } from '../src/matrix/bulles';
import { chiffrerImage, type FichierChiffre } from '../src/matrix/piece-jointe';

const client = {
  mxcUrlToHttp: () => 'https://sia.tail94dc60.ts.net/media',
  getAccessToken: () => 'jeton',
} as unknown as MatrixClient;

function reponse(octets: Uint8Array, tailleAnnoncee = octets.length, ok = true) {
  return {
    ok,
    headers: { get: (nom: string) => (nom === 'content-length' ? String(tailleAnnoncee) : null) },
    arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength),
  };
}

afterEach(() => vi.restoreAllMocks());

async function paquet(): Promise<{ chiffre: Uint8Array; file: FichierChiffre }> {
  const image = new Blob([new Uint8Array(3000).fill(7)], { type: 'image/jpeg' });
  const { chiffre, file } = await chiffrerImage(image);
  return { chiffre, file: { ...file, url: 'mxc://sia.tail94dc60.ts.net/abc' } };
}

describe('chargerPhoto', () => {
  it('télécharge, vérifie et déchiffre une photo normale', async () => {
    const { chiffre, file } = await paquet();
    vi.stubGlobal('fetch', vi.fn(async () => reponse(chiffre)));
    const blob = await chargerPhoto(client, file);
    expect(blob).not.toBeNull();
    expect((blob as Blob).type).toBe('image/jpeg');
  });

  it('refuse un paquet trop gros annoncé par l’en-tête (sans lire le corps)', async () => {
    const { file } = await paquet();
    const arrayBuffer = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => String(50 * 1024 * 1024) },
        arrayBuffer,
      })),
    );
    expect(await chargerPhoto(client, file)).toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('refuse un paquet trop gros même si l’en-tête ment', async () => {
    const { file } = await paquet();
    const enorme = new Uint8Array(11 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn(async () => reponse(enorme, 1000)));
    expect(await chargerPhoto(client, file)).toBeNull();
  });

  it('réponse serveur en échec : null, sans planter', async () => {
    const { chiffre, file } = await paquet();
    vi.stubGlobal('fetch', vi.fn(async () => reponse(chiffre, chiffre.length, false)));
    expect(await chargerPhoto(client, file)).toBeNull();
  });

  it('un fichier mal formé n’est même pas téléchargé', async () => {
    const fetchEspion = vi.fn();
    vi.stubGlobal('fetch', fetchEspion);
    expect(await chargerPhoto(client, { url: 'mxc://x' } as never)).toBeNull();
    expect(fetchEspion).not.toHaveBeenCalled();
  });
});
