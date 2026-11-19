import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushNatif } from '../src/appareil/push-natif';
import { comme, fauxClient } from './faux-matrix';

const faux = vi.hoisted(() => ({ natif: null as unknown }));
vi.mock('../src/appareil/push-natif', () => ({ pushNatif: () => faux.natif }));
vi.mock('../src/matrix/mur', () => ({ rejoindreMur: vi.fn(async () => '!mur:sia.tail94dc60.ts.net') }));

import {
  arreterNotifications,
  lancerNotifications,
  reglerNotificationDemandes,
  statutNotifications,
} from '../src/matrix/notifications';

const JETON = 'fcm-jeton-1:APA91bHexemple_de_jeton_de_notification';
const ADRESSE_PASSERELLE = 'https://sia.tail94dc60.ts.net:8444/_matrix/push/v1/notify';

function fauxNatif(etat: { jeton: string | null }, statut = 'ok') {
  const ecouteurs: Record<string, (d?: unknown) => void> = {};
  const natif = {
    etat: vi.fn(async () => ({ disponible: true, ...etat })),
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
  const addPushRule = vi.fn(async () => ({}));
  const deletePushRule = vi.fn(async () => ({}));
  return {
    c: comme(Object.assign(c, { setPusher, addPushRule, deletePushRule }) as never),
    setPusher,
    addPushRule,
    deletePushRule,
  };
}

beforeEach(() => {
  localStorage.clear();
  faux.natif = null;
});

describe('notifications push (Firebase)', () => {
  it('ne fait rien hors Android (plugin absent)', async () => {
    const { c, setPusher } = client();
    expect(await lancerNotifications(c)).toBe('inactif');
    expect(setPusher).not.toHaveBeenCalled();
  });

  it('enregistre le pusher event_id_only avec le jeton reçu (aucun texte dans le signal)', async () => {
    const { natif, ecouteurs } = fauxNatif({ jeton: null });
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    await lancerNotifications(c);
    expect(natif.activer).toHaveBeenCalled();
    ecouteurs.jeton?.({ jeton: JETON });
    await vi.waitFor(() => expect(setPusher).toHaveBeenCalledTimes(1));
    expect(setPusher).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'http',
        app_id: 'io.github.junoir111.sia',
        pushkey: JETON,
        data: { url: ADRESSE_PASSERELLE, format: 'event_id_only' },
      }),
    );
    await vi.waitFor(() => expect(statutNotifications()).toBe('actif'));
  });

  it('republie le pusher si un jeton était déjà reçu, et retire l’ancien s’il change', async () => {
    localStorage.setItem('sia.pushkey', 'ancien-jeton');
    const { natif } = fauxNatif({ jeton: JETON });
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    await lancerNotifications(c);
    expect(setPusher).toHaveBeenCalledTimes(2);
    expect(setPusher).toHaveBeenLastCalledWith({
      kind: null,
      app_id: 'io.github.junoir111.sia',
      pushkey: 'ancien-jeton',
    });
    expect(localStorage.getItem('sia.pushkey')).toBe(JETON);
  });

  it('signale un téléphone sans services Google, sans rien casser', async () => {
    const { natif } = fauxNatif({ jeton: null }, 'indisponible');
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    expect(await lancerNotifications(c)).toBe('indisponible');
    expect(setPusher).not.toHaveBeenCalled();
  });

  it('retire le pusher et éteint Firebase à la déconnexion', async () => {
    localStorage.setItem('sia.pushkey', JETON);
    const { natif } = fauxNatif({ jeton: JETON });
    faux.natif = natif as unknown as PushNatif;
    const { c, setPusher } = client();
    await arreterNotifications(c);
    expect(setPusher).toHaveBeenCalledWith({
      kind: null,
      app_id: 'io.github.junoir111.sia',
      pushkey: JETON,
    });
    expect(natif.desactiver).toHaveBeenCalled();
    expect(localStorage.getItem('sia.pushkey')).toBeNull();
    expect(statutNotifications()).toBe('inactif');
  });

  it('n’attend pas plus de 5 s un serveur qui ne répond pas', async () => {
    vi.useFakeTimers();
    localStorage.setItem('sia.pushkey', JETON);
    const { natif } = fauxNatif({ jeton: JETON });
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

describe('notification des demandes (prestataire disponible)', () => {
  it('disponible : une règle prévient d’une demande de client posée sur le Mur, et de rien d’autre', async () => {
    const { c, addPushRule } = client();
    await reglerNotificationDemandes(c, true);
    expect(addPushRule).toHaveBeenCalledWith('global', 'override', 'sia.demandes', {
      conditions: [
        { kind: 'event_match', key: 'type', pattern: 'io.sia.annonce' },
        { kind: 'event_match', key: 'room_id', pattern: '!mur:sia.tail94dc60.ts.net' },
      ],
      actions: ['notify'],
    });
  });

  it('plus disponible : la règle est retirée', async () => {
    const { c, addPushRule, deletePushRule } = client();
    await reglerNotificationDemandes(c, false);
    expect(deletePushRule).toHaveBeenCalledWith('global', 'override', 'sia.demandes');
    expect(addPushRule).not.toHaveBeenCalled();
  });

  it('une règle déjà absente ou un serveur injoignable ne fait jamais échouer', async () => {
    const { c, addPushRule, deletePushRule } = client();
    deletePushRule.mockRejectedValue({ httpStatus: 404 });
    addPushRule.mockRejectedValue(new TypeError('réseau'));
    await expect(reglerNotificationDemandes(c, false)).resolves.toBeUndefined();
    await expect(reglerNotificationDemandes(c, true)).resolves.toBeUndefined();
  });

  it('à l’ouverture, la règle suit la disponibilité gardée sur le téléphone', async () => {
    const { natif } = fauxNatif({ jeton: JETON });
    faux.natif = natif as unknown as PushNatif;
    localStorage.setItem('sia.disponible', 'oui');
    const { c, addPushRule } = client();
    await lancerNotifications(c);
    await vi.waitFor(() => expect(addPushRule).toHaveBeenCalledTimes(1));
  });

  it('à l’ouverture, un client (pas disponible) ne reçoit aucune notification de demande', async () => {
    const { natif } = fauxNatif({ jeton: JETON });
    faux.natif = natif as unknown as PushNatif;
    const { c, addPushRule, deletePushRule } = client();
    await lancerNotifications(c);
    await vi.waitFor(() => expect(deletePushRule).toHaveBeenCalledTimes(1));
    expect(addPushRule).not.toHaveBeenCalled();
  });
});
