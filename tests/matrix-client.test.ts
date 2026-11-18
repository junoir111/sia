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
      };
      faux.clients.push(client);
      faux.options.push(opts);
      return client;
    },
  };
});

import { ClientEvent, HttpApiEvent, SyncState } from 'matrix-js-sdk';
import { arreterClient, clientActif, demarrerClient } from '../src/matrix/client';

type Faux = {
  emit: (nom: string, ...a: unknown[]) => void;
  initRustCrypto: ReturnType<typeof vi.fn>;
  startClient: ReturnType<typeof vi.fn>;
  stopClient: ReturnType<typeof vi.fn>;
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
