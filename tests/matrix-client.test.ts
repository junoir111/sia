import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emetteur } from './faux-matrix';

/** Texte réel de l'erreur du chiffrement quand la réserve de clés est celle d'un AUTRE appareil. */
const ERREUR_AUTRE_RESERVE =
  "the account in the store doesn't match the account in the constructor: expected @a:sia:A, got @b:sia:B";

const faux = vi.hoisted(() => ({
  clients: [] as unknown[],
  options: [] as unknown[],
  echecsInit: 0,
  bloque: false,
  erreurInit: '',
}));

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
            throw new Error(faux.erreurInit);
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

import { ClientEvent, HttpApiEvent, MatrixScheduler, SyncState } from 'matrix-js-sdk';
import { DELAI_REQUETE_MS } from '../src/matrix/envoi';
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
  faux.echecsInit = 0;
  faux.erreurInit = ERREUR_AUTRE_RESERVE;
  localStorage.clear();
});
afterEach(() => {
  arreterClient();
  vi.unstubAllGlobals();
});

/** Base IndexedDB simulée : note les réserves de clés qu'on efface. */
function fauxIndexedDB(): string[] {
  const supprimees: string[] = [];
  vi.stubGlobal('indexedDB', {
    deleteDatabase: (nom: string) => {
      supprimees.push(nom);
      const requete: { onsuccess?: () => void } = {};
      queueMicrotask(() => requete.onsuccess?.());
      return requete;
    },
  });
  return supprimees;
}

const RESERVE = 'sia-crypto::matrix-sdk-crypto';
const RESERVE_META = 'sia-crypto::matrix-sdk-crypto-meta';

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

  it('envoi fiable : file d’envoi par bulle et délai sur les requêtes ordinaires', async () => {
    const promesse = demarrerClient(SESSION);
    await pret();
    await promesse;
    const options = faux.options[0] as { scheduler: unknown; localTimeoutMs: number };
    expect(options.scheduler).toBeInstanceOf(MatrixScheduler);
    expect(options.localTimeoutMs).toBe(DELAI_REQUETE_MS);
  });

  it('réserve de clés d’un autre compte : effacée avant le démarrage, le propriétaire est noté', async () => {
    const supprimees = fauxIndexedDB();
    localStorage.setItem('sia.crypto-de', '@autre:sia|AUTRE');
    const promesse = demarrerClient(SESSION);
    await vi.waitFor(() => expect(dernier()?.initRustCrypto).toHaveBeenCalled());
    await pret();
    await promesse;
    expect(supprimees).toEqual([RESERVE, RESERVE_META]);
    expect(localStorage.getItem('sia.crypto-de')).toBe(`${SESSION.userId}|APP`);
  });

  it('le chiffrement dit que la réserve est celle d’un autre appareil : effacée, puis un seul réessai', async () => {
    const supprimees = fauxIndexedDB();
    faux.echecsInit = 1;
    const promesse = demarrerClient(SESSION);
    await pret();
    await promesse;
    expect(dernier().initRustCrypto).toHaveBeenCalledTimes(2);
    expect(supprimees).toEqual([RESERVE, RESERVE_META]);
  });

  it('une réserve sans propriétaire connu (anciennes versions) est gardée : ses clés sont peut-être les nôtres', async () => {
    const supprimees = fauxIndexedDB();
    const promesse = demarrerClient(SESSION);
    await pret();
    await promesse;
    expect(supprimees).toEqual([]);
    expect(localStorage.getItem('sia.crypto-de')).toBe(`${SESSION.userId}|APP`);
  });

  it('même appareil, échec inattendu du chiffrement : les clés ne sont JAMAIS effacées, le démarrage échoue', async () => {
    // Effacer les clés d'un appareil qui garde la même identité change ses clés sans que les autres le sachent :
    // leurs messages deviennent illisibles pour lui.
    const supprimees = fauxIndexedDB();
    localStorage.setItem('sia.crypto-de', `${SESSION.userId}|APP`);
    faux.echecsInit = 1;
    faux.erreurInit = 'out of memory';
    await expect(demarrerClient(SESSION)).rejects.toThrow('out of memory');
    expect(supprimees).toEqual([]);
    expect(dernier().initRustCrypto).toHaveBeenCalledTimes(1);
  });

  it('réserve de clés bloquée (init sans fin) : abandon après le délai, sans effacer les clés', async () => {
    const supprimees = fauxIndexedDB();
    localStorage.setItem('sia.crypto-de', `${SESSION.userId}|APP`);
    faux.bloque = true;
    vi.useFakeTimers();
    try {
      const promesse = demarrerClient(SESSION);
      const verdict = expect(promesse).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(25_000 + 100);
      await verdict;
      expect(supprimees).toEqual([]);
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
