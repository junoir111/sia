import type { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accepterNouvelAppareil,
  ecouterBulles,
  envoyerMessage,
  prechaufferBulle,
  surveillerBulle,
} from '../src/matrix/bulles';
import { AUTRE, MOI, comme, evenement, fauxClient, salon } from './faux-matrix';

/*
 * Rapidité des bulles (aucun réseau) : préchauffage du chiffrement, vérifications en parallèle à l'ouverture,
 * bulles qui deviennent ouvertes. Le préchauffage ne doit JAMAIS passer avant les contrôles de sécurité.
 */

const MAINTENANT = Date.UTC(2026, 10, 18, 10, 0, 0);
const BULLE = '!b1:sia.tail94dc60.ts.net';
const INTRUS = '@intrus:sia.tail94dc60.ts.net';
const LION = '@lion:sia.tail94dc60.ts.net';

type Membres = Record<string, { membership: string; event?: MatrixEvent }>;

/** État d'une bulle ouverte par « Demander » (sans demande), créée par moi avec `autre`. */
function etat(autre = AUTRE): Record<string, MatrixEvent> {
  return {
    'm.room.encryption': evenement({
      type: 'm.room.encryption',
      stateKey: '',
      content: { algorithm: 'm.megolm.v1.aes-sha2' },
    }),
    'io.sia.bulle': evenement({
      type: 'io.sia.bulle',
      stateKey: '',
      sender: MOI,
      content: {
        participants: {
          [MOI]: { pseudo: 'palmier-48', zone: 'Akanda' },
          [autre]: { pseudo: 'puma', zone: 'Nzeng' },
        },
      },
    }),
  };
}

function bulle(membres: Membres, o: { id?: string; etat?: Record<string, MatrixEvent> } = {}) {
  return salon({
    roomId: o.id ?? BULLE,
    appartenance: 'join',
    createur: MOI,
    membres,
    etat: o.etat ?? etat(),
    evenements: [],
  });
}

const aDeux = (): Membres => ({ [MOI]: { membership: 'join' }, [AUTRE]: { membership: 'join' } });

/** L'autre invité par moi (bulle que je viens de créer). */
function invitation(autre = AUTRE): { membership: string; event: MatrixEvent } {
  return {
    membership: 'invite',
    event: evenement({ type: 'm.room.member', stateKey: autre, sender: MOI, content: {} }),
  };
}

/** Laisse finir les vérifications lancées en arrière-plan (aucun réseau : tout est simulé). */
async function vider(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(MAINTENANT);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('préchauffage du chiffrement', () => {
  it('ouvrir la bulle partage la clé du salon à l’avance, après les vérifications', async () => {
    const c = fauxClient([bulle(aDeux())], true, { [AUTRE]: ['TEL1'] });
    const arreter = surveillerBulle(comme(c), BULLE);
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
    await vider();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    expect(c.prepareToEncrypt).toHaveBeenCalledWith(c.salons[0]);
    arreter();
  });

  it('le premier message part sans rien refaire : la clé a été partagée avant lui', async () => {
    const c = fauxClient([bulle(aDeux())], true, { [AUTRE]: ['TEL1'] });
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    const envoi = envoyerMessage(comme(c), BULLE, 'Bonjour');
    expect(c.sendMessage).toHaveBeenCalledTimes(1);
    await envoi;
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    expect(c.prepareToEncrypt.mock.invocationCallOrder[0]).toBeLessThan(
      c.sendMessage.mock.invocationCallOrder[0] ?? 0,
    );
    arreter();
  });

  it('jamais avant les contrôles : bulle non chiffrée, à 3 ou fermée', async () => {
    const sansEtatChiffre = { 'io.sia.bulle': etat()['io.sia.bulle'] as MatrixEvent };
    const cas: [string, () => ReturnType<typeof fauxClient>][] = [
      ['module de chiffrement absent', () => fauxClient([bulle(aDeux())], false)],
      ['état sans chiffrement', () => fauxClient([bulle(aDeux(), { etat: sansEtatChiffre })])],
      ['un 3e membre', () => fauxClient([bulle({ ...aDeux(), [INTRUS]: { membership: 'join' } })])],
      [
        'l’autre est parti',
        () => fauxClient([bulle({ ...aDeux(), [AUTRE]: { membership: 'leave' } })]),
      ],
    ];
    for (const [, fabriquer] of cas) {
      const c = fabriquer();
      const arreter = surveillerBulle(comme(c), BULLE);
      prechaufferBulle(comme(c), BULLE);
      await vider();
      expect(c.prepareToEncrypt).not.toHaveBeenCalled();
      arreter();
    }
  });

  it('un appareil inconnu de l’autre : pas de préchauffage tant que je ne l’ai pas accepté', async () => {
    localStorage.setItem('sia.appareils', JSON.stringify({ [BULLE]: ['TEL1'] }));
    const c = fauxClient([bulle(aDeux())], true, { [AUTRE]: ['TEL1', 'ESPION'] });
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    prechaufferBulle(comme(c), BULLE);
    await vider();
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
    await accepterNouvelAppareil(comme(c), BULLE);
    c.emit('crypto.devicesUpdated', [AUTRE], false);
    await vider();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('au plus un partage toutes les 3 s pour une même bulle', async () => {
    const c = fauxClient([bulle(aDeux())], true, { [AUTRE]: ['TEL1'] });
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    prechaufferBulle(comme(c), BULLE);
    vi.advanceTimersByTime(2900);
    prechaufferBulle(comme(c), BULLE);
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    prechaufferBulle(comme(c), BULLE);
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(2);
    arreter();
  });

  it('un 3e membre arrivé depuis la préparation : pas de nouveau partage (contrôle en mémoire)', async () => {
    const membres = aDeux();
    const c = fauxClient([bulle(membres)], true, { [AUTRE]: ['TEL1'] });
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    membres[INTRUS] = { membership: 'join' };
    vi.advanceTimersByTime(3100);
    prechaufferBulle(comme(c), BULLE);
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('sans surveillance : vérifie d’abord (appareils retenus), puis préchauffe', async () => {
    const c = fauxClient([bulle(aDeux())], true, { [AUTRE]: ['TEL1'] });
    prechaufferBulle(comme(c), BULLE);
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
    await vider();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('sia.appareils') ?? '{}')).toEqual({
      [BULLE]: ['TEL1'],
    });
  });

  it('ne lève jamais d’erreur et ne rejette jamais (identifiant faux, bulle inconnue, module en panne)', async () => {
    const c = fauxClient([bulle(aDeux())], true, { [AUTRE]: ['TEL1'] });
    expect(() => prechaufferBulle(comme(c), 'pas-un-salon')).not.toThrow();
    expect(() => prechaufferBulle(comme(c), '!inconnue:sia.tail94dc60.ts.net')).not.toThrow();
    c.prepareToEncrypt.mockImplementation(() => {
      throw new Error('module en panne');
    });
    expect(() => prechaufferBulle(comme(c), BULLE)).not.toThrow();
    const panne = fauxClient([bulle(aDeux())]);
    vi.spyOn(panne, 'getCrypto').mockImplementation(() => {
      throw new Error('boum');
    });
    expect(() => prechaufferBulle(comme(panne), BULLE)).not.toThrow();
    await vider();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
  });
});

describe('ouverture d’une bulle : les vérifications partent ensemble', () => {
  /** Client dont la liste des membres et les appareils de l'autre répondent quand on le décide. */
  function clientLent(membres: Membres) {
    const s = bulle(membres);
    const c = fauxClient([s], true, { [AUTRE]: ['TEL1'] });
    let finMembres: () => void = () => undefined;
    let finAppareils: () => void = () => undefined;
    s.loadMembersIfNeeded.mockImplementation(
      () =>
        new Promise<boolean>((fini) => {
          finMembres = () => fini(true);
        }),
    );
    const crypto = c.getCrypto();
    const appareils = vi.fn(
      () =>
        new Promise<Map<string, Map<string, { deviceId: string }>>>((fini) => {
          finAppareils = () => fini(new Map([[AUTRE, new Map([['TEL1', { deviceId: 'TEL1' }]])]]));
        }),
    );
    vi.spyOn(c, 'getCrypto').mockReturnValue(crypto && { ...crypto, getUserDeviceInfo: appareils });
    return { c, s, appareils, finir: () => [finMembres(), finAppareils()] };
  }

  it('la liste des membres et les appareils de l’autre sont demandés en même temps', async () => {
    const { c, s, appareils, finir } = clientLent(aDeux());
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    expect(s.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    expect(appareils).toHaveBeenCalledTimes(1);
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
    finir();
    await vider();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('un 3e membre révélé par la liste chargée : bulle quittée, rien n’est retenu, rien n’est préchauffé', async () => {
    const membres = aDeux();
    const { c, finir } = clientLent(membres);
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    membres[INTRUS] = { membership: 'join' };
    finir();
    await vider();
    expect(c.leave).toHaveBeenCalledWith(BULLE);
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
    expect(localStorage.getItem('sia.appareils')).toBeNull();
    arreter();
  });
});

describe('bulles qui deviennent ouvertes pendant l’écoute', () => {
  async function tour(): Promise<void> {
    await vi.advanceTimersByTimeAsync(60);
    await vider();
  }

  it('celles déjà là au départ ne sont pas préchauffées (pas de rafale) ; une nouvelle ouverte l’est', async () => {
    const deja = bulle(aDeux(), { id: '!deja:sia.tail94dc60.ts.net' });
    const c = fauxClient([deja], true, { [AUTRE]: ['TEL1'], [LION]: ['L1'] });
    const arreter = ecouterBulles(comme(c), vi.fn());
    await tour();
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
    const nouvelle = bulle(
      { [MOI]: { membership: 'join' }, [LION]: { membership: 'join' } },
      { id: '!nouvelle:sia.tail94dc60.ts.net', etat: etat(LION) },
    );
    c.salons.push(nouvelle);
    c.emit('Room');
    await tour();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    expect(c.prepareToEncrypt).toHaveBeenCalledWith(nouvelle);
    arreter();
  });

  it('bulle que je viens de créer : préchauffée dès que l’invitation de l’autre est vue, une seule fois', async () => {
    const membres: Membres = { [MOI]: { membership: 'join' } };
    const c = fauxClient([], true, { [AUTRE]: ['TEL1'] });
    const arreter = ecouterBulles(comme(c), vi.fn());
    await tour();
    c.salons.push(bulle(membres));
    c.emit('Room');
    await tour();
    // La bulle est là mais l'invitation n'est pas encore revenue par la synchro : pas encore sûre.
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
    membres[AUTRE] = invitation();
    c.emit('RoomMember.membership');
    await tour();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    // L'autre accepte : la bulle devient ouverte, mais elle était déjà préparée.
    vi.advanceTimersByTime(10_000);
    membres[AUTRE] = { membership: 'join' };
    c.emit('RoomMember.membership');
    await tour();
    expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('arrêtée, l’écoute ne préchauffe plus rien', async () => {
    const c = fauxClient([], true, { [AUTRE]: ['TEL1'] });
    const arreter = ecouterBulles(comme(c), vi.fn());
    await tour();
    arreter();
    c.salons.push(bulle(aDeux()));
    c.emit('Room');
    await tour();
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
  });
});
