import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfilClient } from '../src/logique/profil-client';
import { enregistrerProfilClient, lireProfil, lireProfilClient } from '../src/matrix/profil';

const SESSION = { userId: '@palmier:sia.tail94dc60.ts.net', accessToken: 'jeton', deviceId: 'APP' };
const PROFIL: ProfilClient = { version: 1, role: 'client', pseudo: 'palmier-48', zone: 'Akanda' };

function reponse(statut: number, corps: unknown): Response {
  return new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), {
    status: statut,
  });
}

let faux: ReturnType<typeof vi.fn>;

beforeEach(() => {
  faux = vi.fn().mockRejectedValue(new Error('appel réseau non prévu'));
  vi.stubGlobal('fetch', faux);
});
afterEach(() => vi.unstubAllGlobals());

describe('lireProfilClient', () => {
  it('lit un profil client et retire les champs en trop', async () => {
    faux.mockResolvedValueOnce(reponse(200, { ...PROFIL, photo: 'x', metier: 'y' }));
    expect(await lireProfilClient(SESSION)).toEqual({ ok: true, profil: PROFIL });
  });

  it('rend null pour un profil prestataire, mal formé ou absent', async () => {
    faux.mockResolvedValueOnce(reponse(200, { ...PROFIL, role: 'prestataire' }));
    expect(await lireProfilClient(SESSION)).toEqual({ ok: true, profil: null });
    faux.mockResolvedValueOnce(reponse(200, { ...PROFIL, pseudo: 'x'.repeat(31) }));
    expect(await lireProfilClient(SESSION)).toEqual({ ok: true, profil: null });
    faux.mockResolvedValueOnce(reponse(404, { errcode: 'M_NOT_FOUND' }));
    expect(await lireProfilClient(SESSION)).toEqual({ ok: true, profil: null });
  });

  it("un profil client n'est pas lu comme profil prestataire", async () => {
    faux.mockResolvedValueOnce(reponse(200, PROFIL));
    expect(await lireProfil(SESSION)).toEqual({ ok: true, profil: null });
  });

  it('traduit les erreurs', async () => {
    faux.mockResolvedValueOnce(reponse(401, { errcode: 'M_UNKNOWN_TOKEN' }));
    expect(await lireProfilClient(SESSION)).toEqual({ ok: false, erreur: 'session' });
    expect(await lireProfilClient(SESSION)).toEqual({ ok: false, erreur: 'reseau' });
  });
});

describe('enregistrerProfilClient', () => {
  it('envoie seulement version, role, pseudo et zone', async () => {
    faux.mockResolvedValueOnce(reponse(200, {}));
    const avecPhoto = { ...PROFIL, photo: 'secret' } as ProfilClient;
    expect(await enregistrerProfilClient(SESSION, avecPhoto)).toEqual({ ok: true });
    const options = faux.mock.calls[0]?.[1] as RequestInit;
    expect(options.method).toBe('PUT');
    expect(JSON.parse(String(options.body))).toEqual(PROFIL);
  });

  it("n'envoie rien si le profil est invalide", async () => {
    const r = await enregistrerProfilClient(SESSION, { ...PROFIL, zone: '' });
    expect(r).toEqual({ ok: false, erreur: 'inconnue' });
    expect(faux).not.toHaveBeenCalled();
  });
});
