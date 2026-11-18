import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connecter, deconnecter, type Session } from '../src/matrix/auth';
import { enregistrerSession, lireSession } from '../src/matrix/session';

const URL_CONNEXION = 'https://sia.tail94dc60.ts.net/_matrix/client/v3/login';
const URL_DECONNEXION = 'https://sia.tail94dc60.ts.net/_matrix/client/v3/logout';
const MDP = 'un-mot-de-passe-long';
const CLES_LOCALES = [
  'sia.disponible',
  'sia.demande',
  'sia.a-effacer',
  'sia.statut',
  'sia.annuaire',
  'sia.appareils',
];
const SUCCES = {
  user_id: '@puma-35:sia.tail94dc60.ts.net',
  access_token: 'jeton-acces',
  device_id: 'APPAREIL1',
};
const SESSION: Session = {
  userId: SUCCES.user_id,
  accessToken: 'jeton-acces',
  deviceId: 'APPAREIL1',
};

function reponse(statut: number, corps: unknown): Response {
  const texte = typeof corps === 'string' ? corps : JSON.stringify(corps);
  return new Response(texte, { status: statut, headers: { 'Content-Type': 'application/json' } });
}

let faux: ReturnType<typeof vi.fn>;

beforeEach(() => {
  faux = vi.fn().mockRejectedValue(new Error('appel réseau non prévu'));
  vi.stubGlobal('fetch', faux);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('connecter', () => {
  it('envoie m.login.password avec m.id.user et rend la session', async () => {
    faux.mockResolvedValueOnce(reponse(200, SUCCES));

    const resultat = await connecter('puma-35', MDP);

    expect(resultat).toEqual({ ok: true, session: SESSION });
    expect(faux.mock.calls[0]?.[0]).toBe(URL_CONNEXION);
    const options = faux.mock.calls[0]?.[1] as RequestInit;
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: 'puma-35' },
      password: MDP,
      initial_device_display_name: 'SIA',
    });
  });

  it('403 M_FORBIDDEN : identifiants', async () => {
    faux.mockResolvedValueOnce(reponse(403, { errcode: 'M_FORBIDDEN', error: 'Invalid password' }));
    expect(await connecter('puma-35', MDP)).toEqual({ ok: false, erreur: 'identifiants' });
  });

  it('refuse sans appel réseau un identifiant ou un mot de passe hors limites', async () => {
    expect(await connecter('Puma 35', MDP)).toEqual({ ok: false, erreur: 'identifiants' });
    expect(await connecter('a'.repeat(300), MDP)).toEqual({ ok: false, erreur: 'identifiants' });
    expect(await connecter('puma-35', '')).toEqual({ ok: false, erreur: 'identifiants' });
    expect(await connecter('puma-35', 'x'.repeat(2000))).toEqual({
      ok: false,
      erreur: 'identifiants',
    });
    expect(faux).not.toHaveBeenCalled();
  });

  it('réseau coupé ou passerelle muette : reseau', async () => {
    faux.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await connecter('puma-35', MDP)).toEqual({ ok: false, erreur: 'reseau' });
    faux.mockResolvedValueOnce(reponse(502, 'Bad Gateway'));
    expect(await connecter('puma-35', MDP)).toEqual({ ok: false, erreur: 'reseau' });
  });

  it('autre erreur (403 sans M_FORBIDDEN) : inconnue (le 429 est testé dans auth.test.ts)', async () => {
    faux.mockResolvedValueOnce(reponse(403, { errcode: 'M_USER_DEACTIVATED' }));
    expect(await connecter('puma-35', MDP)).toEqual({ ok: false, erreur: 'inconnue' });
  });

  it.each([
    ['un autre serveur', { ...SUCCES, user_id: '@puma-35:matrix.org' }],
    ['un serveur qui finit pareil', { ...SUCCES, user_id: '@puma-35:faux-sia.tail94dc60.ts.net' }],
    ['sans @', { ...SUCCES, user_id: 'puma-35:sia.tail94dc60.ts.net' }],
    ['un jeton qui n’est pas un texte', { ...SUCCES, access_token: 42 }],
    ['un jeton vide', { ...SUCCES, access_token: '' }],
    ['un appareil trop long', { ...SUCCES, device_id: 'x'.repeat(2000) }],
    ['un tableau', [SUCCES]],
    ['du texte', 'pas du json'],
    ['une réponse énorme', { ...SUCCES, bourrage: 'x'.repeat(70_000) }],
  ])('réponse 200 refusée (%s) : inconnue', async (_cas, corps) => {
    faux.mockResolvedValueOnce(reponse(200, corps));
    expect(await connecter('puma-35', MDP)).toEqual({ ok: false, erreur: 'inconnue' });
  });

  it('ne garde pas les champs en trop de la réponse', async () => {
    faux.mockResolvedValueOnce(reponse(200, { ...SUCCES, refresh_token: 'r', well_known: {} }));
    const resultat = await connecter('puma-35', MDP);
    expect(resultat.ok && Object.keys(resultat.session).sort()).toEqual([
      'accessToken',
      'deviceId',
      'userId',
    ]);
  });
});

function fauxIndexedDB() {
  const effacees: string[] = [];
  return {
    effacees,
    deleteDatabase: (nom: string) => {
      effacees.push(nom);
      const demande: { onsuccess?: () => void } = {};
      queueMicrotask(() => demande.onsuccess?.());
      return demande;
    },
  };
}

describe('deconnecter', () => {
  it('annule le jeton puis efface session, clés locales et bases de chiffrement', async () => {
    faux.mockResolvedValueOnce(reponse(200, {}));
    const base = fauxIndexedDB();
    vi.stubGlobal('indexedDB', base);
    enregistrerSession(SESSION);
    for (const cle of CLES_LOCALES) localStorage.setItem(cle, 'x');
    localStorage.setItem('autre.appli', 'garde');

    await deconnecter(SESSION);

    expect(faux.mock.calls[0]?.[0]).toBe(URL_DECONNEXION);
    const options = faux.mock.calls[0]?.[1] as RequestInit;
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer jeton-acces');
    expect(lireSession()).toBeNull();
    for (const cle of CLES_LOCALES) expect(localStorage.getItem(cle)).toBeNull();
    expect(localStorage.getItem('autre.appli')).toBe('garde');
    expect(base.effacees).toEqual([
      'sia-crypto::matrix-sdk-crypto',
      'sia-crypto::matrix-sdk-crypto-meta',
    ]);
  });

  it('ne plante pas si le réseau, le stockage et IndexedDB échouent', async () => {
    faux.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('indexedDB', {
      deleteDatabase: () => {
        throw new Error('indisponible');
      },
      open: () => {
        throw new Error('indisponible');
      },
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('stockage plein');
    });

    await expect(deconnecter(SESSION)).resolves.toBeUndefined();
  });

  it('n’envoie pas une session illisible au serveur mais efface quand même', async () => {
    vi.stubGlobal('indexedDB', fauxIndexedDB());
    enregistrerSession(SESSION);

    await deconnecter({ userId: '', accessToken: '', deviceId: '' });

    expect(faux).not.toHaveBeenCalled();
    expect(lireSession()).toBeNull();
  });
});
