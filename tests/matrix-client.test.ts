import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emetteur } from './faux-matrix';

const faux = vi.hoisted(() => ({ clients: [] as unknown[], options: [] as unknown[], echecsInit: 0, bloque: false }));

vi.mock('matrix-js-sdk', async (original) => {
  const vrai = await original<typeof import('matrix-js-sdk')>();
  return {
    ...vrai,
    createClient: (opts: Record<string, unknown>) => {
      const e = emetteur();
      const client = {
        on: e.on,
        off: e.off,
        emit: e.emit,
        getUserId: () => opts.userId,
        getDeviceId: () => opts.deviceId,
        initRustCrypto: vi.fn(async () => {
          if (faux.bloque) await new Promise(() => undefined);
          if (faux.echecsInit > 0) {
            faux.echecsInit -= 1;
            throw new Error('account in the store does not match');
          }
        }),
        startClient: vi.fn(async () => undefined),
        stopClient: vi.fn(),
        retryImmediately: vi.fn(() => false),
        getSyncState: vi.fn(() => 'SYNCING'),
      };
      faux.clients.push(client);
      faux.options.push(opts);
      return client;
    },
  };
});

import { ClientEvent, HttpApiEvent, SyncState } from 'matrix-js-sdk';
import {
  PAUSE_RECHARGEMENT_MS,
  arreterClient,
  clientActif,
  demarrerClient,
  rechargerAppli,
} from '../src/matrix/client';

type Faux = {
  emit: (nom: string, ...a: unknown[]) => void;
  initRustCrypto: ReturnType<typeof vi.fn>;
  startClient: ReturnType<typeof vi.fn>;
  stopClient: ReturnType<typeof vi.fn>;
  retryImmediately: ReturnType<typeof vi.fn>;
};

const SESSION = { userId: '@puma:sia.tail94dc60.ts.net', accessToken: 'jeton', deviceId: 'APP' };

function dernier(): Faux {
  return faux.clients.at(-1) as Faux;
}

async function pret(): Promise<void> {
  await vi.waitFor(() => expect(dernier()?.startClient).toHaveBeenCalled());
  dernier().emit(ClientEvent.Sync, SyncState.Prepared);
}

beforeEach(() => {
  faux.clients.length = 0;
  faux.options.length = 0;
  localStorage.clear();
});
afterEach(() => arreterClient());

describe('demarrerClient', () => {
  it('crée un seul client, chiffrement Rust en IndexedDB, puis attend le premier sync', async () => {
    const promesse = demarrerClient(SESSION);
    await pret();
    const c = await promesse;
    expect(faux.options[0]).toMatchObject({
      baseUrl: 'https://sia.tail94dc60.ts.net',
      accessToken: 'jeton',
      userId: SESSION.userId,
      deviceId: 'APP',
    });
    expect(dernier().initRustCrypto).toHaveBeenCalledWith({
      useIndexedDB: true,
      cryptoDatabasePrefix: 'sia-crypto',
    });
    expect(dernier().startClient).toHaveBeenCalledWith({
      initialSyncLimit: 20,
      lazyLoadMembers: true,
    });
    expect(clientActif()).toBe(c);
    expect(await demarrerClient(SESSION)).toBe(c);
    expect(faux.clients).toHaveLength(1);
  });

  it('réserve de clés d’un autre compte : init raté une fois, réserve effacée, puis réessai', async () => {
    localStorage.setItem('sia.crypto-de', '@autre:sia|AUTRE');
    const promesse = demarrerClient(SESSION);
    await vi.waitFor(() => expect(dernier()?.initRustCrypto).toHaveBeenCalled());
    await pret();
    await promesse;
    expect(localStorage.getItem('sia.crypto-de')).toBe(`${SESSION.userId}|APP`);
  });

  it('chiffrement qui échoue la 1re fois : la réserve est effacée et on réessaie une fois', async () => {
    faux.echecsInit = 1;
    const promesse = demarrerClient(SESSION);
    await pret();
    await promesse;
    expect(dernier().initRustCrypto).toHaveBeenCalledTimes(2);
  });

  it('réserve de clés bloquée (init sans fin) : abandon après le délai, le démarrage échoue', async () => {
    faux.bloque = true;
    vi.useFakeTimers();
    try {
      const promesse = demarrerClient(SESSION);
      const verdict = expect(promesse).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(2 * 25_000 + 100);
      await verdict;
    } finally {
      faux.bloque = false;
      vi.useRealTimers();
    }
  });

  it('donne un journal muet au SDK', async () => {
    const promesse = demarrerClient(SESSION);
    await pret();
    await promesse;
    const journal = (faux.options[0] as { logger: Record<string, (...a: unknown[]) => unknown> })
      .logger;
    const espion = vi.spyOn(console, 'error');
    journal.error?.('secret');
    expect(espion).not.toHaveBeenCalled();
  });

  it('rejette une session invalide sans rien créer', async () => {
    await expect(demarrerClient({ ...SESSION, accessToken: '' })).rejects.toThrow();
    expect(faux.clients).toHaveLength(0);
  });

  it('rejette et arrête le client si le serveur refuse le jeton', async () => {
    const promesse = demarrerClient(SESSION);
    await vi.waitFor(() => expect(dernier()?.startClient).toHaveBeenCalled());
    dernier().emit(HttpApiEvent.SessionLoggedOut, { errcode: 'M_UNKNOWN_TOKEN' });
    await expect(promesse).rejects.toMatchObject({ errcode: 'M_UNKNOWN_TOKEN' });
    expect(dernier().stopClient).toHaveBeenCalled();
    expect(clientActif()).toBeNull();
  });

  it('arreterClient arrête la synchronisation', async () => {
    const promesse = demarrerClient(SESSION);
    await pret();
    await promesse;
    arreterClient();
    expect(dernier().stopClient).toHaveBeenCalled();
    expect(clientActif()).toBeNull();
  });

  it("une autre session pendant un démarrage : l'ancien client n'est jamais rendu, il est arrêté", async () => {
    const autre = { ...SESSION, userId: '@lion:sia.tail94dc60.ts.net', deviceId: 'APP2' };
    const premier = demarrerClient(SESSION);
    await vi.waitFor(() => expect(faux.clients).toHaveLength(1));
    const ancien = dernier();
    await vi.waitFor(() => expect(ancien.startClient).toHaveBeenCalled());
    const second = demarrerClient(autre);
    await vi.waitFor(() => expect(faux.clients).toHaveLength(2));
    const nouveau = dernier();
    ancien.emit(ClientEvent.Sync, SyncState.Prepared);
    await expect(premier).rejects.toThrow();
    expect(ancien.stopClient).toHaveBeenCalled();
    expect(clientActif()).toBeNull();
    await vi.waitFor(() => expect(nouveau.startClient).toHaveBeenCalled());
    nouveau.emit(ClientEvent.Sync, SyncState.Prepared);
    const c = await second;
    expect(c.getUserId()).toBe(autre.userId);
    expect(clientActif()).toBe(c);
    expect(nouveau.stopClient).not.toHaveBeenCalled();
  });

  it('même session demandée deux fois pendant le démarrage : un seul client', async () => {
    const a = demarrerClient(SESSION);
    const b = demarrerClient(SESSION);
    await pret();
    expect(await a).toBe(await b);
    expect(faux.clients).toHaveLength(1);
  });
});

describe('réveil rapide du client démarré', () => {
  async function demarre(): Promise<Faux> {
    const promesse = demarrerClient(SESSION);
    await pret();
    await promesse;
    return dernier();
  }

  it('le retour de l’appli (resume, page visible, réseau) relance la synchro ; arrêté, plus rien', async () => {
    const c = await demarre();
    document.dispatchEvent(new Event('resume'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(c.retryImmediately).toHaveBeenCalledTimes(3);
    arreterClient();
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('online'));
    expect(c.retryImmediately).toHaveBeenCalledTimes(3);
  });

  it('un client jamais devenu actif (démarrage annulé) n’est pas surveillé', async () => {
    const autre = { ...SESSION, userId: '@lion:sia.tail94dc60.ts.net', deviceId: 'APP2' };
    const premier = demarrerClient(SESSION);
    await vi.waitFor(() => expect(dernier()?.startClient).toHaveBeenCalled());
    const ancien = dernier();
    const second = demarrerClient(autre);
    await vi.waitFor(() => expect(faux.clients).toHaveLength(2));
    ancien.emit(ClientEvent.Sync, SyncState.Prepared);
    await expect(premier).rejects.toThrow();
    document.dispatchEvent(new Event('resume'));
    expect(ancien.retryImmediately).not.toHaveBeenCalled();
    const nouveau = dernier();
    await vi.waitFor(() => expect(nouveau.startClient).toHaveBeenCalled());
    nouveau.emit(ClientEvent.Sync, SyncState.Prepared);
    await second;
    document.dispatchEvent(new Event('resume'));
    expect(nouveau.retryImmediately).toHaveBeenCalledTimes(1);
    expect(ancien.retryImmediately).not.toHaveBeenCalled();
  });

  it('le client reçoit un fetch qui laisse passer les requêtes ordinaires', async () => {
    const reponse = new Response('{}');
    const reseau = vi.fn(async () => reponse);
    vi.stubGlobal('fetch', reseau);
    try {
      await demarre();
      const { fetchFn } = faux.options[0] as { fetchFn: typeof fetch };
      const url = 'https://sia.tail94dc60.ts.net/_matrix/client/v3/keys/query';
      await expect(fetchFn(url, { method: 'POST' })).resolves.toBe(reponse);
      expect(reseau).toHaveBeenCalledWith(url, { method: 'POST' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('rechargerAppli (dernier recours du chien de garde)', () => {
  const recharger = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    recharger.mockClear();
    vi.stubGlobal('location', { ...window.location, reload: recharger });
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 18, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('recharge la page, mais au plus une fois toutes les 5 minutes (pas de boucle)', () => {
    rechargerAppli();
    expect(recharger).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PAUSE_RECHARGEMENT_MS - 1000);
    rechargerAppli();
    expect(recharger).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    rechargerAppli();
    expect(recharger).toHaveBeenCalledTimes(2);
  });

  it('une valeur illisible dans le stockage n’empêche pas de recharger, et rien ne remonte', () => {
    sessionStorage.setItem('sia.rechargement', 'pas un nombre');
    expect(() => rechargerAppli()).not.toThrow();
    expect(recharger).toHaveBeenCalledTimes(1);
    recharger.mockImplementation(() => {
      throw new Error('pas de page');
    });
    vi.advanceTimersByTime(PAUSE_RECHARGEMENT_MS + 1000);
    expect(() => rechargerAppli()).not.toThrow();
  });
});
