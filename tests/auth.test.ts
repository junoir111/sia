import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerCompte } from '../src/matrix/auth';

const ID = 'puma-35';
const MDP = 'un-mot-de-passe-long';
const CODE = 'code-essai-123';
const URL_ATTENDUE = 'https://sia.tail94dc60.ts.net/_matrix/client/v3/register?kind=user';

const DEFI = {
  session: 'sess-1',
  flows: [{ stages: ['m.login.registration_token'] }],
  params: {},
};
const SUCCES = {
  user_id: '@puma-35:sia.tail94dc60.ts.net',
  access_token: 'jeton-acces',
  device_id: 'APPAREIL1',
};

function reponse(statut: number, corps: unknown): Response {
  const texte = typeof corps === 'string' ? corps : JSON.stringify(corps);
  return new Response(texte, { status: statut, headers: { 'Content-Type': 'application/json' } });
}

let faux: ReturnType<typeof vi.fn>;

function simuler(...reponses: Array<Response | Error>): void {
  for (const r of reponses) {
    if (r instanceof Error) faux.mockRejectedValueOnce(r);
    else faux.mockResolvedValueOnce(r);
  }
}

function corpsEnvoye(appel: number): Record<string, unknown> {
  const options = faux.mock.calls[appel]?.[1] as RequestInit;
  return JSON.parse(options.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  faux = vi.fn().mockRejectedValue(new Error('appel réseau non prévu'));
  vi.stubGlobal('fetch', faux);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('creerCompte', () => {
  it('crée le compte avec le jeton d’invitation et renvoie la session', async () => {
    simuler(reponse(401, DEFI), reponse(200, SUCCES));

    const resultat = await creerCompte(ID, MDP, CODE);

    expect(resultat).toEqual({
      ok: true,
      session: { userId: SUCCES.user_id, accessToken: 'jeton-acces', deviceId: 'APPAREIL1' },
    });
    expect(faux).toHaveBeenCalledTimes(2);
    expect(faux.mock.calls[0]?.[0]).toBe(URL_ATTENDUE);
    expect(corpsEnvoye(0)).toEqual({
      username: ID,
      password: MDP,
      initial_device_display_name: 'SIA',
      inhibit_login: false,
    });
    expect(corpsEnvoye(1).auth).toEqual({
      type: 'm.login.registration_token',
      token: CODE,
      session: 'sess-1',
    });
  });

  it('enchaîne l’étape vide si le serveur la demande après le jeton', async () => {
    const flux = [{ stages: ['m.login.registration_token', 'm.login.dummy'] }];
    simuler(
      reponse(401, { session: 's', flows: flux }),
      reponse(401, { session: 's', flows: flux, completed: ['m.login.registration_token'] }),
      reponse(200, SUCCES),
    );

    const resultat = await creerCompte(ID, MDP, CODE);

    expect(resultat.ok).toBe(true);
    expect(corpsEnvoye(2).auth).toEqual({ type: 'm.login.dummy', session: 's' });
  });

  it('code refusé : 401 sans l’étape jeton terminée', async () => {
    simuler(reponse(401, DEFI), reponse(401, { ...DEFI, errcode: 'M_FORBIDDEN', completed: [] }));
    expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'code-invalide' });
  });

  it('code refusé : 403 M_FORBIDDEN sur l’étape jeton', async () => {
    simuler(reponse(401, DEFI), reponse(403, { errcode: 'M_FORBIDDEN', error: 'non' }));
    expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'code-invalide' });
  });

  it('M_FORBIDDEN avant l’envoi du jeton (inscriptions fermées) : inconnue', async () => {
    simuler(reponse(403, { errcode: 'M_FORBIDDEN' }));
    expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'inconnue' });
  });

  it.each([
    ['M_USER_IN_USE', 'identifiant-pris'],
    ['M_INVALID_USERNAME', 'identifiant-invalide'],
    ['M_WEAK_PASSWORD', 'mot-de-passe-faible'],
    ['M_LIMIT_EXCEEDED', 'inconnue'],
  ])('traduit %s en %s', async (errcode, attendu) => {
    simuler(reponse(400, { errcode, error: 'détail' }));
    expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: attendu });
  });

  it('traduit aussi les erreurs reçues après l’envoi du jeton', async () => {
    simuler(reponse(401, DEFI), reponse(400, { errcode: 'M_USER_IN_USE' }));
    expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'identifiant-pris' });
  });

  it('coupure réseau : reseau', async () => {
    simuler(new TypeError('Failed to fetch'));
    expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'reseau' });
  });

  it('coupure réseau pendant l’étape jeton : reseau', async () => {
    simuler(reponse(401, DEFI), new TypeError('Failed to fetch'));
    expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'reseau' });
  });

  it('serveur injoignable derrière le tunnel (502 sans JSON) : reseau', async () => {
    simuler(reponse(502, 'Bad Gateway'));
    expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'reseau' });
  });

  describe('réponses mal formées : inconnue', () => {
    const cas: Array<[string, unknown]> = [
      ['texte non JSON', 'pas du json'],
      ['tableau', []],
      ['session absente', { flows: DEFI.flows }],
      ['session non texte', { session: 42, flows: DEFI.flows }],
      ['session trop longue', { session: 'x'.repeat(256), flows: DEFI.flows }],
      ['flows non tableau', { session: 's', flows: 'non' }],
      ['stages non textes', { session: 's', flows: [{ stages: [1] }] }],
      ['completed non tableau', { session: 's', flows: DEFI.flows, completed: 'x' }],
      ['aucun flux avec jeton', { session: 's', flows: [{ stages: ['m.login.email.identity'] }] }],
      [
        'flux avec étape inconnue',
        { session: 's', flows: [{ stages: ['m.login.registration_token', 'm.login.recaptcha'] }] },
      ],
    ];
    it.each(cas)('défi : %s', async (_nom, corps) => {
      simuler(reponse(401, corps));
      expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'inconnue' });
    });

    const succes: Array<[string, unknown]> = [
      ['texte non JSON', '{'],
      ['user_id absent', { ...SUCCES, user_id: undefined }],
      ['user_id non texte', { ...SUCCES, user_id: 7 }],
      ['user_id sans @', { ...SUCCES, user_id: 'puma-35:sia.tail94dc60.ts.net' }],
      ['user_id d’un autre serveur', { ...SUCCES, user_id: '@puma-35:matrix.org' }],
      ['user_id trop long', { ...SUCCES, user_id: `@${'a'.repeat(300)}:sia.tail94dc60.ts.net` }],
      ['access_token vide', { ...SUCCES, access_token: '' }],
      ['access_token trop long', { ...SUCCES, access_token: 'x'.repeat(2000) }],
      ['device_id objet', { ...SUCCES, device_id: {} }],
    ];
    it.each(succes)('succès : %s', async (_nom, corps) => {
      simuler(reponse(401, DEFI), reponse(200, corps));
      expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'inconnue' });
    });

    it('réponse énorme', async () => {
      simuler(reponse(401, { ...DEFI, bourrage: 'x'.repeat(70_000) }));
      expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'inconnue' });
    });

    it('serveur qui redemande sans fin : s’arrête', async () => {
      const boucle = {
        session: 's',
        flows: [{ stages: ['m.login.dummy', 'm.login.registration_token'] }],
      };
      faux.mockImplementation(() =>
        Promise.resolve(reponse(401, { ...boucle, completed: ['m.login.registration_token'] })),
      );
      expect(await creerCompte(ID, MDP, CODE)).toEqual({ ok: false, erreur: 'inconnue' });
      expect(faux.mock.calls.length).toBeLessThanOrEqual(5);
    });
  });

  describe('saisie refusée avant tout appel réseau', () => {
    it.each([
      ['', MDP, CODE, 'identifiant-invalide'],
      ['Puma', MDP, CODE, 'identifiant-invalide'],
      ['@puma:sia.tail94dc60.ts.net', MDP, CODE, 'identifiant-invalide'],
      ['a'.repeat(300), MDP, CODE, 'identifiant-invalide'],
      [ID, 'court', CODE, 'mot-de-passe-faible'],
      [ID, '123456789', CODE, 'mot-de-passe-faible'],
      [ID, MDP, '', 'code-invalide'],
      [ID, MDP, 'code avec espace', 'code-invalide'],
      [ID, MDP, 'x'.repeat(65), 'code-invalide'],
    ])('%s / %s / %s → %s', async (identifiant, motDePasse, code, attendu) => {
      expect(await creerCompte(identifiant, motDePasse, code)).toEqual({
        ok: false,
        erreur: attendu,
      });
      expect(faux).not.toHaveBeenCalled();
    });
  });

  it('n’écrit jamais dans la console', async () => {
    const espions = (['log', 'info', 'warn', 'error', 'debug'] as const).map((n) =>
      vi.spyOn(console, n),
    );
    simuler(reponse(401, DEFI), reponse(401, { ...DEFI, errcode: 'M_FORBIDDEN' }));
    await creerCompte(ID, MDP, CODE);
    for (const espion of espions) expect(espion).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
