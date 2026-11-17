import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfilPrestataire } from '../src/logique/profil';
import { enregistrerProfil, lireProfil, TYPE_PROFIL } from '../src/matrix/profil';

// Le vrai nettoyerProfil est testé à part (src/logique) : ici on vérifie seulement qu'il est appelé.
vi.mock('../src/logique/profil', () => ({
  nettoyerProfil: (valeur: unknown) =>
    typeof valeur === 'object' &&
    valeur !== null &&
    (valeur as Record<string, unknown>).role === 'prestataire'
      ? { ...(valeur as object) }
      : null,
}));

const SESSION = {
  userId: '@puma-35:sia.tail94dc60.ts.net',
  accessToken: 'jeton-acces',
  deviceId: 'APPAREIL1',
};
const URL_ATTENDUE =
  'https://sia.tail94dc60.ts.net/_matrix/client/v3/user/%40puma-35%3Asia.tail94dc60.ts.net/account_data/io.sia.profile';
const PROFIL: ProfilPrestataire = {
  version: 1,
  role: 'prestataire',
  pseudo: 'Puma',
  metier: 'Coiffure',
  zone: 'Akanda',
  modalite: 'les-deux',
  services: [{ label: 'Tresses', prix: 5000 }],
};

function reponse(statut: number, corps: unknown): Response {
  const texte = typeof corps === 'string' ? corps : JSON.stringify(corps);
  return new Response(texte, { status: statut });
}

let faux: ReturnType<typeof vi.fn>;

beforeEach(() => {
  faux = vi.fn().mockRejectedValue(new Error('appel réseau non prévu'));
  vi.stubGlobal('fetch', faux);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function options(appel = 0): RequestInit {
  return faux.mock.calls[appel]?.[1] as RequestInit;
}

describe('lireProfil', () => {
  it('lit la donnée de compte io.sia.profile avec le jeton', async () => {
    faux.mockResolvedValueOnce(reponse(200, PROFIL));

    const resultat = await lireProfil(SESSION);

    expect(TYPE_PROFIL).toBe('io.sia.profile');
    expect(resultat).toEqual({ ok: true, profil: PROFIL });
    expect(faux.mock.calls[0]?.[0]).toBe(URL_ATTENDUE);
    expect(options().method).toBe('GET');
    expect(options().headers).toEqual({ Authorization: 'Bearer jeton-acces' });
    expect(options().signal).toBeInstanceOf(AbortSignal);
  });

  it('renvoie un profil vide si le serveur répond 404 M_NOT_FOUND', async () => {
    faux.mockResolvedValueOnce(reponse(404, { errcode: 'M_NOT_FOUND' }));
    expect(await lireProfil(SESSION)).toEqual({ ok: true, profil: null });
  });

  it('renvoie un profil vide si la donnée est mal formée', async () => {
    faux.mockResolvedValueOnce(reponse(200, { role: 'pirate' }));
    expect(await lireProfil(SESSION)).toEqual({ ok: true, profil: null });
  });

  it('renvoie un profil vide si la réponse n’est pas du JSON objet', async () => {
    faux.mockResolvedValueOnce(reponse(200, 'pas du json'));
    expect(await lireProfil(SESSION)).toEqual({ ok: true, profil: null });
    faux.mockResolvedValueOnce(reponse(200, [PROFIL]));
    expect(await lireProfil(SESSION)).toEqual({ ok: true, profil: null });
  });

  it('ignore une réponse trop grosse', async () => {
    faux.mockResolvedValueOnce(reponse(200, { ...PROFIL, bourrage: 'x'.repeat(70 * 1024) }));
    expect(await lireProfil(SESSION)).toEqual({ ok: true, profil: null });
  });

  it('signale une session expirée (401 M_UNKNOWN_TOKEN)', async () => {
    faux.mockResolvedValueOnce(reponse(401, { errcode: 'M_UNKNOWN_TOKEN' }));
    expect(await lireProfil(SESSION)).toEqual({ ok: false, erreur: 'session' });
  });

  it('signale un problème réseau (exception ou 502 sans corps)', async () => {
    faux.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await lireProfil(SESSION)).toEqual({ ok: false, erreur: 'reseau' });
    faux.mockResolvedValueOnce(reponse(502, ''));
    expect(await lireProfil(SESSION)).toEqual({ ok: false, erreur: 'reseau' });
  });

  it('renvoie « inconnue » pour une autre erreur (404 sans M_NOT_FOUND, 403...)', async () => {
    faux.mockResolvedValueOnce(reponse(404, ''));
    expect(await lireProfil(SESSION)).toEqual({ ok: false, erreur: 'inconnue' });
    faux.mockResolvedValueOnce(reponse(403, { errcode: 'M_FORBIDDEN' }));
    expect(await lireProfil(SESSION)).toEqual({ ok: false, erreur: 'inconnue' });
  });
});

describe('enregistrerProfil', () => {
  it('envoie le profil nettoyé en PUT', async () => {
    faux.mockResolvedValueOnce(reponse(200, {}));

    const resultat = await enregistrerProfil(SESSION, PROFIL);

    expect(resultat).toEqual({ ok: true });
    expect(faux.mock.calls[0]?.[0]).toBe(URL_ATTENDUE);
    expect(options().method).toBe('PUT');
    expect(options().headers).toEqual({
      Authorization: 'Bearer jeton-acces',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(options().body as string)).toEqual(PROFIL);
  });

  it('n’envoie rien si le profil est invalide', async () => {
    const invalide = { ...PROFIL, role: 'client' } as unknown as ProfilPrestataire;
    expect(await enregistrerProfil(SESSION, invalide)).toEqual({ ok: false, erreur: 'inconnue' });
    expect(faux).not.toHaveBeenCalled();
  });

  it('traduit les erreurs du serveur', async () => {
    faux.mockResolvedValueOnce(reponse(401, { errcode: 'M_UNKNOWN_TOKEN' }));
    expect(await enregistrerProfil(SESSION, PROFIL)).toEqual({ ok: false, erreur: 'session' });
    faux.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await enregistrerProfil(SESSION, PROFIL)).toEqual({ ok: false, erreur: 'reseau' });
    faux.mockResolvedValueOnce(reponse(400, { errcode: 'M_BAD_JSON' }));
    expect(await enregistrerProfil(SESSION, PROFIL)).toEqual({ ok: false, erreur: 'inconnue' });
  });
});
