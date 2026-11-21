import { describe, expect, it } from 'vitest';
import {
  chiffrerImage,
  dechiffrerImage,
  estFichierChiffre,
  type FichierChiffre,
} from '../src/matrix/piece-jointe';

const OCTETS = new Uint8Array(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
const IMAGE = new Blob([OCTETS], { type: 'image/jpeg' });

async function octetsDe(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('chiffrer / déchiffrer une image', () => {
  it('aller-retour : ce qui sort est exactement ce qui est entré', async () => {
    const { chiffre, file } = await chiffrerImage(IMAGE);
    const complet: FichierChiffre = { ...file, url: 'mxc://sia/abc' };
    const blob = await dechiffrerImage(complet, chiffre);
    expect(blob).not.toBeNull();
    expect(await octetsDe(blob as Blob)).toEqual(OCTETS);
    expect((blob as Blob).type).toBe('image/jpeg');
  });

  it('les octets chiffrés ne ressemblent pas à l’image en clair', async () => {
    const { chiffre } = await chiffrerImage(IMAGE);
    expect(chiffre.length).toBe(OCTETS.length);
    expect(chiffre).not.toEqual(OCTETS);
  });

  it('la clé et l’empreinte sont bien formées (format Matrix v2)', async () => {
    const { file } = await chiffrerImage(IMAGE);
    expect(file.v).toBe('v2');
    expect(file.key.alg).toBe('A256CTR');
    expect(file.key.k).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(file.iv).toMatch(/^[A-Za-z0-9+/]+$/);
    expect(file.hashes.sha256).toMatch(/^[A-Za-z0-9+/]+$/);
  });

  it('une image modifiée en route est refusée (empreinte différente)', async () => {
    const { chiffre, file } = await chiffrerImage(IMAGE);
    const abime = new Uint8Array(chiffre);
    abime[0] = (abime[0] ?? 0) ^ 1;
    expect(await dechiffrerImage({ ...file, url: 'mxc://sia/a' }, abime)).toBeNull();
  });

  it('une empreinte truquée est refusée', async () => {
    const { chiffre, file } = await chiffrerImage(IMAGE);
    const truque = { ...file, url: 'mxc://sia/a', hashes: { sha256: 'AAAA' } };
    expect(await dechiffrerImage(truque, chiffre)).toBeNull();
  });

  it('un mauvais format (clé ou version) rend null, sans planter', async () => {
    const { chiffre, file } = await chiffrerImage(IMAGE);
    expect(
      await dechiffrerImage({ ...file, url: 'mxc://sia/a', v: 'v1' as never }, chiffre),
    ).toBeNull();
    const cleCassee = { ...file, url: 'mxc://sia/a', key: { ...file.key, k: 'pas-une-cle' } };
    expect(await dechiffrerImage(cleCassee, chiffre)).toBeNull();
  });
});

describe('estFichierChiffre', () => {
  it('reconnaît un fichier chiffré valide', async () => {
    const { file } = await chiffrerImage(IMAGE);
    expect(estFichierChiffre({ ...file, url: 'mxc://sia/a' })).toBe(true);
  });

  it.each([
    null,
    'texte',
    {},
    { v: 'v2', url: 'mxc://a' },
    { v: 'v1', url: 'mxc://a', iv: 'x', key: {}, hashes: { sha256: 'h' } },
    { v: 'v2', url: 42, iv: 'x', key: {}, hashes: { sha256: 'h' } },
    { v: 'v2', url: 'mxc://a', iv: 'x', key: {}, hashes: {} },
  ])('refuse %s', (valeur) => {
    expect(estFichierChiffre(valeur)).toBe(false);
  });
});
