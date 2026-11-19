import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contenuClients, type ContactClient } from '../src/logique/clients';
import {
  clientEnregistre,
  ecouterClients,
  enregistrerClient,
  lireClients,
  retirerClientEnregistre,
} from '../src/matrix/clients';
import { TYPE_CLIENTS } from '../src/matrix/evenements';
import { AUTRE, MOI, comme, evenement, fauxClient, salon } from './faux-matrix';

const BULLE = '!bulle:sia.tail94dc60.ts.net';
const BULLE_2 = '!autre-bulle:sia.tail94dc60.ts.net';
const AUTRE_2 = '@autre2:sia.tail94dc60.ts.net';
const PRESTA = { pseudo: 'puma', zone: 'Nzeng' };
const CLIENT = { pseudo: 'palmier-48', zone: 'Akanda' };
const CLIENT_2 = { pseudo: 'baobab-7', zone: 'Owendo' };
const ENREGISTRE: ContactClient = { userId: AUTRE, ...CLIENT };
const ENREGISTRE_2: ContactClient = { userId: AUTRE_2, ...CLIENT_2 };

/** Bulle où moi (prestataire) et l'autre (client) sont entrés. */
function bulleEtablie(
  roomId: string,
  autre: string,
  pseudoZone: typeof CLIENT,
  membership = 'join',
) {
  return salon({
    roomId,
    appartenance: 'join',
    createur: MOI,
    membres: { [MOI]: { membership: 'join' }, [autre]: { membership } },
    etat: {
      'm.room.encryption': evenement({
        type: 'm.room.encryption',
        stateKey: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      }),
      'io.sia.bulle': evenement({
        type: 'io.sia.bulle',
        stateKey: '',
        sender: MOI,
        content: { participants: { [MOI]: PRESTA, [autre]: pseudoZone } },
      }),
    },
    evenements: [],
  });
}

/**
 * Client simulé avec une donnée de compte. Écrire met la donnée à jour après un tour de file (comme l'écho de la
 * synchro) et prévient les écouteurs.
 */
function clientCompte(salons: ReturnType<typeof salon>[], depart?: unknown) {
  let contenu: unknown = depart;
  const c = fauxClient(salons);
  return Object.assign(c, {
    getAccountData: vi.fn((type: string) =>
      type === TYPE_CLIENTS && contenu !== undefined
        ? { getContent: () => contenu, getType: () => type }
        : undefined,
    ),
    setAccountData: vi.fn(async (type: string, nouveau: unknown) => {
      await new Promise((r) => setTimeout(r, 5));
      contenu = nouveau;
      c.emit('accountData', { getType: () => type });
      return {};
    }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('lireClients', () => {
  it('rend une liste vide sans donnée de compte', () => {
    expect(lireClients(comme(clientCompte([])))).toEqual([]);
  });

  it('lit la liste en ignorant ce qui est mal formé', () => {
    const c = clientCompte([], { clients: [ENREGISTRE, { userId: 'x' }, null] });
    expect(lireClients(comme(c))).toEqual([ENREGISTRE]);
  });
});

describe('enregistrerClient (depuis une bulle)', () => {
  it('écrit sur le compte le client de la bulle (compte, pseudo, quartier) et rien d’autre', async () => {
    const c = clientCompte([bulleEtablie(BULLE, AUTRE, CLIENT)]);
    const fin = enregistrerClient(comme(c), BULLE);
    await vi.advanceTimersByTimeAsync(10);
    await fin;
    expect(c.setAccountData).toHaveBeenCalledTimes(1);
    expect(c.setAccountData).toHaveBeenCalledWith(TYPE_CLIENTS, contenuClients([ENREGISTRE]));
  });

  it('enregistrer deux fois le même client ne fait pas de doublon', async () => {
    const c = clientCompte([bulleEtablie(BULLE, AUTRE, CLIENT)], contenuClients([ENREGISTRE]));
    const fin = enregistrerClient(comme(c), BULLE);
    await vi.advanceTimersByTimeAsync(10);
    await fin;
    expect(lireClients(comme(c))).toEqual([ENREGISTRE]);
  });

  it('refuse (sans rien écrire) tant que l’autre n’a pas accepté la bulle', async () => {
    const c = clientCompte([bulleEtablie(BULLE, AUTRE, CLIENT, 'invite')]);
    await expect(enregistrerClient(comme(c), BULLE)).rejects.toThrow();
    await expect(enregistrerClient(comme(c), '!inconnue:sia.tail94dc60.ts.net')).rejects.toThrow();
    expect(c.setAccountData).not.toHaveBeenCalled();
  });

  it('deux enregistrements à la suite passent un par un : aucun client n’est perdu', async () => {
    const c = clientCompte([
      bulleEtablie(BULLE, AUTRE, CLIENT),
      bulleEtablie(BULLE_2, AUTRE_2, CLIENT_2),
    ]);
    const premier = enregistrerClient(comme(c), BULLE);
    const second = enregistrerClient(comme(c), BULLE_2);
    await vi.advanceTimersByTimeAsync(30);
    await Promise.all([premier, second]);
    expect(lireClients(comme(c))).toEqual([ENREGISTRE, ENREGISTRE_2]);
  });

  it('une écriture refusée se voit (erreur), et la suivante marche quand même', async () => {
    const c = clientCompte([bulleEtablie(BULLE, AUTRE, CLIENT)]);
    c.setAccountData.mockRejectedValueOnce(new Error('réseau'));
    await expect(enregistrerClient(comme(c), BULLE)).rejects.toThrow('réseau');
    const fin = enregistrerClient(comme(c), BULLE);
    await vi.advanceTimersByTimeAsync(10);
    await fin;
    expect(lireClients(comme(c))).toEqual([ENREGISTRE]);
  });

  it('une écriture qui ne se termine jamais est abandonnée au bout de 20 s (erreur de réseau)', async () => {
    const c = clientCompte([bulleEtablie(BULLE, AUTRE, CLIENT)]);
    c.setAccountData.mockImplementationOnce(() => new Promise(() => undefined));
    const resultat = expect(enregistrerClient(comme(c), BULLE)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await resultat;
  });
});

describe('retirerClientEnregistre', () => {
  it('retire ce client et garde les autres', async () => {
    const c = clientCompte([], contenuClients([ENREGISTRE, ENREGISTRE_2]));
    const fin = retirerClientEnregistre(comme(c), AUTRE);
    await vi.advanceTimersByTimeAsync(10);
    await fin;
    expect(c.setAccountData).toHaveBeenCalledWith(TYPE_CLIENTS, contenuClients([ENREGISTRE_2]));
  });

  it('un client qui n’est pas dans la liste : rien n’est écrit', async () => {
    const c = clientCompte([], contenuClients([ENREGISTRE]));
    await retirerClientEnregistre(comme(c), AUTRE_2);
    expect(c.setAccountData).not.toHaveBeenCalled();
  });
});

describe('clientEnregistre', () => {
  it('vrai seulement si l’autre personne de la bulle est dans ma liste', () => {
    const salons = [bulleEtablie(BULLE, AUTRE, CLIENT), bulleEtablie(BULLE_2, AUTRE_2, CLIENT_2)];
    const c = clientCompte(salons, contenuClients([ENREGISTRE]));
    expect(clientEnregistre(comme(c), BULLE)).toBe(true);
    expect(clientEnregistre(comme(c), BULLE_2)).toBe(false);
    expect(clientEnregistre(comme(c), '!inconnue:sia.tail94dc60.ts.net')).toBe(false);
  });
});

describe('ecouterClients', () => {
  it('prévient avec la liste à jour quand la donnée de compte change, et pas pour une autre donnée', async () => {
    const c = clientCompte([bulleEtablie(BULLE, AUTRE, CLIENT)]);
    const rappel = vi.fn();
    const arreter = ecouterClients(comme(c), rappel);
    c.emit('accountData', { getType: () => 'm.push_rules' });
    expect(rappel).not.toHaveBeenCalled();

    const fin = enregistrerClient(comme(c), BULLE);
    await vi.advanceTimersByTimeAsync(10);
    await fin;
    expect(rappel).toHaveBeenCalledWith([ENREGISTRE]);

    arreter();
    c.emit('accountData', { getType: () => TYPE_CLIENTS });
    expect(rappel).toHaveBeenCalledTimes(1);
  });
});
