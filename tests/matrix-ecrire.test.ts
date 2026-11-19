import type { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contenuClients, type ContactClient } from '../src/logique/clients';
import { accepterOffre, autreDeBulle, ecrireA, listerBulles } from '../src/matrix/bulles';
import { TYPE_CLIENTS } from '../src/matrix/evenements';
import { AUTRE, MOI, comme, evenement, fauxClient, salon, type FauxSalon } from './faux-matrix';

const BULLE = '!bulle:sia.tail94dc60.ts.net';
const INTRUS = '@intrus:sia.tail94dc60.ts.net';
/** Moi : le prestataire qui écrit. */
const PRESTA = { pseudo: 'puma', zone: 'Nzeng' };
/** AUTRE : le client enregistré. */
const CLIENT = { pseudo: 'palmier-48', zone: 'Akanda' };
const ENREGISTRE: ContactClient = { userId: AUTRE, ...CLIENT };

/** Client Matrix simulé avec, sur le compte, la liste de clients donnée. */
function clientAvecListe(salons: ReturnType<typeof salon>[], liste: ContactClient[]) {
  const c = fauxClient(salons);
  return Object.assign(c, {
    getAccountData: vi.fn((type: string) =>
      type === TYPE_CLIENTS ? { getContent: () => contenuClients(liste) } : undefined,
    ),
  });
}

function etatsBulle(participants: unknown, createur: string, extra: object = {}) {
  return {
    'm.room.encryption': evenement({
      type: 'm.room.encryption',
      stateKey: '',
      content: { algorithm: 'm.megolm.v1.aes-sha2' },
    }),
    'io.sia.bulle': evenement({
      type: 'io.sia.bulle',
      stateKey: '',
      sender: createur,
      content: { participants, ...extra },
    }),
  };
}

type Membres = FauxSalon['membres'];

/** Bulle créée par moi (le prestataire) : moi dedans, le client invité. */
function bulleCreee(membres: Membres = {}) {
  const invite = evenement({ type: 'm.room.member', stateKey: AUTRE, sender: MOI, content: {} });
  return salon({
    roomId: BULLE,
    appartenance: 'join',
    createur: MOI,
    membres: {
      [MOI]: { membership: 'join' },
      [AUTRE]: { membership: 'invite', event: invite },
      ...membres,
    },
    etat: etatsBulle({ [MOI]: PRESTA, [AUTRE]: CLIENT }, MOI),
    evenements: [],
  });
}

/** Client dont le serveur crée la bulle à la demande (comme avec le vrai serveur). */
function clientEcrire(liste: ContactClient[] = [ENREGISTRE]) {
  const c = clientAvecListe([], liste);
  c.createRoom.mockImplementation(async () => {
    c.salons.push(bulleCreee());
    return { room_id: BULLE };
  });
  return c;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 19, 10, 0, 0));
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('ecrireA (prestataire → client enregistré)', () => {
  it('crée une bulle chiffrée à 2 sans demande et invite ce seul client avec « vous écrit »', async () => {
    const c = clientEcrire();
    await expect(ecrireA(comme(c), AUTRE, PRESTA)).resolves.toEqual({
      roomId: BULLE,
      reutilisee: false,
    });
    const options = (c.createRoom.mock.calls[0] as unknown[] | undefined)?.[0] as Record<
      string,
      unknown
    >;
    expect(options).toMatchObject({
      name: 'SIA · Bulle',
      preset: 'private_chat',
      visibility: 'private',
      power_level_content_override: { invite: 100, state_default: 100, redact: 0 },
    });
    expect(options.invite).toBeUndefined();
    expect(options.initial_state).toEqual([
      { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
      {
        type: 'io.sia.bulle',
        state_key: '',
        content: { participants: { [MOI]: PRESTA, [AUTRE]: CLIENT } },
      },
    ]);
    expect(c.invite).toHaveBeenCalledTimes(1);
    expect(c.invite).toHaveBeenCalledWith(BULLE, AUTRE, { reason: 'puma (Nzeng) vous écrit' });
    expect(c.leave).not.toHaveBeenCalled();
  });

  it("n'écrit qu'à un client de MA liste : rien n'est créé pour un autre compte ou une liste vide", async () => {
    const c = clientEcrire();
    await expect(ecrireA(comme(c), INTRUS, PRESTA)).rejects.toThrow(/enregistré/);
    const vide = clientEcrire([]);
    await expect(ecrireA(comme(vide), AUTRE, PRESTA)).rejects.toThrow(/enregistré/);
    expect(c.createRoom).not.toHaveBeenCalled();
    expect(vide.createRoom).not.toHaveBeenCalled();
  });

  it('refuse de s’écrire à soi-même ou avec un pseudo de prestataire invalide', async () => {
    const c = clientEcrire([{ userId: MOI, pseudo: 'moi', zone: 'Akanda' }, ENREGISTRE]);
    await expect(ecrireA(comme(c), MOI, PRESTA)).rejects.toThrow();
    await expect(ecrireA(comme(c), AUTRE, { pseudo: '', zone: 'Nzeng' })).rejects.toThrow();
    await expect(
      ecrireA(comme(c), AUTRE, { pseudo: 'x'.repeat(31), zone: 'Nzeng' }),
    ).rejects.toThrow();
    expect(c.createRoom).not.toHaveBeenCalled();
    expect(c.invite).not.toHaveBeenCalled();
  });

  it('réutilise la bulle déjà ouverte avec ce client : rien de nouveau n’est créé', async () => {
    const c = clientEcrire();
    await ecrireA(comme(c), AUTRE, PRESTA);
    await expect(ecrireA(comme(c), AUTRE, PRESTA)).resolves.toEqual({
      roomId: BULLE,
      reutilisee: true,
    });
    expect(c.createRoom).toHaveBeenCalledTimes(1);
    expect(c.invite).toHaveBeenCalledTimes(1);
  });

  it('refuse un double toucher : un seul envoi part si le premier est encore en route', async () => {
    const c = clientEcrire();
    const premiere = ecrireA(comme(c), AUTRE, PRESTA);
    const seconde = expect(ecrireA(comme(c), AUTRE, PRESTA)).rejects.toThrow(/déjà/);
    await seconde;
    await premiere;
    expect(c.createRoom).toHaveBeenCalledTimes(1);
  });

  it("quitte la bulle et annule l'invitation si l'invitation échoue", async () => {
    const c = clientEcrire();
    c.invite.mockRejectedValueOnce(new Error('réseau'));
    await expect(ecrireA(comme(c), AUTRE, PRESTA)).rejects.toThrow('réseau');
    expect(c.kick).toHaveBeenCalledWith(BULLE, AUTRE, expect.any(String));
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it('quitte la bulle et refuse si une 3e personne y est', async () => {
    const c = clientAvecListe([], [ENREGISTRE]);
    c.createRoom.mockImplementation(async () => {
      c.salons.push(bulleCreee({ [INTRUS]: { membership: 'join' } }));
      return { room_id: BULLE };
    });
    const resultat = expect(ecrireA(comme(c), AUTRE, PRESTA)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(11_000);
    await resultat;
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });
});

const RAISON = 'puma (Nzeng) vous écrit';

/** Invitation reçue par moi (le client), de AUTRE (le prestataire). Rejoindre la rend « join ». */
function invitationEcrit(raison: string, o: { etat?: object; createur?: string } = {}) {
  const evMembre: MatrixEvent = evenement({
    type: 'm.room.member',
    stateKey: MOI,
    sender: AUTRE,
    content: { membership: 'invite', reason: raison },
  });
  const f: FauxSalon = {
    roomId: BULLE,
    appartenance: 'invite',
    ts: 0,
    createur: o.createur ?? AUTRE,
    membres: {
      [MOI]: { membership: 'invite', event: evMembre },
      [AUTRE]: { membership: 'join' },
    },
    etat: {},
    evenements: [],
  };
  const apres = (): void => {
    f.appartenance = 'join';
    f.membres = { [MOI]: { membership: 'join' }, [AUTRE]: { membership: 'join' } };
    f.etat = o.etat
      ? (o.etat as Record<string, MatrixEvent>)
      : etatsBulle({ [AUTRE]: PRESTA, [MOI]: CLIENT }, AUTRE);
  };
  return { salon: salon(f), apres };
}

function clientRecoit(inv: ReturnType<typeof invitationEcrit>) {
  const c = fauxClient([inv.salon]);
  c.joinRoom.mockImplementation(async () => {
    inv.apres();
    return inv.salon as never;
  });
  return c;
}

describe('invitation « X vous écrit » côté client', () => {
  it('apparaît dans la liste des bulles comme invitation directe qui écrit, sans demande', () => {
    const c = fauxClient([invitationEcrit(RAISON).salon]);
    expect(listerBulles(comme(c))).toEqual([
      {
        roomId: BULLE,
        autre: PRESTA,
        demande: null,
        etat: 'invitation-recue',
        nonLus: 0,
        autreEcrit: false,
        invitationDirecte: true,
        invitationEcrit: true,
      },
    ]);
    expect(c.leave).not.toHaveBeenCalled();
  });

  it('ignore et quitte une invitation mal formée, trop longue ou avec référence', async () => {
    for (const raison of [
      'puma vous écrit',
      'puma (Nzeng) vous écris',
      'puma (Nzeng) vous ecrit',
      `${'x'.repeat(31)} (Nzeng) vous écrit`,
      `${RAISON} ${'x'.repeat(80)}`,
      'puma (Nzeng) vous écrit [ref:$d]',
      'pu‮ma (Nzeng) vous écrit',
      ' (Nzeng) vous écrit',
    ]) {
      const c = fauxClient([invitationEcrit(raison).salon]);
      expect(listerBulles(comme(c))).toEqual([]);
      expect(c.leave).toHaveBeenCalledWith(BULLE);
      await Promise.resolve(); // laisse finir le départ en cours (une seule fois par bulle)
      await Promise.resolve();
    }
  });

  it("l'accepter rejoint la bulle chiffrée à 2 créée par le prestataire et prépare le chiffrement", async () => {
    const c = clientRecoit(invitationEcrit(RAISON));
    await accepterOffre(comme(c), BULLE);
    expect(c.joinRoom).toHaveBeenCalledWith(BULLE);
    expect(c.leave).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1));
  });

  it("l'accepter est refusé si la bulle porte une demande ou n'a pas été créée par l'invitant", async () => {
    const avecDemande = invitationEcrit(RAISON, {
      etat: etatsBulle({ [AUTRE]: PRESTA, [MOI]: CLIENT }, AUTRE, {
        demande: { annonce: '$d', service: 'x', zone: 'y', budget: 5, texte: '' },
      }),
    });
    const c1 = clientRecoit(avecDemande);
    await expect(accepterOffre(comme(c1), BULLE)).rejects.toThrow();
    expect(c1.leave).toHaveBeenCalledWith(BULLE);

    const c2 = clientRecoit(invitationEcrit(RAISON, { createur: INTRUS }));
    await expect(accepterOffre(comme(c2), BULLE)).rejects.toThrow();
    expect(c2.leave).toHaveBeenCalledWith(BULLE);
  });
});

describe('autreDeBulle (qui est l’autre, pour l’enregistrer comme client)', () => {
  function bulleEtablie(membres: Membres) {
    return salon({
      roomId: BULLE,
      appartenance: 'join',
      createur: MOI,
      membres: { [MOI]: { membership: 'join' }, ...membres },
      etat: etatsBulle({ [MOI]: PRESTA, [AUTRE]: CLIENT }, MOI),
      evenements: [],
    });
  }

  it('rend le compte, le pseudo et le quartier de l’autre quand il est entré dans la bulle', () => {
    const c = fauxClient([bulleEtablie({ [AUTRE]: { membership: 'join' } })]);
    expect(autreDeBulle(comme(c), BULLE)).toEqual({ userId: AUTRE, ...CLIENT });
  });

  it('rend null tant que l’autre n’a pas accepté, ou s’il est parti', () => {
    for (const membership of ['invite', 'leave']) {
      const c = fauxClient([bulleEtablie({ [AUTRE]: { membership } })]);
      expect(autreDeBulle(comme(c), BULLE)).toBeNull();
    }
  });

  it('rend null pour une bulle à 3, une bulle inconnue ou un identifiant invalide', () => {
    const c = fauxClient([
      bulleEtablie({ [AUTRE]: { membership: 'join' }, [INTRUS]: { membership: 'join' } }),
    ]);
    expect(autreDeBulle(comme(c), BULLE)).toBeNull();
    expect(autreDeBulle(comme(c), '!inconnue:sia.tail94dc60.ts.net')).toBeNull();
    expect(autreDeBulle(comme(c), 'pas-un-salon')).toBeNull();
  });

  it('prend le pseudo connu de ce compte (annuaire) plutôt que celui déclaré dans la bulle', () => {
    localStorage.setItem('sia.annuaire', JSON.stringify([{ userId: AUTRE, pseudo: 'Palmier-48' }]));
    const c = fauxClient([bulleEtablie({ [AUTRE]: { membership: 'join' } })]);
    expect(autreDeBulle(comme(c), BULLE)?.pseudo).toBe('Palmier-48');
  });
});
