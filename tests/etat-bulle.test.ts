import { describe, expect, it } from 'vitest';
import { etatAffiche, nettoyerEtatBulle, type EtatBulle } from '../src/logique/etat-bulle';

const CLIENT = '@palmier-48:sia.tail94dc60.ts.net';
const PRESTA = '@mangue-douce:sia.tail94dc60.ts.net';

const etatValide: EtatBulle = {
  demande: {
    annonce: '$demande1',
    service: 'Plombier',
    zone: 'Akanda',
    budget: 5000,
    texte: 'Fuite',
  },
  participants: {
    [CLIENT]: { pseudo: 'palmier-48', zone: 'Akanda' },
    [PRESTA]: { pseudo: 'mangue-douce', zone: 'PK12' },
  },
};
const avecDemande = (c: Record<string, unknown>): unknown => ({
  ...etatValide,
  demande: { ...etatValide.demande, ...c },
});
const avecParticipants = (p: unknown): unknown => ({ ...etatValide, participants: p });

describe('nettoyerEtatBulle', () => {
  it('rend un état valide, sans champ en trop', () => {
    expect(nettoyerEtatBulle(etatValide)).toEqual(etatValide);
    const r = nettoyerEtatBulle({
      ...etatValide,
      intrus: 1,
      demande: { ...etatValide.demande, autre: 2 },
      participants: { [CLIENT]: { pseudo: 'palmier-48', zone: 'Akanda', vraiNom: 'X' } },
    });
    expect(r).toEqual({
      ...etatValide,
      participants: { [CLIENT]: { pseudo: 'palmier-48', zone: 'Akanda' } },
    });
  });
  it('accepte un texte de demande vide', () => {
    expect(nettoyerEtatBulle(avecDemande({ texte: '' }))?.demande.texte).toBe('');
  });
  it('ne se laisse pas piéger par __proto__', () => {
    const piege = JSON.parse(
      `{"demande":${JSON.stringify(etatValide.demande)},"participants":{"__proto__":{"pseudo":"a","zone":"b"}}}`,
    ) as unknown;
    expect(nettoyerEtatBulle(piege)).toBeNull();
  });
  it.each([
    ['null', null],
    ['tableau', []],
    ['sans demande', { participants: etatValide.participants }],
    ['annonce pas un id', avecDemande({ annonce: 'demande1' })],
    ['annonce vide', avecDemande({ annonce: '' })],
    ['service trop long', avecDemande({ service: 'a'.repeat(41) })],
    ['zone vide', avecDemande({ zone: ' ' })],
    ['budget texte', avecDemande({ budget: '5000' })],
    ['budget nul', avecDemande({ budget: 0 })],
    ['texte trop long', avecDemande({ texte: 'a'.repeat(141) })],
    ['participants absents', avecParticipants(undefined)],
    ['participants tableau', avecParticipants([])],
    ['aucun participant', avecParticipants({})],
    [
      'trois participants',
      avecParticipants({ ...etatValide.participants, '@c:s': { pseudo: 'c', zone: 'z' } }),
    ],
    ['clé pas un userId', avecParticipants({ palmier: { pseudo: 'p', zone: 'z' } })],
    ['participant null', avecParticipants({ [CLIENT]: null })],
    ['pseudo trop long', avecParticipants({ [CLIENT]: { pseudo: 'a'.repeat(31), zone: 'z' } })],
    ['zone manquante', avecParticipants({ [CLIENT]: { pseudo: 'p' } })],
  ])('refuse : %s', (_nom, donnee) => {
    expect(nettoyerEtatBulle(donnee)).toBeNull();
  });
});

describe('etatAffiche', () => {
  const cas = (monAppartenance?: string, autreAppartenance?: string, autreEcrit = false) =>
    etatAffiche({ monAppartenance, autreAppartenance, autreEcrit });

  it('invitation reçue', () => {
    expect(cas('invite', 'join')).toEqual({
      etat: 'invitation-recue',
      texte: 'Dit oui. Tu veux discuter ?',
    });
  });
  it('en attente tant que l’autre n’a pas accepté', () => {
    expect(cas('join', 'invite')).toEqual({ etat: 'en-attente', texte: 'En attente' });
    expect(cas('join', undefined)).toEqual({ etat: 'en-attente', texte: 'En attente' });
    expect(cas('join', 'invite', true).etat).toBe('en-attente');
  });
  it('ouverte, avec « en train d’écrire… » si l’autre tape', () => {
    expect(cas('join', 'join')).toEqual({ etat: 'ouverte', texte: '' });
    expect(cas('join', 'join', true)).toEqual({ etat: 'ouverte', texte: 'En train d’écrire…' });
  });
  it('fermée si l’un des deux est parti ou banni', () => {
    const fermee = { etat: 'fermee', texte: 'La bulle est fermée.' };
    expect(cas('join', 'leave')).toEqual(fermee);
    expect(cas('join', 'ban')).toEqual(fermee);
    expect(cas('leave', 'join')).toEqual(fermee);
    expect(cas('ban', 'join')).toEqual(fermee);
    expect(cas('invite', 'leave')).toEqual(fermee);
    expect(cas(undefined, 'join')).toEqual(fermee);
    expect(cas('bizarre', 'join')).toEqual(fermee);
  });
});
