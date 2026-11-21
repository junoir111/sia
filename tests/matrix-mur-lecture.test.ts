import { RoomEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIAS_MUR } from '../src/config';
import {
  ecouterMur,
  lireDemandes,
  lireStatuts,
  nettoyerStatut,
  oublierMur,
  publierStatut,
} from '../src/matrix/mur';
import { AUTRE, MUR, comme, evenement, fauxClient, salon } from './faux-matrix';

const MAINTENANT = Date.UTC(2026, 10, 18, 10, 0, 0);
const HEURE = 3_600_000;
const TIERS = '@tiers:sia.tail94dc60.ts.net';

type Evenement = ReturnType<typeof evenement>;

function statut(contenu: Record<string, unknown>, sender: string, ts: number, id: string) {
  return evenement({ type: 'io.sia.statut', content: contenu, sender, ts, id });
}

function base(pseudo: string, extra: Record<string, unknown> = {}) {
  return { pseudo, metier: 'Plombier', zone: 'Akanda', fin: MAINTENANT + HEURE, ...extra };
}

function annonce(pseudo: string, sender: string, ts: number, id: string, extra = {}) {
  return evenement({
    type: 'io.sia.annonce',
    sender,
    ts,
    id,
    content: {
      role: 'client',
      pseudo,
      service: 'Plombier',
      zone: 'Akanda',
      texte: 'Fuite',
      budget: 5000,
      fin: MAINTENANT + HEURE,
      ...extra,
    },
  });
}

function mur(evenements: Evenement[]) {
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
  vi.useFakeTimers();
  vi.setSystemTime(MAINTENANT);
  oublierMur();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('nettoyerStatut avec services', () => {
  it('garde 3 services au plus, bien formés, et refuse le reste', () => {
    const s = (services: unknown) => nettoyerStatut(base('puma', { services }), MAINTENANT);
    const ok = [{ label: 'Fuite', prix: 5000 }];
    expect(s(ok)?.services).toEqual(ok);
    expect(s(undefined)).toEqual(base('puma'));
    expect(s([])).toEqual(base('puma'));
    expect(s([ok[0], ok[0], ok[0], ok[0]])).toBeNull();
    expect(s('x')).toBeNull();
    expect(s([{ label: 'x'.repeat(41), prix: 5 }])).toBeNull();
    expect(s([{ label: 'Fuite', prix: 0 }])).toBeNull();
    expect(s([{ label: 'Fuite', prix: 1.5 }])).toBeNull();
    expect(s([{ label: 'Fuite', prix: '5' }])).toBeNull();
    expect(s([{ label: 'Fuite', prix: 100_000_001 }])).toBeNull();
    expect(s([null])).toBeNull();
  });
});

describe('publierStatut avec services', () => {
  it('publie les services indicatifs et retire les champs inconnus', async () => {
    const c = fauxClient([mur([])]);
    await publierStatut(
      comme(c),
      base('puma', {
        services: [{ label: 'Fuite', prix: 5000, secret: 'x' }],
        photo: 'x',
      }) as never,
    );
    expect(c.sendEvent).toHaveBeenCalledWith(MUR, 'io.sia.statut', {
      ...base('puma'),
      services: [{ label: 'Fuite', prix: 5000 }],
    });
  });
});

describe('lireStatuts', () => {
  it('rend un seul statut par personne : le plus récent, avec ses services', async () => {
    const c = fauxClient([
      mur([
        statut(base('puma', { metier: 'Maçon' }), AUTRE, MAINTENANT - 2 * HEURE, '$a1'),
        statut(
          base('puma', { services: [{ label: 'Mur', prix: 20000 }] }),
          AUTRE,
          MAINTENANT - HEURE,
          '$a2',
        ),
        statut(base('lion'), TIERS, MAINTENANT - HEURE, '$t1'),
      ]),
    ]);
    const r = await lireStatuts(comme(c));
    expect(r).toEqual([
      {
        eventId: '$a2',
        userId: AUTRE,
        pseudo: 'puma',
        metier: 'Plombier',
        zone: 'Akanda',
        fin: MAINTENANT + HEURE,
        services: [{ label: 'Mur', prix: 20000 }],
      },
      {
        eventId: '$t1',
        userId: TIERS,
        pseudo: 'lion',
        metier: 'Plombier',
        zone: 'Akanda',
        fin: MAINTENANT + HEURE,
      },
    ]);
  });

  it("ignore l'expiré, l'invalide et un statut éteint (même si un ancien existe encore)", async () => {
    const eteint = evenement({
      type: 'io.sia.statut',
      content: {},
      sender: AUTRE,
      ts: MAINTENANT - HEURE,
      id: '$a2',
      redacted: true,
    });
    const c = fauxClient([
      mur([
        statut(base('puma'), AUTRE, MAINTENANT - 2 * HEURE, '$a1'),
        eteint,
        statut(base('vieux', { fin: MAINTENANT - 1 }), TIERS, MAINTENANT - 3 * HEURE, '$t1'),
        statut(base('x'.repeat(31)), '@q:sia.tail94dc60.ts.net', MAINTENANT, '$q1'),
        statut(
          base('trop', { fin: MAINTENANT + 30 * HEURE }),
          '@r:sia.tail94dc60.ts.net',
          MAINTENANT,
          '$r1',
        ),
        statut({ ...base('bof'), fin: 'demain' }, '@s:sia.tail94dc60.ts.net', MAINTENANT, '$s1'),
      ]),
    ]);
    expect(await lireStatuts(comme(c))).toEqual([]);
  });

  it('ignore un événement de statut de la mauvaise forme (état, sans auteur valable)', async () => {
    const etat = evenement({
      type: 'io.sia.statut',
      content: base('etat'),
      sender: AUTRE,
      stateKey: '',
      id: '$e1',
    });
    const c = fauxClient([mur([etat, statut(base('mal'), 'pas-un-id', MAINTENANT, '$m1')])]);
    expect(await lireStatuts(comme(c))).toEqual([]);
  });

  it('le premier arrivé garde le pseudo : un autre compte avec le même pseudo est ignoré', async () => {
    const c = fauxClient([
      mur([
        statut(base('Puma'), AUTRE, MAINTENANT - 2 * HEURE, '$a1'),
        statut(base('puma'), TIERS, MAINTENANT - HEURE, '$t1'),
      ]),
    ]);
    const r = await lireStatuts(comme(c));
    expect(r.map((e) => e.userId)).toEqual([AUTRE]);
  });
});

describe('lireDemandes', () => {
  it('rend la demande valable la plus récente de chaque personne, au format EntreeDemande', async () => {
    const c = fauxClient([
      mur([
        annonce('palmier', AUTRE, MAINTENANT - 90 * 60_000, '$d1', { service: 'Maçon' }),
        annonce('palmier', AUTRE, MAINTENANT - 30 * 60_000, '$d2'),
        annonce('baobab', TIERS, MAINTENANT - 10 * 60_000, '$d3', { texte: '' }),
      ]),
    ]);
    expect(await lireDemandes(comme(c))).toEqual([
      {
        eventId: '$d2',
        userId: AUTRE,
        pseudo: 'palmier',
        service: 'Plombier',
        zone: 'Akanda',
        texte: 'Fuite',
        budget: 5000,
        fin: MAINTENANT + HEURE,
        creeLe: MAINTENANT - 30 * 60_000,
      },
      {
        eventId: '$d3',
        userId: TIERS,
        pseudo: 'baobab',
        service: 'Plombier',
        zone: 'Akanda',
        texte: '',
        budget: 5000,
        fin: MAINTENANT + HEURE,
        creeLe: MAINTENANT - 10 * 60_000,
      },
    ]);
  });

  it('ignore expirée, retirée, invalide, pseudo pris et celle d’un rôle autre que client', async () => {
    const retiree = evenement({
      type: 'io.sia.annonce',
      content: {},
      sender: AUTRE,
      ts: MAINTENANT - 10 * 60_000,
      id: '$d2',
      redacted: true,
    });
    const c = fauxClient([
      mur([
        annonce('palmier', AUTRE, MAINTENANT - 20 * 60_000, '$d1'),
        retiree,
        annonce('vieille', TIERS, MAINTENANT - 3 * HEURE, '$t1', { fin: MAINTENANT - 1 }),
        annonce('mal', '@q:sia.tail94dc60.ts.net', MAINTENANT, '$q1', { budget: 0 }),
        annonce('long', '@r:sia.tail94dc60.ts.net', MAINTENANT, '$r1', { texte: 'x'.repeat(141) }),
        annonce('loin', '@s:sia.tail94dc60.ts.net', MAINTENANT, '$s1', {
          fin: MAINTENANT + 26 * HEURE,
        }),
        annonce('presta', '@u:sia.tail94dc60.ts.net', MAINTENANT, '$u1', { role: 'prestataire' }),
      ]),
    ]);
    expect(await lireDemandes(comme(c))).toEqual([]);
  });

  it('un pseudo déjà pris par un autre compte rend la demande invalide', async () => {
    const c = fauxClient([
      mur([
        statut(base('palmier'), AUTRE, MAINTENANT - HEURE, '$a1'),
        annonce('palmier', TIERS, MAINTENANT - 60_000, '$t1'),
      ]),
    ]);
    await lireStatuts(comme(c));
    expect(await lireDemandes(comme(c))).toEqual([]);
  });
});

describe('ecouterMur', () => {
  it("donne l'état du Mur, le met à jour à chaque événement, et s'arrête", async () => {
    const evenements = [statut(base('puma'), AUTRE, MAINTENANT - 1000, '$a1')];
    const m = mur(evenements);
    const c = fauxClient([m]);
    const rappel = vi.fn();
    const arreter = ecouterMur(comme(c), rappel);
    // Affichage immédiat avec ce que le client a déjà, puis état complet une fois l'historique chargé.
    expect(rappel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(rappel).toHaveBeenCalledTimes(2);
    expect(rappel.mock.calls[1]?.[0].statuts).toHaveLength(1);
    expect(rappel.mock.calls[1]?.[0].demandes).toEqual([]);

    const nouvelle = annonce('palmier', TIERS, MAINTENANT, '$d1');
    evenements.push(nouvelle);
    c.emit(RoomEvent.Timeline, nouvelle, m, false);
    c.emit(RoomEvent.Timeline, nouvelle, m, false);
    await vi.advanceTimersByTimeAsync(100);
    expect(rappel).toHaveBeenCalledTimes(3);
    expect(rappel.mock.calls[2]?.[0].demandes).toHaveLength(1);

    c.emit(RoomEvent.Timeline, nouvelle, salon({ ...baseAutreSalon() }), false);
    await vi.advanceTimersByTimeAsync(100);
    expect(rappel).toHaveBeenCalledTimes(3);

    arreter();
    c.emit(RoomEvent.Timeline, nouvelle, m, false);
    await vi.advanceTimersByTimeAsync(100);
    expect(rappel).toHaveBeenCalledTimes(3);
  });

  it("Mur vide au démarrage : pas d'affichage immédiat (évite un faux « personne »)", async () => {
    const c = fauxClient([mur([])]);
    const rappel = vi.fn();
    ecouterMur(comme(c), rappel);
    expect(rappel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(rappel).toHaveBeenCalledTimes(1);
  });

  it("signale l'échec de la première lecture", async () => {
    const c = fauxClient([mur([])]);
    c.joinRoom.mockRejectedValueOnce(new Error('réseau'));
    const rappel = vi.fn();
    const erreur = vi.fn();
    ecouterMur(comme(c), rappel, erreur);
    await vi.advanceTimersByTimeAsync(0);
    expect(erreur).toHaveBeenCalledTimes(1);
    expect(rappel).not.toHaveBeenCalled();
  });
});

function baseAutreSalon() {
  return {
    roomId: '!autre:sia.tail94dc60.ts.net',
    appartenance: 'join',
    membres: {},
    etat: {},
    evenements: [],
  };
}
