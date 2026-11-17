import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIAS_MUR } from '../src/config';
import { monStatutActif, nettoyerMesAnnonces, oublierMur, rejoindreMur } from '../src/matrix/mur';
import { AUTRE, MOI, MUR, comme, evenement, fauxClient, salon } from './faux-matrix';

const MAINTENANT = Date.UTC(2026, 10, 17, 10, 0, 0);
const HEURE = 3_600_000;
const STATUT = { pseudo: 'puma-35', metier: 'Plombier', zone: 'Akanda' };
const ANNONCE = {
  role: 'client',
  pseudo: 'palmier-48',
  service: 'Plombier',
  zone: 'Akanda',
  texte: 'Fuite',
  budget: 5000,
};

function ev(
  type: string,
  content: Record<string, unknown>,
  o: { id: string; sender?: string; ts?: number; redacted?: boolean },
) {
  return evenement({
    type,
    content,
    sender: o.sender ?? MOI,
    ts: o.ts ?? MAINTENANT - HEURE,
    ...o,
  });
}

function mur(evenements: ReturnType<typeof evenement>[]) {
  return salon({
    roomId: MUR,
    appartenance: 'join',
    membres: {},
    etat: {},
    evenements,
    alias: ALIAS_MUR,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MAINTENANT);
  oublierMur();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('nettoyerMesAnnonces', () => {
  it('efface seulement mes annonces et statuts expirés', async () => {
    const c = fauxClient([
      mur([
        ev('io.sia.annonce', { ...ANNONCE, fin: MAINTENANT - 1 }, { id: '$annonce-finie' }),
        ev('io.sia.annonce', { ...ANNONCE, fin: MAINTENANT + HEURE }, { id: '$annonce-active' }),
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT - 1 }, { id: '$statut-fini' }),
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT + HEURE }, { id: '$statut-actif' }),
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT - 1 }, { id: '$autre', sender: AUTRE }),
        ev('io.sia.statut', { fin: MAINTENANT - 1 }, { id: '$deja', redacted: true }),
        ev('m.room.message', { body: 'x', fin: 0 }, { id: '$message' }),
      ]),
    ]);

    await nettoyerMesAnnonces(comme(c));

    const effaces = c.redactEvent.mock.calls.map((a: unknown[]) => a[1]);
    expect(effaces.sort()).toEqual(['$annonce-finie', '$statut-fini']);
  });

  it('efface aussi les miens à fin illisible ou envoyés il y a plus de 24 h', async () => {
    const c = fauxClient([
      mur([
        ev('io.sia.statut', { ...STATUT, fin: 'demain' }, { id: '$illisible' }),
        ev('io.sia.annonce', { ...ANNONCE }, { id: '$sans-fin' }),
        ev(
          'io.sia.statut',
          { ...STATUT, fin: MAINTENANT + HEURE },
          { id: '$trop-vieux', ts: MAINTENANT - 25 * HEURE },
        ),
      ]),
    ]);

    await nettoyerMesAnnonces(comme(c));

    const effaces = c.redactEvent.mock.calls.map((a: unknown[]) => a[1]);
    expect(effaces.sort()).toEqual(['$illisible', '$sans-fin', '$trop-vieux']);
  });

  it('continue si un effacement est refusé et oublie le statut mémorisé effacé', async () => {
    localStorage.setItem('sia.statut', '$b');
    const c = fauxClient([
      mur([
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT - 1 }, { id: '$a' }),
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT - 1 }, { id: '$b' }),
      ]),
    ]);
    c.redactEvent.mockRejectedValueOnce(new Error('refusé'));

    await expect(nettoyerMesAnnonces(comme(c))).resolves.toBeUndefined();

    expect(c.redactEvent).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('sia.statut')).toBeNull();
  });

  it('remonte l’historique du Mur (pages bornées)', async () => {
    const c = fauxClient([mur([])]);
    c.paginateEventTimeline.mockResolvedValue(true as never);

    await nettoyerMesAnnonces(comme(c));

    expect(c.paginateEventTimeline).toHaveBeenCalledTimes(5);
  });
});

describe('monStatutActif', () => {
  it('rend mon statut valable le plus récent', async () => {
    const c = fauxClient([
      mur([
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT + HEURE }, { id: '$ancien' }),
        ev(
          'io.sia.statut',
          { ...STATUT, fin: MAINTENANT + 2 * HEURE, extra: 1 },
          { id: '$recent' },
        ),
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT + HEURE }, { id: '$x', sender: AUTRE }),
      ]),
    ]);
    await rejoindreMur(comme(c));

    expect(monStatutActif(comme(c))).toEqual({
      eventId: '$recent',
      statut: { ...STATUT, fin: MAINTENANT + 2 * HEURE },
    });
  });

  it('null si mon statut est expiré, effacé, invalide, ou sans Mur', () => {
    const c = fauxClient([
      mur([
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT - 1 }, { id: '$fini' }),
        ev('io.sia.statut', { ...STATUT, fin: MAINTENANT + HEURE }, { id: '$e', redacted: true }),
        ev(
          'io.sia.statut',
          { ...STATUT, pseudo: 'x'.repeat(500), fin: MAINTENANT + HEURE },
          {
            id: '$long',
          },
        ),
        ev(
          'io.sia.statut',
          { ...STATUT, fin: MAINTENANT + 30 * HEURE },
          { id: '$trop-loin', ts: MAINTENANT },
        ),
      ]),
    ]);
    expect(monStatutActif(comme(c))).toBeNull();
    expect(monStatutActif(comme(fauxClient([])))).toBeNull();
  });
});
