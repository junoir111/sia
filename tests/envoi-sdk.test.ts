import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, MsgType, type MatrixClient } from 'matrix-js-sdk';
import { DELAI_REQUETE_MS, creerPlanificateur } from '../src/matrix/envoi';

/*
 * Le VRAI client Matrix (matrix-js-sdk), seulement le réseau est simulé. Vérifie le comportement vu en vrai sur un
 * téléphone à la connexion capricieuse : avec la file d'envoi d'origine du SDK (une seule file pour tout, aucun nouvel
 * essai après une coupure, rien qui coupe une requête muette), un seul accroc faisait échouer le message en cours ET tous
 * ceux qui attendaient derrière, effacements compris.
 */

const SALON_A = '!aaa:sia.tail94dc60.ts.net';
const SALON_B = '!bbb:sia.tail94dc60.ts.net';

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

function urlDe(requete: RequestInfo | URL): string {
  return typeof requete === 'string' ? requete : requete instanceof URL ? requete.href : requete.url;
}

type Reseau = (url: string, options: RequestInit) => Promise<Response>;

function clientAvec(reseau: Reseau): MatrixClient {
  const fetchFn = (requete: RequestInfo | URL, options?: RequestInit): Promise<Response> =>
    reseau(urlDe(requete), options ?? {});
  return createClient({
    baseUrl: 'https://sia.tail94dc60.ts.net',
    accessToken: 'jeton',
    userId: '@moi:sia.tail94dc60.ts.net',
    deviceId: 'APP',
    fetchFn: fetchFn as typeof globalThis.fetch,
    scheduler: creerPlanificateur(),
    localTimeoutMs: DELAI_REQUETE_MS,
  });
}

const texte = (corps: string) => ({ msgtype: MsgType.Text, body: corps }) as const;

/** Requête qui ne répond jamais, sauf si on la coupe. */
function muette(options: RequestInit): Promise<Response> {
  return new Promise<Response>((_, rejeter) => {
    options.signal?.addEventListener('abort', () =>
      rejeter(new DOMException('coupée', 'AbortError')),
    );
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('envoi des messages avec le vrai client Matrix', () => {
  it('coupure du réseau : le message est renvoyé tout seul, avec le même identifiant d’envoi', async () => {
    const urls: string[] = [];
    const reseau: Reseau = async (url) => {
      urls.push(url);
      if (urls.length === 1) throw new TypeError('Failed to fetch');
      return json({ event_id: '$ok' });
    };
    const c = clientAvec(reseau);
    const reponse = await c.sendMessage(SALON_A, texte('salut'));
    expect(reponse.event_id).toBe('$ok');
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe(urls[0]);
    expect(urls[0]).toContain(`/rooms/${encodeURIComponent(SALON_A)}/send/m.room.message/`);
  });

  it('requête qui ne répond jamais : coupée après le délai, puis renvoyée', async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const reseau: Reseau = (url, options) => {
      urls.push(url);
      return urls.length === 1 ? muette(options) : Promise.resolve(json({ event_id: '$ok' }));
    };
    const c = clientAvec(reseau);
    const envoi = c.sendMessage(SALON_A, texte('coucou'));
    await vi.advanceTimersByTimeAsync(DELAI_REQUETE_MS - 100);
    expect(urls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(envoi).resolves.toMatchObject({ event_id: '$ok' });
    expect(urls).toHaveLength(2);
  });

  it('refus définitif (403) : le message échoue tout de suite, sans renvoi', async () => {
    const reseau = vi.fn<Reseau>(async () =>
      json({ errcode: 'M_FORBIDDEN', error: 'pas dans la bulle' }, 403),
    );
    const c = clientAvec(reseau);
    await expect(c.sendMessage(SALON_A, texte('non'))).rejects.toMatchObject({ httpStatus: 403 });
    expect(reseau).toHaveBeenCalledTimes(1);
  });

  it('abandon après le nombre maximal d’envois quand le réseau reste coupé', async () => {
    vi.useFakeTimers();
    const reseau = vi.fn<Reseau>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const c = clientAvec(reseau);
    const envoi = c.sendMessage(SALON_A, texte('perdu'));
    const verdict = expect(envoi).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(60_000);
    await verdict;
    expect(reseau).toHaveBeenCalledTimes(5);
  });

  it('l’échec d’une bulle ne fait pas échouer les messages de l’autre bulle', async () => {
    let finirA: (r: Response) => void = () => undefined;
    const reseau = vi.fn<Reseau>((url) => {
      if (url.includes(encodeURIComponent(SALON_A))) {
        return new Promise<Response>((fini) => (finirA = fini));
      }
      return Promise.resolve(json({ event_id: '$b' }));
    });
    const c = clientAvec(reseau);
    const envoiA = c.sendMessage(SALON_A, texte('dans A'));
    const verdictA = expect(envoiA).rejects.toMatchObject({ httpStatus: 403 });
    const envoiB = c.sendMessage(SALON_B, texte('dans B'));
    // B part et aboutit pendant que A attend encore sa réponse.
    await expect(envoiB).resolves.toMatchObject({ event_id: '$b' });
    finirA(json({ errcode: 'M_FORBIDDEN', error: 'non' }, 403));
    await verdictA;
  });

  it('un message bloqué n’empêche pas d’effacer (les effacements ne font pas la queue)', async () => {
    const vus: string[] = [];
    const reseau: Reseau = (url, options) => {
      vus.push(`${options.method ?? 'GET'} ${new URL(url).pathname}`);
      if (url.includes('/send/m.room.message/')) return muette(options);
      return Promise.resolve(json({ event_id: '$efface' }));
    };
    const c = clientAvec(reseau);
    const bloque = c.sendMessage(SALON_A, texte('coincé'));
    bloque.catch(() => undefined);
    await vi.waitFor(() => expect(vus.some((v) => v.includes('/send/'))).toBe(true));
    await expect(c.redactEvent(SALON_A, '$ancien:sia')).resolves.toMatchObject({
      event_id: '$efface',
    });
    expect(vus.some((v) => v.includes('/redact/'))).toBe(true);
    c.stopClient();
  });

  it('les messages d’une même bulle partent dans l’ordre, le suivant attend la réponse du précédent', async () => {
    const corps: string[] = [];
    const finis: Array<(r: Response) => void> = [];
    const reseau: Reseau = (_url, options) => {
      corps.push((JSON.parse(String(options.body)) as { body: string }).body);
      return new Promise<Response>((fini) => finis.push(fini));
    };
    const c = clientAvec(reseau);
    const un = c.sendMessage(SALON_A, texte('un'));
    const deux = c.sendMessage(SALON_A, texte('deux'));
    await vi.waitFor(() => expect(corps).toEqual(['un']));
    finis[0]?.(json({ event_id: '$1' }));
    await un;
    await vi.waitFor(() => expect(corps).toEqual(['un', 'deux']));
    finis[1]?.(json({ event_id: '$2' }));
    await expect(deux).resolves.toMatchObject({ event_id: '$2' });
  });
});
