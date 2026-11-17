import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fauxClient } from './faux-matrix';

const faux = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../src/matrix/client', () => ({
  PREFIXE_BASE_CRYPTO: 'sia-crypto',
  clientActif: () => faux.client,
  arreterClient: vi.fn(),
}));

import { deconnecter, type Session } from '../src/matrix/auth';

const SESSION: Session = {
  userId: '@puma:sia.tail94dc60.ts.net',
  accessToken: 'jeton',
  deviceId: 'APP',
};
const BULLE = '!b1:sia.tail94dc60.ts.net';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('indexedDB', {
    deleteDatabase: () => {
      const d: { onsuccess?: () => void } = {};
      queueMicrotask(() => d.onsuccess?.());
      return d;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('deconnecter : effacements en attente', () => {
  it('efface tout de suite les messages en file AVANT d’annuler le jeton', async () => {
    const ordre: string[] = [];
    const c = fauxClient([]);
    c.redactEvent.mockImplementation((async (_r: string, id: string) => {
      ordre.push(`efface ${id}`);
      return { event_id: '$x' };
    }) as () => Promise<{ event_id: string }>);
    faux.client = c;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        ordre.push('jeton annulé');
        return new Response('{}', { status: 200 });
      }),
    );
    localStorage.setItem(
      'sia.a-effacer',
      JSON.stringify([
        { roomId: BULLE, eventId: '$m1', echeance: Date.now() + 50_000 },
        { roomId: BULLE, eventId: '$m2', echeance: Date.now() + 50_000 },
      ]),
    );
    localStorage.setItem('sia.annuaire', '[]');
    localStorage.setItem('sia.appareils', '{}');

    await deconnecter(SESSION);

    expect(ordre).toEqual(['efface $m1', 'efface $m2', 'jeton annulé']);
    expect(localStorage.getItem('sia.a-effacer')).toBeNull();
    expect(localStorage.getItem('sia.annuaire')).toBeNull();
    expect(localStorage.getItem('sia.appareils')).toBeNull();
  });

  it('n’attend pas plus de 10 s un serveur muet', async () => {
    vi.useFakeTimers();
    const c = fauxClient([]);
    c.redactEvent.mockImplementation(() => new Promise(() => undefined));
    faux.client = c;
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    localStorage.setItem(
      'sia.a-effacer',
      JSON.stringify([{ roomId: BULLE, eventId: '$m1', echeance: Date.now() }]),
    );

    const fin = deconnecter(SESSION);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await fin;
    expect(fetch).toHaveBeenCalled();
  });
});
