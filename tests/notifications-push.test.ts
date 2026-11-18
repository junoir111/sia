import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushNatif } from '../src/appareil/push-natif';
import { comme, fauxClient } from './faux-matrix';

const faux = vi.hoisted(() => ({ natif: null as unknown }));
vi.mock('../src/appareil/push-natif', () => ({ pushNatif: () => faux.natif }));

import {
  arreterNotifications,
  lancerNotifications,
  statutNotifications,
} from '../src/matrix/notifications';

const ENDPOINT = 'https://sia.tail94dc60.ts.net:8443/upAbc123?up=1';

function fauxNatif(etat: { endpoint: string | null }, statut = 'ok') {
  const ecouteurs: Record<string, (d?: unknown) => void> = {};
  const natif = {
    etat: vi.fn(async () => ({ distributeurs: ['ntfy'], distributeur: 'ntfy', ...etat })),
    activer: vi.fn(async () => ({ statut })),
    desactiver: vi.fn(async () => undefined),
    addListener: vi.fn(async (nom: string, action: (d?: unknown) => void) => {
      ecouteurs[nom] = action;
      return { remove: async () => undefined };
    }),
  };
  return { natif, ecouteurs };
}

function client() {
  const c = fauxClient([]);
  const setPusher = vi.fn(async () => ({}));
  return { c: comme(Object.assign(c, { setPusher }) as never), setPusher };
}

beforeEach(() => {
  localStorage.clear();
  faux.natif = null;
});

describe('notifications push', () => {
  it('ne fait rien hors Android (plugin absent)', async () => {
    const { c, setPusher } = client();
    expect(await lancerNotifications(c)).toBe('inactif');
    expect(setPusher).not.toHaveBeenCalled();
  });

  it('enregistre le pusher event_id_only avec l’adresse reçue', async () => {
    const { natif, ecouteurs } = fauxNatif({ endpoint: null });
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    await lancerNotifications(c);
    expect(natif.activer).toHaveBeenCalled();
    ecouteurs.endpoint?.({ endpoint: ENDPOINT });
    await vi.waitFor(() => expect(setPusher).toHaveBeenCalledTimes(1));
    expect(setPusher).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'http',
        app_id: 'io.github.junoir111.sia',
        pushkey: ENDPOINT,
        data: {
          url: 'https://sia.tail94dc60.ts.net:8443/_matrix/push/v1/notify',
          format: 'event_id_only',
        },
      }),
    );
    await vi.waitFor(() => expect(statutNotifications()).toBe('actif'));
  });

  it('republie le pusher si une adresse était déjà reçue, et retire l’ancienne si elle change', async () => {
    localStorage.setItem('sia.pushkey', 'https://ancienne/up1?up=1');
    const { natif } = fauxNatif({ endpoint: ENDPOINT });
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    await lancerNotifications(c);
    expect(setPusher).toHaveBeenCalledTimes(2);
    expect(setPusher).toHaveBeenLastCalledWith({
      kind: null,
      app_id: 'io.github.junoir111.sia',
      pushkey: 'https://ancienne/up1?up=1',
    });
    expect(localStorage.getItem('sia.pushkey')).toBe(ENDPOINT);
  });

  it('signale l’absence de distributeur sans rien casser', async () => {
    const { natif } = fauxNatif({ endpoint: null }, 'sans-distributeur');
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    expect(await lancerNotifications(c)).toBe('sans-distributeur');
    expect(setPusher).not.toHaveBeenCalled();
  });

  it('retire le pusher et se désinscrit à la déconnexion', async () => {
    localStorage.setItem('sia.pushkey', ENDPOINT);
    const { natif } = fauxNatif({ endpoint: ENDPOINT });
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    await arreterNotifications(c);
    expect(setPusher).toHaveBeenCalledWith({
      kind: null,
      app_id: 'io.github.junoir111.sia',
      pushkey: ENDPOINT,
    });
    expect(natif.desactiver).toHaveBeenCalled();
    expect(localStorage.getItem('sia.pushkey')).toBeNull();
    expect(statutNotifications()).toBe('inactif');
  });

  it('n’attend pas plus de 5 s un serveur qui ne répond pas', async () => {
    vi.useFakeTimers();
    localStorage.setItem('sia.pushkey', ENDPOINT);
    const { natif } = fauxNatif({ endpoint: ENDPOINT });
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    setPusher.mockImplementation(() => new Promise(() => undefined));
    const fin = arreterNotifications(c);
    await vi.advanceTimersByTimeAsync(5_000);
    await fin;
    expect(natif.desactiver).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
