import { describe, expect, it, vi } from 'vitest';
import { creerBoiteEchec } from '../src/ecrans/echec-envoi';

const ECHEC = { message: 'Pas de connexion.', saisie: { metier: 'Plombier' } };

describe('creerBoiteEchec', () => {
  it('rend l’échec déposé, une seule fois', () => {
    const boite = creerBoiteEchec<{ metier: string }>();
    expect(boite.reprendre()).toBeNull();
    boite.deposer(ECHEC);
    expect(boite.reprendre()).toEqual(ECHEC);
    expect(boite.reprendre()).toBeNull();
  });

  it('un nouveau dépôt remplace le précédent', () => {
    const boite = creerBoiteEchec<{ metier: string }>();
    boite.deposer(ECHEC);
    boite.deposer({ message: 'Autre.', saisie: { metier: 'Maçon' } });
    expect(boite.reprendre()?.saisie.metier).toBe('Maçon');
  });

  it('prévient ceux qui écoutent au dépôt, et plus personne après avoir arrêté', () => {
    const boite = creerBoiteEchec<{ metier: string }>();
    const rappel = vi.fn();
    const arreter = boite.ecouter(rappel);
    boite.deposer(ECHEC);
    expect(rappel).toHaveBeenCalledTimes(1);
    arreter();
    boite.deposer(ECHEC);
    expect(rappel).toHaveBeenCalledTimes(1);
  });

  it('l’écouteur trouve l’échec à reprendre quand il est prévenu', () => {
    const boite = creerBoiteEchec<{ metier: string }>();
    let repris: unknown = null;
    boite.ecouter(() => {
      repris = boite.reprendre();
    });
    boite.deposer(ECHEC);
    expect(repris).toEqual(ECHEC);
  });

  it('« oublier » vide la boîte', () => {
    const boite = creerBoiteEchec<{ metier: string }>();
    boite.deposer(ECHEC);
    boite.oublier();
    expect(boite.reprendre()).toBeNull();
  });

  it('chaque boîte a son propre contenu', () => {
    const a = creerBoiteEchec<{ metier: string }>();
    const b = creerBoiteEchec<{ metier: string }>();
    a.deposer(ECHEC);
    expect(b.reprendre()).toBeNull();
    expect(a.reprendre()).toEqual(ECHEC);
  });
});
