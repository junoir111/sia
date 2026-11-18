import type { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIAS_MUR } from '../src/config';
import type { DemandeClient } from '../src/logique/demande';
import {
  accepterNouvelAppareil,
  accepterOffre,
  bulleSaine,
  direOui,
  ErreurEnvoiBulle,
  envoyerMessage,
  fermerBullesRefusees,
  listerBulles,
  LONGUEUR_MAX_MESSAGE,
  reessayerMessage,
  silenceRadio,
  surveillerBulle,
} from '../src/matrix/bulles';
import { oublierMur } from '../src/matrix/mur';
import { AUTRE, MOI, MUR, comme, evenement, fauxClient, salon } from './faux-matrix';
import type { FauxClient } from './faux-matrix';

const MAINTENANT = Date.UTC(2026, 10, 17, 10, 0, 0);
const BULLE = '!b1:sia.tail94dc60.ts.net';
const DEMANDE: DemandeClient = {
  pseudo: 'palmier-48',
  service: 'Plombier',
  zone: 'Akanda',
  texte: 'Fuite',
  budget: 5000,
  fin: MAINTENANT + 3_600_000,
};

function murAvecDemande(sender = AUTRE) {
  const ev = evenement({
    type: 'io.sia.annonce',
    id: '$dem',
    sender,
    content: { role: 'client', ...DEMANDE },
  });
  return salon({
    roomId: MUR,
    appartenance: 'join',
    membres: {},
    etat: {},
    evenements: [ev],
    alias: ALIAS_MUR,
  });
}

const ETAT_BULLE = {
  demande: { annonce: '$dem', service: 'Plombier', zone: 'Akanda', budget: 5000, texte: 'Fuite' },
  participants: {
    [MOI]: { pseudo: 'puma', zone: 'Nzeng' },
    [AUTRE]: { pseudo: 'palmier-48', zone: 'Akanda' },
  },
};

/** Bulle vue par le client (moi) : créée par le prestataire AUTRE (« puma »). */
const ETAT_CLIENT = {
  demande: ETAT_BULLE.demande,
  participants: {
    [AUTRE]: { pseudo: 'puma', zone: 'Nzeng' },
    [MOI]: { pseudo: 'palmier-48', zone: 'Akanda' },
  },
};
const INTRUS = '@intrus:sia.tail94dc60.ts.net';
const RAISON = 'puma (Nzeng) dit oui [ref:$dem]';

function etatChiffre(
  etatBulle: unknown = ETAT_BULLE,
  createur: string = MOI,
): Record<string, MatrixEvent> {
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
      content: etatBulle as Record<string, unknown>,
    }),
  };
}

function invitation(roomId: string, raison: string) {
  const ev = evenement({
    type: 'm.room.member',
    stateKey: MOI,
    sender: AUTRE,
    content: { membership: 'invite', reason: raison },
  });
  return salon({
    roomId,
    appartenance: 'invite',
    membres: { [MOI]: { membership: 'invite', event: ev } },
    etat: {},
    evenements: [],
  });
}

type Membres = Record<string, { membership: string; typing?: boolean }>;

/** Bulle à 2 (moi et AUTRE, tous deux dedans), créée par `createur`. */
function bulleA2(createur: string, etat: Record<string, MatrixEvent>, membres: Membres = {}) {
  return salon({
    roomId: BULLE,
    appartenance: 'join',
    createur,
    membres: { [MOI]: { membership: 'join' }, [AUTRE]: { membership: 'join' }, ...membres },
    etat,
    evenements: [],
  });
}

/** Bulle rejointe par le client (moi), créée par AUTRE. */
function bulleClient(membres: Membres = {}) {
  return bulleA2(AUTRE, etatChiffre(ETAT_CLIENT, AUTRE), membres);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(MAINTENANT);
  oublierMur();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('direOui', () => {
  it('crée une bulle chiffrée « SIA · Bulle » et invite le client avec la référence', async () => {
    const c = fauxClient([murAvecDemande()]);
    const { roomId, reutilisee } = await direOui(comme(c), DEMANDE, '$dem', {
      pseudo: 'puma',
      zone: 'Nzeng',
    });
    expect(roomId).toBe('!bulle:sia.tail94dc60.ts.net');
    expect(reutilisee).toBe(false);
    const options = (c.createRoom.mock.calls[0] as unknown[] | undefined)?.[0] as Record<
      string,
      unknown
    >;
    expect(options).toMatchObject({ name: 'SIA · Bulle', preset: 'private_chat' });
    expect(options.initial_state).toEqual([
      { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
      { type: 'io.sia.bulle', state_key: '', content: ETAT_BULLE },
    ]);
    expect(c.invite).toHaveBeenCalledWith(roomId, AUTRE, {
      reason: 'puma (Nzeng) dit oui [ref:$dem]',
    });
  });

  it('refuse une demande modifiée, introuvable, expirée ou la mienne', async () => {
    const c = fauxClient([murAvecDemande()]);
    const moi = { pseudo: 'puma', zone: 'Nzeng' };
    await expect(direOui(comme(c), { ...DEMANDE, budget: 1 }, '$dem', moi)).rejects.toThrow();
    await expect(direOui(comme(c), DEMANDE, '$inconnue', moi)).rejects.toThrow();
    await expect(
      direOui(comme(c), DEMANDE, '$dem', { pseudo: '', zone: 'Nzeng' }),
    ).rejects.toThrow();
    vi.setSystemTime(DEMANDE.fin + 1);
    await expect(direOui(comme(c), DEMANDE, '$dem', moi)).rejects.toThrow();
    vi.setSystemTime(MAINTENANT);
    oublierMur();
    const c2 = fauxClient([murAvecDemande(MOI)]);
    await expect(direOui(comme(c2), DEMANDE, '$dem', moi)).rejects.toThrow();
    expect(c.createRoom).not.toHaveBeenCalled();
    expect(c2.createRoom).not.toHaveBeenCalled();
  });

  it('réutilise la bulle déjà ouverte avec ce client (« Demander » de sa part) sans en créer une 2e', async () => {
    const directe = { participants: ETAT_CLIENT.participants };
    const c = fauxClient([murAvecDemande(), bulleA2(AUTRE, etatChiffre(directe, AUTRE))]);
    await expect(
      direOui(comme(c), DEMANDE, '$dem', { pseudo: 'puma', zone: 'Nzeng' }),
    ).resolves.toEqual({ roomId: BULLE, reutilisee: true });
    expect(c.createRoom).not.toHaveBeenCalled();
    expect(c.invite).not.toHaveBeenCalled();
  });

  it("quitte la bulle créée si l'invitation échoue", async () => {
    const c = fauxClient([murAvecDemande()]);
    c.invite.mockRejectedValueOnce(new Error('réseau'));
    await expect(
      direOui(comme(c), DEMANDE, '$dem', { pseudo: 'puma', zone: 'Nzeng' }),
    ).rejects.toThrow();
    expect(c.leave).toHaveBeenCalledWith('!bulle:sia.tail94dc60.ts.net');
  });
});

describe('accepterOffre', () => {
  it('rejoint la bulle chiffrée puis refuse les offres sœurs (même demande) seulement', async () => {
    const choisie = invitation(BULLE, 'puma (Nzeng) dit oui [ref:$dem]');
    const soeur = invitation('!b2:x', 'lion (Owendo) dit oui [ref:$dem]');
    const autreDemande = invitation('!b3:x', 'lion (Owendo) dit oui [ref:$autre]');
    const c = fauxClient([murAvecDemande(MOI), choisie, soeur, autreDemande]);
    localStorage.setItem('sia.demande', JSON.stringify({ eventId: '$dem', demande: DEMANDE }));
    c.joinRoom.mockImplementation(async (id: string) => {
      if (id !== BULLE) return c.salons[0] as (typeof c.salons)[number];
      c.salons[1] = bulleClient();
      return c.salons[1];
    });
    await accepterOffre(comme(c), BULLE);
    expect(c.joinRoom).toHaveBeenCalledWith(BULLE);
    expect(c.leave.mock.calls).toEqual([['!b2:x']]);
    // Le choix est fait : la demande quitte le Mur et ce téléphone.
    expect(c.redactEvent).toHaveBeenCalledWith(MUR, '$dem');
    expect(localStorage.getItem('sia.demande')).toBeNull();
  });

  it('refuse (et quitte) une bulle avec un 3e membre, un participant étranger ou un autre créateur', async () => {
    const etranger = {
      ...ETAT_CLIENT,
      participants: {
        [AUTRE]: ETAT_CLIENT.participants[AUTRE],
        [INTRUS]: { pseudo: 'x', zone: 'y' },
      },
    };
    const cas = [
      () => bulleClient({ [INTRUS]: { membership: 'invite' } }),
      () => bulleA2(AUTRE, etatChiffre(etranger, AUTRE)),
      () => bulleA2(INTRUS, etatChiffre(ETAT_CLIENT, INTRUS)),
    ];
    for (const rejointe of cas) {
      oublierMur();
      const c = fauxClient([murAvecDemande(MOI), invitation(BULLE, RAISON)]);
      c.joinRoom.mockImplementation(async () => {
        c.salons[1] = rejointe();
        return c.salons[1];
      });
      await expect(accepterOffre(comme(c), BULLE)).rejects.toThrow(/invalide/);
      expect(c.leave).toHaveBeenCalledWith(BULLE);
      expect(c.redactEvent).not.toHaveBeenCalled();
    }
  });

  it('refuse sans rejoindre une offre qui ne répond pas à MA demande valable', async () => {
    const pasLaMienne = fauxClient([murAvecDemande(AUTRE), invitation(BULLE, RAISON)]);
    await expect(accepterOffre(comme(pasLaMienne), BULLE)).rejects.toThrow();
    expect(pasLaMienne.joinRoom).not.toHaveBeenCalled();
    expect(pasLaMienne.leave).toHaveBeenCalledWith(BULLE);
    oublierMur();
    vi.setSystemTime(DEMANDE.fin + 1);
    const expiree = fauxClient([murAvecDemande(MOI), invitation(BULLE, RAISON)]);
    await expect(accepterOffre(comme(expiree), BULLE)).rejects.toThrow();
    expect(expiree.joinRoom).not.toHaveBeenCalled();
  });

  it("quitte une bulle qui n'est pas chiffrée", async () => {
    const c = fauxClient([murAvecDemande(MOI), invitation(BULLE, RAISON)]);
    c.joinRoom.mockImplementation(async () => {
      c.salons[1] = salon({
        roomId: BULLE,
        appartenance: 'join',
        membres: {},
        etat: {},
        evenements: [],
      });
      return c.salons[1];
    });
    const resultat = accepterOffre(comme(c), BULLE);
    const verif = expect(resultat).rejects.toThrow(/chiffrée/);
    await vi.advanceTimersByTimeAsync(11_000);
    await verif;
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it('refuse un identifiant de salon invalide', async () => {
    const c = fauxClient([]);
    await expect(accepterOffre(comme(c), 'pas-un-salon')).rejects.toThrow();
  });
});

describe('envoyerMessage', () => {
  function bulle(etat = etatChiffre(), membres: Membres = {}) {
    return bulleA2(MOI, etat, membres);
  }

  it('envoie un texte dans une bulle chiffrée et programme son effacement', async () => {
    const c = fauxClient([bulle()], true, { [AUTRE]: ['TEL1'] });
    const id = await envoyerMessage(comme(c), BULLE, '  Bonjour  ');
    expect(c.sendMessage).toHaveBeenCalledWith(BULLE, { msgtype: 'm.text', body: 'Bonjour' });
    expect(localStorage.getItem('sia.a-effacer')).toContain(id);
    expect(bulleSaine(comme(c), BULLE)).toBe(true);
  });

  it("refuse et quitte une bulle à 3 ; refuse sans quitter si l'autre est parti", async () => {
    const aTrois = fauxClient([bulle(etatChiffre(), { [INTRUS]: { membership: 'join' } })]);
    expect(bulleSaine(comme(aTrois), BULLE)).toBe(false);
    await expect(envoyerMessage(comme(aTrois), BULLE, 'Salut')).rejects.toThrow();
    expect(aTrois.leave).toHaveBeenCalledWith(BULLE);
    const parti = fauxClient([bulle(etatChiffre(), { [AUTRE]: { membership: 'leave' } })]);
    expect(bulleSaine(comme(parti), BULLE)).toBe(false);
    await expect(envoyerMessage(comme(parti), BULLE, 'Salut')).rejects.toThrow(/fermée/);
    expect(aTrois.sendMessage).not.toHaveBeenCalled();
    expect(parti.sendMessage).not.toHaveBeenCalled();
    expect(parti.leave).not.toHaveBeenCalled();
  });

  it("nouvel appareil de l'autre : rien n'est envoyé tant que je n'ai pas accepté", async () => {
    const c = fauxClient([bulle()], true, { [AUTRE]: ['TEL1'] });
    await envoyerMessage(comme(c), BULLE, 'un');
    expect(JSON.parse(localStorage.getItem('sia.appareils') ?? '{}')).toEqual({
      [BULLE]: ['TEL1'],
    });
    c.appareils[AUTRE] = ['TEL1', 'ESPION'];
    const refus: unknown = await envoyerMessage(comme(c), BULLE, 'deux').catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(ErreurEnvoiBulle);
    expect((refus as ErreurEnvoiBulle).code).toBe('nouvel-appareil');
    expect(c.sendMessage).toHaveBeenCalledTimes(1);
    await accepterNouvelAppareil(comme(c), BULLE);
    await envoyerMessage(comme(c), BULLE, 'trois');
    expect(c.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("refuse d'écrire si la bulle n'est pas chiffrée (état ou module)", async () => {
    const sansEtat = fauxClient([
      bulle({ 'io.sia.bulle': etatChiffre()['io.sia.bulle'] as MatrixEvent }),
    ]);
    await expect(envoyerMessage(comme(sansEtat), BULLE, 'Salut')).rejects.toThrow(/chiffrée/);
    const sansModule = fauxClient([bulle()], false);
    await expect(envoyerMessage(comme(sansModule), BULLE, 'Salut')).rejects.toThrow(/chiffrée/);
    const mauvaisAlgo = etatChiffre();
    mauvaisAlgo['m.room.encryption'] = evenement({
      type: 'm.room.encryption',
      stateKey: '',
      content: { algorithm: 'aucun' },
    });
    await expect(
      envoyerMessage(comme(fauxClient([bulle(mauvaisAlgo)])), BULLE, 'Salut'),
    ).rejects.toThrow();
    expect(sansEtat.sendMessage).not.toHaveBeenCalled();
    expect(sansModule.sendMessage).not.toHaveBeenCalled();
  });

  it('refuse un message vide ou trop long', async () => {
    const c = fauxClient([bulle()]);
    await expect(envoyerMessage(comme(c), BULLE, '   ')).rejects.toThrow();
    await expect(
      envoyerMessage(comme(c), BULLE, 'x'.repeat(LONGUEUR_MAX_MESSAGE + 1)),
    ).rejects.toThrow();
    expect(c.sendMessage).not.toHaveBeenCalled();
  });
});

describe('envoi rapide (bulle surveillée)', () => {
  /** Laisse finir les vérifications lancées en arrière-plan (aucun réseau : tout est simulé). */
  async function vider(): Promise<void> {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  }

  /** Client dont le module de chiffrement compte les demandes d'appareils. */
  function clientCompte(membres: Record<string, { membership: string }>) {
    const s = salon({
      roomId: BULLE,
      appartenance: 'join',
      createur: MOI,
      membres,
      etat: etatChiffre(),
      evenements: [],
    });
    const c = fauxClient([s], true, { [AUTRE]: ['TEL1'] });
    const crypto = c.getCrypto();
    const demandes = vi.fn(crypto?.getUserDeviceInfo);
    vi.spyOn(c, 'getCrypto').mockReturnValue(crypto && { ...crypto, getUserDeviceInfo: demandes });
    return { c, s, demandes };
  }

  function aDeux() {
    return { [MOI]: { membership: 'join' }, [AUTRE]: { membership: 'join' } };
  }

  function membresChanges(c: FauxClient): void {
    c.emit('RoomState.members', evenement({ type: 'm.room.member' }), { roomId: BULLE }, {});
  }

  it('après l’ouverture, un message ne coûte plus que sendMessage', async () => {
    const { c, s, demandes } = clientCompte(aDeux());
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    expect(demandes).toHaveBeenCalledTimes(1);
    demandes.mockClear();
    s.loadMembersIfNeeded.mockClear();
    const envoi = envoyerMessage(comme(c), BULLE, 'Salut');
    // sendMessage part aussitôt, sans attendre d'autre réponse.
    expect(c.sendMessage).toHaveBeenCalledWith(BULLE, { msgtype: 'm.text', body: 'Salut' });
    await envoi;
    await envoyerMessage(comme(c), BULLE, 'Encore');
    expect(demandes).not.toHaveBeenCalled();
    expect(s.loadMembersIfNeeded).not.toHaveBeenCalled();
    expect(c.sendMessage).toHaveBeenCalledTimes(2);
    arreter();
  });

  it('nouvel appareil annoncé : le prochain envoi est refusé, rien ne part', async () => {
    const { c } = clientCompte(aDeux());
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    c.appareils[AUTRE] = ['TEL1', 'ESPION'];
    c.emit('crypto.devicesUpdated', [AUTRE], false);
    await vider();
    const refus: unknown = await envoyerMessage(comme(c), BULLE, 'x').catch((e: unknown) => e);
    expect(refus).toBeInstanceOf(ErreurEnvoiBulle);
    expect((refus as ErreurEnvoiBulle).code).toBe('nouvel-appareil');
    expect(c.sendMessage).not.toHaveBeenCalled();
    await accepterNouvelAppareil(comme(c), BULLE);
    await envoyerMessage(comme(c), BULLE, 'y');
    expect(c.sendMessage).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('un 3e membre arrivé : refus immédiat (état en mémoire), bulle quittée', async () => {
    const membres: Record<string, { membership: string }> = aDeux();
    const { c } = clientCompte(membres);
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    membres[INTRUS] = { membership: 'join' };
    await expect(envoyerMessage(comme(c), BULLE, 'x')).rejects.toThrow(/invalide/);
    expect(c.sendMessage).not.toHaveBeenCalled();
    expect(c.leave).toHaveBeenCalledWith(BULLE);
    arreter();
  });

  it('les membres changent : les vérifications sont refaites', async () => {
    const { c, s } = clientCompte(aDeux());
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    s.loadMembersIfNeeded.mockClear();
    membresChanges(c);
    await vider();
    expect(s.loadMembersIfNeeded).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('sans surveillance, chaque envoi refait toutes les vérifications', async () => {
    const { c, demandes } = clientCompte(aDeux());
    const arreter = surveillerBulle(comme(c), BULLE);
    await vider();
    arreter();
    demandes.mockClear();
    await envoyerMessage(comme(c), BULLE, 'a');
    await envoyerMessage(comme(c), BULLE, 'b');
    expect(demandes).toHaveBeenCalledTimes(2);
  });

  it('serveur injoignable : ErreurEnvoiBulle « pas-envoye » (message réessayable)', async () => {
    const { c } = clientCompte(aDeux());
    c.sendMessage.mockRejectedValueOnce(new Error('réseau'));
    const refus: unknown = await envoyerMessage(comme(c), BULLE, 'x').catch((e: unknown) => e);
    expect((refus as ErreurEnvoiBulle).code).toBe('pas-envoye');
    expect(localStorage.getItem('sia.a-effacer')).toBeNull();
  });
});

describe('reessayerMessage', () => {
  function echo(sender: string, status: string | null) {
    const ev = evenement({
      type: 'm.room.message',
      id: '~local',
      sender,
      roomId: BULLE,
      content: { msgtype: 'm.text', body: 'raté' },
    });
    ev.status = status as MatrixEvent['status'];
    return ev;
  }

  function avec(ev: MatrixEvent) {
    const s = salon({
      roomId: BULLE,
      appartenance: 'join',
      createur: MOI,
      membres: { [MOI]: { membership: 'join' }, [AUTRE]: { membership: 'join' } },
      etat: etatChiffre(),
      evenements: [ev],
    });
    return fauxClient([s], true, { [AUTRE]: ['TEL1'] });
  }

  it('renvoie mon message « pas envoyé » et lance son effacement', async () => {
    const ev = echo(MOI, 'not_sent');
    const c = avec(ev);
    const id = await reessayerMessage(comme(c), BULLE, '~local');
    expect(c.resendEvent).toHaveBeenCalledWith(ev, c.salons[0]);
    expect(localStorage.getItem('sia.a-effacer')).toContain(id);
  });

  it('refuse un message d’un autre, déjà envoyé, ou inconnu', async () => {
    for (const ev of [echo(AUTRE, 'not_sent'), echo(MOI, 'sending'), echo(MOI, null)]) {
      const c = avec(ev);
      await expect(reessayerMessage(comme(c), BULLE, '~local')).rejects.toThrow();
      await expect(reessayerMessage(comme(c), BULLE, '~autre')).rejects.toThrow();
      expect(c.resendEvent).not.toHaveBeenCalled();
    }
  });
});

describe('listerBulles', () => {
  it("montre pseudo et zone de l'autre, jamais son identifiant Matrix", () => {
    const msg = evenement({
      type: 'm.room.message',
      sender: AUTRE,
      roomId: BULLE,
      content: { body: 'x' },
    });
    const b = salon({
      roomId: BULLE,
      appartenance: 'join',
      createur: MOI,
      membres: { [MOI]: { membership: 'join' }, [AUTRE]: { membership: 'join', typing: true } },
      etat: etatChiffre(),
      evenements: [msg],
    });
    const [resume] = listerBulles(comme(fauxClient([b])));
    expect(resume).toEqual({
      roomId: BULLE,
      autre: { pseudo: 'palmier-48', zone: 'Akanda' },
      demande: ETAT_BULLE.demande,
      etat: 'ouverte',
      nonLus: 1,
      autreEcrit: true,
    });
    expect(JSON.stringify(resume)).not.toContain(AUTRE);
  });

  it("lit une offre reçue depuis la raison de l'invitation", () => {
    const [resume] = listerBulles(
      comme(fauxClient([murAvecDemande(MOI), invitation(BULLE, RAISON)])),
    );
    expect(resume).toMatchObject({
      autre: { pseudo: 'puma', zone: 'Nzeng' },
      etat: 'invitation-recue',
      demande: ETAT_BULLE.demande,
    });
  });

  it("refuse sans bruit une offre pour une demande qui n'est pas la mienne", () => {
    const c = fauxClient([murAvecDemande(AUTRE), invitation(BULLE, RAISON)]);
    expect(listerBulles(comme(c))).toEqual([]);
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it('accepte une offre pour la demande gardée par ce téléphone (Mur pas encore chargé)', () => {
    localStorage.setItem('sia.demande', JSON.stringify({ eventId: '$dem', demande: DEMANDE }));
    const c = fauxClient([invitation(BULLE, RAISON)]);
    expect(listerBulles(comme(c))).toHaveLength(1);
    expect(c.leave).not.toHaveBeenCalled();
  });

  it("pseudo usurpé : l'offre d'un autre compte avec un pseudo déjà vu est refusée", () => {
    localStorage.setItem(
      'sia.annuaire',
      JSON.stringify([{ userId: '@vrai:sia.tail94dc60.ts.net', pseudo: 'puma' }]),
    );
    const c = fauxClient([
      murAvecDemande(MOI),
      invitation(BULLE, 'Puma (Nzeng) dit oui [ref:$dem]'),
    ]);
    expect(listerBulles(comme(c))).toEqual([]);
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it("dans la bulle, le pseudo de l'autre est celui de l'annuaire pour son compte", () => {
    localStorage.setItem(
      'sia.annuaire',
      JSON.stringify([{ userId: AUTRE, pseudo: 'palmier-vrai' }]),
    );
    const [resume] = listerBulles(comme(fauxClient([bulleA2(MOI, etatChiffre())])));
    expect(resume?.autre.pseudo).toBe('palmier-vrai');
  });

  it('quitte sans bruit une bulle à 3 membres', () => {
    const c = fauxClient([bulleA2(MOI, etatChiffre(), { [INTRUS]: { membership: 'invite' } })]);
    expect(listerBulles(comme(c))).toEqual([]);
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });

  it('ignore le Mur, les bulles non chiffrées et les états mal formés', () => {
    const sansChiffrement = salon({
      roomId: BULLE,
      appartenance: 'join',
      membres: {},
      etat: { 'io.sia.bulle': etatChiffre()['io.sia.bulle'] as MatrixEvent },
      evenements: [],
    });
    const etatFaux = salon({
      roomId: '!b2:x',
      appartenance: 'join',
      membres: {},
      etat: etatChiffre({ participants: 'x' }),
      evenements: [],
    });
    const invitationSansRef = invitation('!b3:x', 'viens');
    const c = fauxClient([murAvecDemande(), sansChiffrement, etatFaux, invitationSansRef]);
    expect(listerBulles(comme(c))).toEqual([]);
  });
});

describe('fermerBullesRefusees', () => {
  it("quitte une bulle dont le client est parti sans l'avoir rejointe", async () => {
    const depart = evenement({
      type: 'm.room.member',
      stateKey: AUTRE,
      sender: AUTRE,
      content: { membership: 'leave' },
      prevContent: { membership: 'invite' },
    });
    const departApres = evenement({
      type: 'm.room.member',
      stateKey: AUTRE,
      sender: AUTRE,
      content: { membership: 'leave' },
      prevContent: { membership: 'join' },
    });
    const refusee = salon({
      roomId: BULLE,
      appartenance: 'join',
      membres: { [AUTRE]: { membership: 'leave', event: depart } },
      etat: etatChiffre(),
      evenements: [],
    });
    const fermeeApres = salon({
      roomId: '!b2:x',
      appartenance: 'join',
      membres: { [AUTRE]: { membership: 'leave', event: departApres } },
      etat: etatChiffre(),
      evenements: [],
    });
    const c = fauxClient([refusee, fermeeApres]);
    await fermerBullesRefusees(comme(c));
    expect(c.leave.mock.calls).toEqual([[BULLE]]);
  });
});

describe('silenceRadio', () => {
  it('efface les messages puis quitte la bulle', async () => {
    const msg = evenement({ type: 'm.room.message', sender: AUTRE, roomId: BULLE, id: '$m1' });
    const b = salon({
      roomId: BULLE,
      appartenance: 'join',
      membres: {},
      etat: etatChiffre(),
      evenements: [msg],
    });
    const c = fauxClient([b]);
    await silenceRadio(comme(c), BULLE);
    expect(c.redactEvent).toHaveBeenCalledWith(BULLE, '$m1');
    expect(c.leave).toHaveBeenCalledWith(BULLE);
  });
});
