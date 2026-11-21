import { RoomEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIAS_MUR } from '../src/config';
import type { DemandeClient } from '../src/logique/demande';
import {
  demandesActives,
  ecouterDemandes,
  lireDemande,
  maDemandeValable,
  nettoyerStatut,
  oublierDemandeLocale,
  oublierMur,
  publierDemande,
  publierStatut,
  rejoindreMur,
  retirerDemande,
  retirerStatut,
} from '../src/matrix/mur';
import { AUTRE, MOI, MUR, comme, evenement, fauxClient, salon } from './faux-matrix';

const MAINTENANT = Date.UTC(2026, 10, 17, 10, 0, 0);
const HEURE = 3_600_000;

function demande(fin = MAINTENANT + HEURE): DemandeClient {
  return {
    pseudo: 'palmier-48',
    service: 'Plombier',
    zone: 'Akanda',
    texte: 'Fuite',
    budget: 5000,
    fin,
  };
}

function annonce(
  contenu: Record<string, unknown>,
  o: { id?: string; ts?: number; redacted?: boolean } = {},
) {
  return evenement({ type: 'io.sia.annonce', content: contenu, sender: AUTRE, ...o });
}

function mur(evenements = [] as ReturnType<typeof evenement>[]) {
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

describe('nettoyerStatut', () => {
  it('garde un statut valide et retire les champs en trop', () => {
    const s = {
      pseudo: ' puma ',
      metier: 'Coiffeur',
      zone: 'Nzeng',
      fin: MAINTENANT + HEURE,
      photo: 'x',
    };
    expect(nettoyerStatut(s, MAINTENANT)).toEqual({
      pseudo: 'puma',
      metier: 'Coiffeur',
      zone: 'Nzeng',
      fin: MAINTENANT + HEURE,
    });
  });

  it('refuse une fin à plus de 24 h, un texte trop long ou un mauvais type', () => {
    const base = { pseudo: 'puma', metier: 'Coiffeur', zone: 'Nzeng', fin: MAINTENANT + HEURE };
    expect(nettoyerStatut({ ...base, fin: MAINTENANT + 25 * HEURE }, MAINTENANT)).toBeNull();
    expect(nettoyerStatut({ ...base, pseudo: 'x'.repeat(31) }, MAINTENANT)).toBeNull();
    expect(nettoyerStatut({ ...base, metier: 'x'.repeat(41) }, MAINTENANT)).toBeNull();
    expect(nettoyerStatut({ ...base, fin: '1' }, MAINTENANT)).toBeNull();
    expect(nettoyerStatut({ ...base, fin: 1.5 }, MAINTENANT)).toBeNull();
    expect(nettoyerStatut([base], MAINTENANT)).toBeNull();
    expect(nettoyerStatut(null, MAINTENANT)).toBeNull();
  });
});

describe('nettoyerStatut : modalite', () => {
  const base = { pseudo: 'puma', metier: 'Coiffeur', zone: 'Nzeng', fin: MAINTENANT + HEURE };

  it('garde une modalité connue', () => {
    for (const modalite of ['recoit', 'deplace', 'les-deux']) {
      expect(nettoyerStatut({ ...base, modalite }, MAINTENANT)).toEqual({ ...base, modalite });
    }
  });

  it('une modalité inconnue ou mal typée donne un statut sans modalité, sans refus', () => {
    for (const modalite of ['teleporte', 3, null, {}, ['recoit'], 'RECOIT']) {
      expect(nettoyerStatut({ ...base, modalite }, MAINTENANT)).toEqual(base);
    }
  });
});

describe('rejoindreMur', () => {
  it("rejoint le Mur par son alias, puis réutilise l'identifiant", async () => {
    const c = fauxClient([mur()]);
    expect(await rejoindreMur(comme(c))).toBe(MUR);
    expect(await rejoindreMur(comme(c))).toBe(MUR);
    expect(c.joinRoom).toHaveBeenCalledTimes(1);
    expect(c.joinRoom).toHaveBeenCalledWith(ALIAS_MUR);
  });
});

describe('publierDemande / retirerDemande', () => {
  it("publie io.sia.annonce avec role 'client' et seulement les champs du contrat", async () => {
    const c = fauxClient([mur()]);
    const id = await publierDemande(comme(c), { ...demande(), photo: 'x' } as DemandeClient);
    expect(id).toMatch(/^\$/);
    expect(c.sendEvent).toHaveBeenCalledWith(MUR, 'io.sia.annonce', {
      role: 'client',
      ...demande(),
    });
  });

  it('refuse une demande expirée, trop longue ou au budget invalide', async () => {
    const c = fauxClient([mur()]);
    await expect(publierDemande(comme(c), demande(MAINTENANT - 1))).rejects.toThrow();
    await expect(publierDemande(comme(c), demande(MAINTENANT + 25 * HEURE))).rejects.toThrow();
    await expect(
      publierDemande(comme(c), { ...demande(), texte: 'x'.repeat(141) }),
    ).rejects.toThrow();
    await expect(publierDemande(comme(c), { ...demande(), budget: 0 })).rejects.toThrow();
    await expect(publierDemande(comme(c), { ...demande(), budget: 100_000_001 })).rejects.toThrow();
    expect(c.sendEvent).not.toHaveBeenCalled();
  });

  it('retire une demande par redaction, refuse une référence invalide', async () => {
    const c = fauxClient([mur()]);
    await retirerDemande(comme(c), '$abc');
    expect(c.redactEvent).toHaveBeenCalledWith(MUR, '$abc');
    await expect(retirerDemande(comme(c), 'pas-un-id')).rejects.toThrow();
  });
});

describe('publierStatut / retirerStatut', () => {
  const statut = { pseudo: 'puma', metier: 'Coiffeur', zone: 'Nzeng', fin: MAINTENANT + HEURE };

  it("efface l'ancien statut avant de publier le nouveau", async () => {
    const ancien = evenement({
      type: 'io.sia.statut',
      sender: MOI,
      id: '$ancien',
      content: statut,
    });
    const c = fauxClient([mur([ancien])]);
    const id = await publierStatut(comme(c), statut);
    expect(c.redactEvent).toHaveBeenCalledWith(MUR, '$ancien');
    expect(c.sendEvent).toHaveBeenCalledWith(MUR, 'io.sia.statut', statut);
    expect(localStorage.getItem('sia.statut')).toBe(id);
  });

  it('refuse un statut de plus de 24 h', async () => {
    const c = fauxClient([mur()]);
    await expect(
      publierStatut(comme(c), { ...statut, fin: MAINTENANT + 25 * HEURE }),
    ).rejects.toThrow();
  });

  it('retirerStatut efface le statut mémorisé et oublie son identifiant', async () => {
    localStorage.setItem('sia.statut', '$memo');
    const c = fauxClient([mur()]);
    await retirerStatut(comme(c));
    expect(c.redactEvent).toHaveBeenCalledWith(MUR, '$memo');
    expect(localStorage.getItem('sia.statut')).toBeNull();
  });
});

describe('lireDemande', () => {
  const contenu = { role: 'client', ...demande() };

  it('lit une demande valide sans champ en trop', () => {
    const d = lireDemande(annonce({ ...contenu, piege: 1 }, { id: '$d1' }));
    expect(d).toEqual({ eventId: '$d1', expediteur: AUTRE, demande: demande(), contenu });
  });

  it('refuse une demande effacée, sans rôle client, ou à la fin trop lointaine après son envoi', () => {
    expect(lireDemande(annonce(contenu, { redacted: true }))).toBeNull();
    expect(lireDemande(annonce({ ...contenu, role: 'prestataire' }))).toBeNull();
    expect(lireDemande(annonce(contenu, { ts: MAINTENANT - 26 * HEURE }))).toBeNull();
    expect(lireDemande(annonce({ ...contenu, budget: '5000' }))).toBeNull();
    expect(lireDemande(evenement({ type: 'io.sia.statut', content: contenu }))).toBeNull();
  });
});

describe('ecouterDemandes', () => {
  it('prévient pour une nouvelle demande du Mur, pas pour les autres salons ni l’historique', () => {
    const c = fauxClient([mur()]);
    const rappel = vi.fn();
    const arreter = ecouterDemandes(comme(c), rappel);
    const ev = annonce({ role: 'client', ...demande() }, { id: '$n1' });
    c.emit(RoomEvent.Timeline, ev, c.getRoom(MUR), false);
    c.emit(RoomEvent.Timeline, ev, c.getRoom(MUR), true);
    c.emit(RoomEvent.Timeline, ev, { roomId: '!autre:x', getCanonicalAlias: () => null }, false);
    c.emit(
      RoomEvent.Timeline,
      annonce({ role: 'client', ...demande(MAINTENANT - 1) }),
      c.getRoom(MUR),
      false,
    );
    expect(rappel).toHaveBeenCalledTimes(1);
    expect(rappel.mock.calls[0]?.[0]).toMatchObject({ eventId: '$n1', demande: demande() });
    arreter();
    c.emit(RoomEvent.Timeline, ev, c.getRoom(MUR), false);
    expect(rappel).toHaveBeenCalledTimes(1);
  });

  it("signale le retrait d'une demande", () => {
    const ev = annonce({ role: 'client', ...demande() }, { id: '$r1' });
    const c = fauxClient([mur([ev])]);
    const auRetrait = vi.fn();
    ecouterDemandes(comme(c), vi.fn(), auRetrait);
    const effacement = evenement({ type: 'm.room.redaction', content: { redacts: '$r1' } });
    c.emit(RoomEvent.Redaction, effacement, c.getRoom(MUR));
    expect(auRetrait).toHaveBeenCalledWith('$r1');
  });
});

describe('demandesActives', () => {
  it('rend seulement les demandes valides et non expirées', async () => {
    const bonne = annonce({ role: 'client', ...demande() }, { id: '$ok' });
    const expiree = annonce({ role: 'client', ...demande(MAINTENANT - 1) }, { id: '$vieille' });
    const fausse = annonce({ role: 'client', pseudo: 3 }, { id: '$faux' });
    const c = fauxClient([mur([bonne, expiree, fausse])]);
    const actives = await demandesActives(comme(c));
    expect(actives.map((d) => d.eventId)).toEqual(['$ok']);
  });
});

describe('une demande par compte, pseudo protégé', () => {
  const AUTRE2 = '@autre2:sia.tail94dc60.ts.net';

  it('demandesActives : la plus récente par compte ; pseudo pris par un autre compte ignoré', async () => {
    const vieille = annonce({ role: 'client', ...demande() }, { id: '$v' });
    const recente = annonce({ role: 'client', ...demande(), texte: 'Nouvelle' }, { id: '$r' });
    const usurpee = evenement({
      type: 'io.sia.annonce',
      id: '$u',
      sender: AUTRE2,
      content: { role: 'client', ...demande(), pseudo: 'Palmier-48' },
    });
    const c = fauxClient([mur([vieille, recente, usurpee])]);
    expect((await demandesActives(comme(c))).map((d) => d.eventId)).toEqual(['$r']);
  });

  it('ecouterDemandes : une nouvelle demande du même compte retire la précédente', () => {
    const c = fauxClient([mur()]);
    const rappel = vi.fn();
    const retrait = vi.fn();
    ecouterDemandes(comme(c), rappel, retrait);
    const premiere = annonce({ role: 'client', ...demande() }, { id: '$p' });
    const seconde = annonce({ role: 'client', ...demande() }, { id: '$s' });
    const usurpee = evenement({
      type: 'io.sia.annonce',
      id: '$u',
      sender: AUTRE2,
      content: { role: 'client', ...demande() },
    });
    for (const ev of [premiere, seconde, usurpee]) {
      c.emit(RoomEvent.Timeline, ev, c.getRoom(MUR), false);
    }
    expect(rappel.mock.calls.map((a) => (a[0] as { eventId: string }).eventId)).toEqual([
      '$p',
      '$s',
    ]);
    expect(retrait).toHaveBeenCalledWith('$p');
  });
});

describe('maDemandeValable / oublierDemandeLocale', () => {
  it('seulement MA demande encore valable (Mur ou demande gardée)', () => {
    const mienne = evenement({
      type: 'io.sia.annonce',
      id: '$mienne',
      sender: MOI,
      content: { role: 'client', ...demande() },
    });
    const autre = annonce({ role: 'client', ...demande() }, { id: '$autre' });
    const c = fauxClient([mur([mienne, autre])]);
    expect(maDemandeValable(comme(c), '$mienne')).toEqual(demande());
    expect(maDemandeValable(comme(c), '$autre')).toBeNull();
    expect(maDemandeValable(comme(c), '$gardee')).toBeNull();
    localStorage.setItem('sia.demande', JSON.stringify({ eventId: '$gardee', demande: demande() }));
    expect(maDemandeValable(comme(c), '$gardee')).toEqual(demande());
    vi.setSystemTime(MAINTENANT + 2 * HEURE);
    expect(maDemandeValable(comme(c), '$mienne')).toBeNull();
    expect(maDemandeValable(comme(c), '$gardee')).toBeNull();
    oublierDemandeLocale();
    expect(localStorage.getItem('sia.demande')).toBeNull();
  });
});
