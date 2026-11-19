import type { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIAS_MUR } from '../src/config';
import {
  MAX_INVITATIONS_DIRECTES,
  bulleAvec,
  accepterOffre,
  demanderA,
  listerBulles,
} from '../src/matrix/bulles';
import { oublierMur } from '../src/matrix/mur';
import {
  AUTRE,
  MOI,
  MUR,
  comme,
  evenement,
  fauxClient,
  salon,
  type FauxSalon,
} from './faux-matrix';

const MAINTENANT = Date.UTC(2026, 10, 18, 10, 0, 0);
const HEURE = 3_600_000;
const BULLE = '!bulle:sia.tail94dc60.ts.net';
const INTRUS = '@intrus:sia.tail94dc60.ts.net';
const PUBLIC_CLIENT = { pseudo: 'palmier-48', zone: 'Akanda' };

/** Mur où AUTRE (« puma », Nzeng) est disponible. */
function murAvecPresta() {
  const statut = evenement({
    type: 'io.sia.statut',
    id: '$s1',
    sender: AUTRE,
    ts: MAINTENANT - 1000,
    content: { pseudo: 'puma', metier: 'Plombier', zone: 'Nzeng', fin: MAINTENANT + HEURE },
  });
  return salon({
    roomId: MUR,
    appartenance: 'join',
    membres: {},
    etat: {},
    evenements: [statut],
    alias: ALIAS_MUR,
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

/** Bulle créée par moi (le client) : moi dedans, le prestataire invité. */
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
    etat: etatsBulle({ [MOI]: PUBLIC_CLIENT, [AUTRE]: { pseudo: 'puma', zone: 'Nzeng' } }, MOI),
    evenements: [],
  });
}

/** Client de la demande : la bulle n'existe qu'une fois créée (comme avec le vrai serveur). */
function clientDemande(membres: Membres = {}, chiffre = true) {
  const c = fauxClient([murAvecPresta()], chiffre);
  c.createRoom.mockImplementation(async () => {
    c.salons.push(bulleCreee(membres));
    return { room_id: BULLE };
  });
  return c;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MAINTENANT);
  oublierMur();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('demanderA', () => {
  it('crée une bulle chiffrée à 2 et invite ce seul prestataire, sans rien de la demande', async () => {
    const c = clientDemande();
    const { roomId, reutilisee } = await demanderA(comme(c), AUTRE, PUBLIC_CLIENT);
    expect(roomId).toBe(BULLE);
    expect(reutilisee).toBe(false);
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
        content: {
          participants: {
            [MOI]: PUBLIC_CLIENT,
            [AUTRE]: { pseudo: 'puma', zone: 'Nzeng' },
          },
        },
      },
    ]);
    expect(c.invite).toHaveBeenCalledTimes(1);
    expect(c.invite).toHaveBeenCalledWith(BULLE, AUTRE, {
      reason: 'palmier-48 (Akanda) vous demande',
    });
    expect(c.leave).not.toHaveBeenCalled();
  });

  it("refuse sans statut valable, pour soi-même ou avec un pseudo invalide : rien n'est créé", async () => {
    const c = clientDemande();
    await expect(demanderA(comme(c), INTRUS, PUBLIC_CLIENT)).rejects.toThrow();
    await expect(demanderA(comme(c), MOI, PUBLIC_CLIENT)).rejects.toThrow();
    await expect(demanderA(comme(c), AUTRE, { pseudo: '', zone: 'Akanda' })).rejects.toThrow();
    await expect(
      demanderA(comme(c), AUTRE, { pseudo: 'x'.repeat(31), zone: 'Akanda' }),
    ).rejects.toThrow();
    expect(c.createRoom).not.toHaveBeenCalled();
    expect(c.invite).not.toHaveBeenCalled();
  });

  it('refuse si le statut du prestataire est expiré', async () => {
    const c = clientDemande();
    vi.setSystemTime(MAINTENANT + 2 * HEURE);
    await expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow();
    expect(c.createRoom).not.toHaveBeenCalled();
  });

  it("quitte la bulle si l'invitation échoue", async () => {
    const c = clientDemande();
    c.invite.mockRejectedValueOnce(new Error('réseau'));
    await expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow('réseau');
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it('quitte la bulle et refuse si une 3e personne y est', async () => {
    const c = clientDemande({ [INTRUS]: { membership: 'join' } });
    const resultat = expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(11_000);
    await resultat;
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it("quitte la bulle et refuse si le chiffrement n'est pas actif", async () => {
    const c = clientDemande({}, false);
    const resultat = expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(11_000);
    await resultat;
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it("quitte la bulle ET annule l'invitation si la création échoue après l'invitation", async () => {
    const c = clientDemande({}, false);
    const resultat = expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(11_000);
    await resultat;
    expect(c.kick).toHaveBeenCalledWith(BULLE, AUTRE, expect.any(String));
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it("une invitation impossible à annuler n'empêche pas de quitter la bulle", async () => {
    const c = clientDemande();
    c.invite.mockRejectedValueOnce(new Error('réseau'));
    c.kick.mockRejectedValueOnce(new Error('réseau'));
    await expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow('réseau');
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it('une 2e demande vers la même personne réutilise la 1re bulle encore ouverte', async () => {
    const c = clientDemande();
    await demanderA(comme(c), AUTRE, PUBLIC_CLIENT);
    await expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).resolves.toEqual({
      roomId: BULLE,
      reutilisee: true,
    });
    expect(c.createRoom).toHaveBeenCalledTimes(1);
    expect(c.invite).toHaveBeenCalledTimes(1);
  });

  it('refuse un double clic : une seule demande part si la 1re est encore en cours', async () => {
    const c = clientDemande();
    const premiere = demanderA(comme(c), AUTRE, PUBLIC_CLIENT);
    const seconde = expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow(/déjà/);
    await seconde;
    await premiere;
    expect(c.createRoom).toHaveBeenCalledTimes(1);
  });

  it("autorise une nouvelle demande quand la 1re bulle est fermée (l'autre est parti)", async () => {
    const c = clientDemande();
    await demanderA(comme(c), AUTRE, PUBLIC_CLIENT);
    c.salons.length = 1; // bulle fermée : plus dans la liste
    await expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).resolves.toEqual({
      roomId: BULLE,
      reutilisee: false,
    });
    expect(c.createRoom).toHaveBeenCalledTimes(2);
  });

  describe('vérification de la bulle pendant l’invitation (2 allers-retours, pas d’attente de synchro)', () => {
    /** Bulle telle qu'elle arrive par la synchro juste après la création : moi seul, l'invitation pas encore vue. */
    function bulleSansInvitationVue(createur = MOI) {
      return salon({
        roomId: BULLE,
        appartenance: 'join',
        createur,
        membres: { [MOI]: { membership: 'join' } },
        etat: etatsBulle(
          { [MOI]: PUBLIC_CLIENT, [AUTRE]: { pseudo: 'puma', zone: 'Nzeng' } },
          createur,
        ),
        evenements: [],
      });
    }

    function clientSansInvitationVue(createur = MOI) {
      const c = fauxClient([murAvecPresta()]);
      c.createRoom.mockImplementation(async () => {
        c.salons.push(bulleSansInvitationVue(createur));
        return { room_id: BULLE };
      });
      return c;
    }

    it("rend la main dès que le serveur acquitte l'invitation, sans attendre qu'elle revienne par la synchro", async () => {
      const c = clientSansInvitationVue();
      await expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).resolves.toEqual({
        roomId: BULLE,
        reutilisee: false,
      });
      expect(c.invite).toHaveBeenCalledTimes(1);
      expect(c.leave).not.toHaveBeenCalled();
      expect(c.kick).not.toHaveBeenCalled();
    });

    it("ne dit jamais « envoyée » avant l'acquittement du serveur, même si la bulle est déjà là", async () => {
      const c = clientSansInvitationVue();
      let acquitter: () => void = () => undefined;
      c.invite.mockImplementation(
        () =>
          new Promise((fini) => {
            acquitter = () => fini({});
          }),
      );
      let fini = false;
      const resultat = demanderA(comme(c), AUTRE, PUBLIC_CLIENT).then((r) => {
        fini = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect(fini).toBe(false);
      acquitter();
      await expect(resultat).resolves.toMatchObject({ roomId: BULLE, reutilisee: false });
    });

    it("refuse quand l'autre est déjà parti ou banni : bulle quittée", async () => {
      for (const membership of ['leave', 'ban']) {
        const c = clientDemande({ [AUTRE]: { membership } });
        const resultat = expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(11_000);
        await resultat;
        expect(c.leave).toHaveBeenCalledWith(BULLE);
      }
    });

    it("refuse une bulle que je n'ai pas créée (état écrit par un autre) : bulle quittée", async () => {
      const c = clientSansInvitationVue(AUTRE);
      const resultat = expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(11_000);
      await resultat;
      expect(c.leave).toHaveBeenCalledWith(BULLE);
    });

    it("refuse une 3e personne dès l'arrivée de la bulle, même sans l'invitation de l'autre", async () => {
      const c = fauxClient([murAvecPresta()]);
      c.createRoom.mockImplementation(async () => {
        c.salons.push(
          salon({
            roomId: BULLE,
            appartenance: 'join',
            createur: MOI,
            membres: { [MOI]: { membership: 'join' }, [INTRUS]: { membership: 'join' } },
            etat: etatsBulle(
              { [MOI]: PUBLIC_CLIENT, [AUTRE]: { pseudo: 'puma', zone: 'Nzeng' } },
              MOI,
            ),
            evenements: [],
          }),
        );
        return { room_id: BULLE };
      });
      const resultat = expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(11_000);
      await resultat;
      expect(c.leave).toHaveBeenCalledWith(BULLE);
    });
  });
});

const RAISON = 'palmier-48 (Akanda) vous demande';

/** Invitation reçue par moi (le prestataire), de AUTRE (le client). Rejoindre la rend « join ». */
function invitationDirecte(
  raison: string,
  o: {
    etat?: object;
    createur?: string;
    tiers?: boolean;
    id?: string;
    ts?: number;
    parti?: boolean;
    de?: string;
  } = {},
) {
  const de = o.de ?? AUTRE;
  const evMembre: MatrixEvent = evenement({
    type: 'm.room.member',
    stateKey: MOI,
    sender: de,
    content: { membership: 'invite', reason: raison },
  });
  const f: FauxSalon = {
    roomId: o.id ?? BULLE,
    appartenance: 'invite',
    ts: o.ts ?? 0,
    createur: o.createur ?? de,
    membres: {
      [MOI]: { membership: 'invite', event: evMembre },
      [de]: { membership: o.parti ? 'leave' : 'join' },
    },
    etat: {},
    evenements: [],
  };
  const apres = (): void => {
    f.appartenance = 'join';
    f.membres = {
      [MOI]: { membership: 'join' },
      [AUTRE]: { membership: 'join' },
      ...(o.tiers ? { [INTRUS]: { membership: 'join' } } : {}),
    };
    f.etat = o.etat
      ? (o.etat as Record<string, MatrixEvent>)
      : etatsBulle({ [AUTRE]: PUBLIC_CLIENT, [MOI]: { pseudo: 'puma', zone: 'Nzeng' } }, AUTRE);
  };
  return { salon: salon(f), apres };
}

function clientPresta(inv: ReturnType<typeof invitationDirecte>) {
  const c = fauxClient([inv.salon]);
  c.joinRoom.mockImplementation(async () => {
    inv.apres();
    return inv.salon as never;
  });
  return c;
}

describe('invitation « X vous demande » côté prestataire', () => {
  it('apparaît dans la liste des bulles, sans demande, sans quitter', () => {
    const c = fauxClient([invitationDirecte(RAISON).salon]);
    expect(listerBulles(comme(c))).toEqual([
      {
        roomId: BULLE,
        autre: PUBLIC_CLIENT,
        demande: null,
        etat: 'invitation-recue',
        nonLus: 0,
        autreEcrit: false,
        invitationDirecte: true,
      },
    ]);
    expect(c.leave).not.toHaveBeenCalled();
  });

  it('ignore et quitte une invitation mal formée, trop longue ou avec référence', async () => {
    for (const raison of [
      'palmier-48 vous demande',
      `${'x'.repeat(31)} (Akanda) vous demande`,
      `${RAISON} ${'x'.repeat(80)}`,
      'palmier-48 (Akanda) vous demande [ref:$d]',
      'palmier‮-48 (Akanda) vous demande',
      ' (Akanda) vous demande',
    ]) {
      const c = fauxClient([invitationDirecte(raison).salon]);
      expect(listerBulles(comme(c))).toEqual([]);
      expect(c.leave).toHaveBeenCalledWith(BULLE);
      await Promise.resolve(); // laisse finir le départ en cours (une seule fois par bulle)
      await Promise.resolve();
    }
  });

  it("ignore l'invitation d'un compte qui prend le pseudo d'un autre (premier arrivé)", () => {
    localStorage.setItem(
      'sia.annuaire',
      JSON.stringify([{ userId: INTRUS, pseudo: 'Palmier-48' }]),
    );
    const c = fauxClient([invitationDirecte(RAISON).salon]);
    expect(listerBulles(comme(c))).toEqual([]);
  });

  it("l'accepter rejoint la bulle chiffrée à 2 créée par le client", async () => {
    const c = clientPresta(invitationDirecte(RAISON));
    await accepterOffre(comme(c), BULLE);
    expect(c.joinRoom).toHaveBeenCalledWith(BULLE);
    expect(c.leave).not.toHaveBeenCalled();
  });

  it("l'accepter prépare le chiffrement en arrière-plan (le 1er message partira en un aller-retour)", async () => {
    const c = clientPresta(invitationDirecte(RAISON));
    await accepterOffre(comme(c), BULLE);
    await vi.waitFor(() => expect(c.prepareToEncrypt).toHaveBeenCalledTimes(1));
    expect(c.prepareToEncrypt).toHaveBeenCalledWith(c.salons[0]);
  });

  it("l'accepter est refusé (bulle quittée) avec une 3e personne", async () => {
    const c = clientPresta(invitationDirecte(RAISON, { tiers: true }));
    await expect(accepterOffre(comme(c), BULLE)).rejects.toThrow();
    expect(c.leave).toHaveBeenCalledWith(BULLE);
    await vi.advanceTimersByTimeAsync(50);
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
  });

  it("l'accepter est refusé si la bulle porte une demande, un budget ou n'a pas été créée par l'invitant", async () => {
    const avecDemande = invitationDirecte(RAISON, {
      etat: etatsBulle(
        { [AUTRE]: PUBLIC_CLIENT, [MOI]: { pseudo: 'puma', zone: 'Nzeng' } },
        AUTRE,
        {
          demande: { annonce: '$d', service: 'x', zone: 'y', budget: 5, texte: '' },
        },
      ),
    });
    const c1 = clientPresta(avecDemande);
    await expect(accepterOffre(comme(c1), BULLE)).rejects.toThrow();
    expect(c1.leave).toHaveBeenCalledWith(BULLE);

    const mauvaisCreateur = invitationDirecte(RAISON, { createur: INTRUS });
    const c2 = clientPresta(mauvaisCreateur);
    await expect(accepterOffre(comme(c2), BULLE)).rejects.toThrow();
    expect(c2.leave).toHaveBeenCalledWith(BULLE);
  });

  it("l'accepter est refusé si la bulle n'est pas chiffrée", async () => {
    const inv = invitationDirecte(RAISON);
    const c = fauxClient([inv.salon], false);
    c.joinRoom.mockImplementation(async () => {
      inv.apres();
      return inv.salon as never;
    });
    const resultat = expect(accepterOffre(comme(c), BULLE)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(11_000);
    await resultat;
    expect(c.leave).toHaveBeenCalledWith(BULLE);
    expect(c.prepareToEncrypt).not.toHaveBeenCalled();
  });

  it("n'enregistre jamais un pseudo venu de la raison d'une invitation (pas de blocage de pseudo)", () => {
    const c = fauxClient([invitationDirecte(RAISON).salon]);
    expect(listerBulles(comme(c)).length).toBe(1);
    expect(localStorage.getItem('sia.annuaire')).toBeNull();
  });

  it("quitte sans bruit une invitation dont l'invitant est déjà parti", () => {
    const c = fauxClient([invitationDirecte(RAISON, { parti: true }).salon]);
    expect(listerBulles(comme(c))).toEqual([]);
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  describe("plafond d'invitations directes", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `!inv${i}:sia.tail94dc60.ts.net`);
    // Des personnes différentes (une seule bulle par personne).
    const salons = () =>
      ids.map((id, i) => invitationDirecte(RAISON, { id, ts: i + 1, de: `@c${i}:sia` }).salon);

    it(`n'en montre que ${MAX_INVITATIONS_DIRECTES} (les plus récentes) et quitte les autres sans bruit`, () => {
      const c = fauxClient(salons());
      const vues = listerBulles(comme(c)).map((b) => b.roomId);
      expect(vues).toHaveLength(MAX_INVITATIONS_DIRECTES);
      expect(vues).toEqual(ids.slice(3).reverse());
      expect(c.leave.mock.calls.map((a) => (a as unknown[])[0]).sort()).toEqual(
        ids.slice(0, 3).sort(),
      );
    });

    it("refuse d'accepter une invitation au-delà du plafond (elle est quittée)", async () => {
      const c = fauxClient(salons());
      await expect(accepterOffre(comme(c), ids[0] as string)).rejects.toThrow();
      expect(c.leave).toHaveBeenCalledWith(ids[0]);
      expect(c.joinRoom).not.toHaveBeenCalled();
    });

    it("compte seulement les invitations valables : une invitation invalide ne prend pas de place", () => {
      const valables = salons().slice(0, 10);
      const poubelle = invitationDirecte('texte libre', { id: '!x:sia.tail94dc60.ts.net', ts: 99 });
      const c = fauxClient([...valables, poubelle.salon]);
      expect(listerBulles(comme(c))).toHaveLength(10);
    });
  });
});

/** Bulle rejointe par moi, avec AUTRE (« join » ou « invite »), créée par `createur`. */
function bulleOuverte(id: string, autre: 'join' | 'invite', createur: string, ts = 0) {
  const invite = evenement({ type: 'm.room.member', stateKey: AUTRE, sender: createur, content: {} });
  const participants =
    createur === MOI
      ? { [MOI]: PUBLIC_CLIENT, [AUTRE]: { pseudo: 'puma', zone: 'Nzeng' } }
      : { [AUTRE]: PUBLIC_CLIENT, [MOI]: { pseudo: 'puma', zone: 'Nzeng' } };
  return salon({
    roomId: id,
    appartenance: 'join',
    ts,
    createur,
    membres: { [MOI]: { membership: 'join' }, [AUTRE]: { membership: autre, event: invite } },
    etat: etatsBulle(participants, createur),
    evenements: [],
  });
}

const vues = (c: ReturnType<typeof fauxClient>) => listerBulles(comme(c)).map((b) => b.roomId);
const quittees = (c: ReturnType<typeof fauxClient>) =>
  c.leave.mock.calls.map((a) => (a as unknown[])[0]);

describe('une seule bulle par paire de personnes', () => {
  it('bulleAvec trouve la bulle ouverte avec cette personne, rien avec une autre', () => {
    const c = fauxClient([murAvecPresta(), bulleOuverte(BULLE, 'join', AUTRE)]);
    expect(bulleAvec(comme(c), AUTRE)).toBe(BULLE);
    expect(bulleAvec(comme(c), INTRUS)).toBeNull();
    expect(bulleAvec(comme(c), MOI)).toBeNull();
    expect(bulleAvec(comme(c), 42 as unknown as string)).toBeNull();
  });

  it("bulleAvec ignore une bulle dont l'autre est parti", () => {
    const c = fauxClient([murAvecPresta(), bulleCreee({ [AUTRE]: { membership: 'leave' } })]);
    expect(bulleAvec(comme(c), AUTRE)).toBeNull();
  });

  it('demanderA réutilise la bulle déjà ouverte (ouverte par « Oui » de l’autre) sans rien créer', async () => {
    const c = fauxClient([murAvecPresta(), bulleOuverte(BULLE, 'join', AUTRE)]);
    await expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).resolves.toEqual({
      roomId: BULLE,
      reutilisee: true,
    });
    expect(c.createRoom).not.toHaveBeenCalled();
    expect(c.invite).not.toHaveBeenCalled();
  });

  it('demanderA accepte d’abord l’invitation de la même personne, puis la rend', async () => {
    const c = clientPresta(invitationDirecte(RAISON));
    await expect(demanderA(comme(c), AUTRE, PUBLIC_CLIENT)).resolves.toEqual({
      roomId: BULLE,
      reutilisee: true,
    });
    expect(c.joinRoom).toHaveBeenCalledWith(BULLE);
    expect(c.createRoom).not.toHaveBeenCalled();
  });

  it('invitation en double : la bulle où les deux sont entrés est gardée, l’invitation est quittée', () => {
    const doublon = invitationDirecte(RAISON, { id: '!a1:sia.tail94dc60.ts.net', ts: 9 });
    const c = fauxClient([bulleOuverte('!b9:sia.tail94dc60.ts.net', 'join', AUTRE), doublon.salon]);
    expect(vues(c)).toEqual(['!b9:sia.tail94dc60.ts.net']);
    expect(quittees(c)).toEqual(['!a1:sia.tail94dc60.ts.net']);
    expect(bulleAvec(comme(c), AUTRE)).toBe('!b9:sia.tail94dc60.ts.net');
  });

  it('deux bulles où les deux sont entrés (bug constaté) : la plus petite est gardée', () => {
    const c = fauxClient([
      bulleOuverte('!c2:sia.tail94dc60.ts.net', 'join', MOI, 5),
      bulleOuverte('!c1:sia.tail94dc60.ts.net', 'join', AUTRE, 1),
    ]);
    expect(vues(c)).toEqual(['!c1:sia.tail94dc60.ts.net']);
    expect(quittees(c)).toEqual(['!c2:sia.tail94dc60.ts.net']);
  });

  it('course croisée : chacun garde la bulle au plus petit identifiant et quitte l’autre', () => {
    // Côté A : ma bulle !b2 (l'autre invité) + l'invitation !b1 de l'autre → garde !b1.
    const a = fauxClient([
      bulleOuverte('!b2:sia.tail94dc60.ts.net', 'invite', MOI),
      invitationDirecte(RAISON, { id: '!b1:sia.tail94dc60.ts.net' }).salon,
    ]);
    expect(vues(a)).toEqual(['!b1:sia.tail94dc60.ts.net']);
    expect(quittees(a)).toEqual(['!b2:sia.tail94dc60.ts.net']);
    // Côté B (même règle) : sa bulle !d1 + l'invitation !d2 → garde aussi la plus petite, !d1.
    const b = fauxClient([
      bulleOuverte('!d1:sia.tail94dc60.ts.net', 'invite', MOI),
      invitationDirecte(RAISON, { id: '!d2:sia.tail94dc60.ts.net' }).salon,
    ]);
    expect(vues(b)).toEqual(['!d1:sia.tail94dc60.ts.net']);
    expect(quittees(b)).toEqual(['!d2:sia.tail94dc60.ts.net']);
  });

  it('course croisée pendant « Demander » : ma bulle refusée, on rejoint celle de l’autre', async () => {
    const sienne = invitationDirecte(RAISON, { id: '!a1:sia.tail94dc60.ts.net' });
    const c = fauxClient([murAvecPresta()]);
    c.createRoom.mockImplementation(async () => {
      // Pendant la création, l'autre m'invite dans sa bulle (plus petite) et quitte la mienne.
      c.salons.push(bulleCreee({ [AUTRE]: { membership: 'leave' } }), sienne.salon);
      return { room_id: BULLE };
    });
    c.joinRoom.mockImplementation(async (id: string) => {
      if (id !== '!a1:sia.tail94dc60.ts.net') return c.salons[0] as never; // le Mur
      sienne.apres();
      return sienne.salon as never;
    });
    const resultat = demanderA(comme(c), AUTRE, PUBLIC_CLIENT);
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(resultat).resolves.toEqual({
      roomId: '!a1:sia.tail94dc60.ts.net',
      reutilisee: true,
    });
    expect(c.leave).toHaveBeenCalledWith(BULLE);
    expect(c.joinRoom).toHaveBeenCalledWith('!a1:sia.tail94dc60.ts.net');
  });
});
