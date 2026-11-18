import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIAS_MUR } from '../src/config';
import { AUTRE, MOI, MUR, evenement, fauxClient, salon } from './faux-matrix';

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

  function murAvecMesPublications() {
    return salon({
      roomId: MUR,
      appartenance: 'join',
      membres: {},
      etat: {},
      alias: ALIAS_MUR,
      evenements: [
        evenement({ type: 'io.sia.statut', id: '$s1', sender: MOI }),
        evenement({ type: 'io.sia.annonce', id: '$a1', sender: MOI }),
        evenement({ type: 'io.sia.annonce', id: '$a2', sender: AUTRE }),
        evenement({ type: 'io.sia.statut', id: '$s2', sender: AUTRE }),
      ],
    });
  }

  it('retire mon statut et ma demande du Mur AVANT d’annuler le jeton (et rien des autres)', async () => {
    const ordre: string[] = [];
    const c = fauxClient([murAvecMesPublications()]);
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
    await deconnecter(SESSION);
    expect(ordre.slice(-1)).toEqual(['jeton annulé']);
    expect(ordre.slice(0, -1).sort()).toEqual(['efface $a1', 'efface $s1']);
  });

  it('retire aussi la demande gardée par ce téléphone', async () => {
    const c = fauxClient([murAvecMesPublications()]);
    faux.client = c;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    localStorage.setItem(
      'sia.demande',
      JSON.stringify({
        eventId: '$garde',
        demande: {
          pseudo: 'puma',
          service: 'Plombier',
          zone: 'Akanda',
          texte: '',
          budget: 5000,
          fin: Date.now() + 3_600_000,
        },
      }),
    );
    await deconnecter(SESSION);
    const ids = c.redactEvent.mock.calls.map((a) => (a as unknown[])[1]);
    expect(ids).toContain('$garde');
  });

  it('n’attend pas plus de 5 s un Mur injoignable (hors-ligne), puis déconnecte quand même', async () => {
    vi.useFakeTimers();
    const c = fauxClient([murAvecMesPublications()]);
    c.redactEvent.mockImplementation(() => new Promise(() => undefined));
    faux.client = c;
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const fin = deconnecter(SESSION);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await fin;
    expect(fetch).toHaveBeenCalled();
  });
});
