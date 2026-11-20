import { describe, expect, it } from 'vitest';
import {
  ABSENCE_MAX_MS,
  ATTENTE_MS,
  ESSAIS_AVANT_ATTENTE,
  ESSAIS_NEUFS,
  apresEchec,
  attenteRestante,
  codeValide,
  doitVerrouiller,
  lireEtatEssais,
  nettoyerSaisieCode,
  type EtatEssais,
} from '../src/logique/code-secret';

const MAINTENANT = 1_800_000_000_000;

describe('codeValide', () => {
  it('accepte exactement 4 chiffres', () => {
    expect(codeValide('0000')).toBe(true);
    expect(codeValide('1234')).toBe(true);
    expect(codeValide('9081')).toBe(true);
  });

  it('refuse tout le reste', () => {
    for (const brut of [
      '',
      '123',
      '12345',
      'abcd',
      '12a4',
      '12 4',
      ' 1234',
      '1234 ',
      '１２３４',
      null,
      undefined,
      1234,
    ]) {
      expect(codeValide(brut)).toBe(false);
    }
  });
});

describe('nettoyerSaisieCode (ce qu’on tape)', () => {
  it('garde seulement les chiffres, 4 au plus', () => {
    expect(nettoyerSaisieCode('12ab34')).toBe('1234');
    expect(nettoyerSaisieCode('123456')).toBe('1234');
    expect(nettoyerSaisieCode(' 9 8 ')).toBe('98');
    expect(nettoyerSaisieCode('abcd')).toBe('');
  });
});

describe('essais et attente', () => {
  it('les 4 premiers codes faux ne bloquent pas', () => {
    let e: EtatEssais = ESSAIS_NEUFS;
    for (let i = 1; i < ESSAIS_AVANT_ATTENTE; i += 1) {
      e = apresEchec(e, MAINTENANT);
      expect(e.echecs).toBe(i);
      expect(attenteRestante(e, MAINTENANT)).toBe(0);
    }
  });

  it('le 5e code faux de suite impose 30 secondes d’attente, puis le compte repart de zéro', () => {
    let e: EtatEssais = ESSAIS_NEUFS;
    for (let i = 0; i < ESSAIS_AVANT_ATTENTE; i += 1) e = apresEchec(e, MAINTENANT);
    expect(attenteRestante(e, MAINTENANT)).toBe(ATTENTE_MS);
    expect(attenteRestante(e, MAINTENANT + 10_000)).toBe(ATTENTE_MS - 10_000);
    expect(attenteRestante(e, MAINTENANT + ATTENTE_MS)).toBe(0);
    expect(e.echecs).toBe(0);
  });

  it('ne rend jamais une attente négative', () => {
    expect(attenteRestante({ echecs: 0, attenteJusqua: MAINTENANT - 5 }, MAINTENANT)).toBe(0);
  });

  it('ne dépasse jamais l’attente prévue, même si l’horloge avait été avancée puis remise', () => {
    const unJourPlusTard = { echecs: 0, attenteJusqua: MAINTENANT + 24 * 3_600_000 };
    expect(attenteRestante(unJourPlusTard, MAINTENANT)).toBe(ATTENTE_MS);
  });

  it('ne modifie jamais l’état reçu', () => {
    const avant: EtatEssais = { echecs: 2, attenteJusqua: 0 };
    apresEchec(avant, MAINTENANT);
    expect(avant).toEqual({ echecs: 2, attenteJusqua: 0 });
  });
});

describe('doitVerrouiller (retour dans l’appli)', () => {
  it('pas de sortie connue : non', () => {
    expect(doitVerrouiller(null, MAINTENANT)).toBe(false);
  });
  it('moins d’une minute dehors : non', () => {
    expect(doitVerrouiller(MAINTENANT - (ABSENCE_MAX_MS - 1), MAINTENANT)).toBe(false);
  });
  it('une minute ou plus dehors : oui', () => {
    expect(doitVerrouiller(MAINTENANT - ABSENCE_MAX_MS, MAINTENANT)).toBe(true);
    expect(doitVerrouiller(MAINTENANT - 10 * ABSENCE_MAX_MS, MAINTENANT)).toBe(true);
  });
  it('horloge reculée pendant l’absence (durée négative) : oui, on referme', () => {
    expect(doitVerrouiller(MAINTENANT + 1, MAINTENANT)).toBe(true);
    expect(doitVerrouiller(MAINTENANT + 3_600_000, MAINTENANT)).toBe(true);
  });
  it('retour au même instant : non', () => {
    expect(doitVerrouiller(MAINTENANT, MAINTENANT)).toBe(false);
  });
});

describe('lireEtatEssais (lecture sûre du stockage)', () => {
  it('relit un état bien formé', () => {
    expect(lireEtatEssais({ echecs: 3, attenteJusqua: MAINTENANT })).toEqual({
      echecs: 3,
      attenteJusqua: MAINTENANT,
    });
  });
  it('tout ce qui est étrange donne un état neuf', () => {
    for (const brut of [
      null,
      'x',
      3,
      [],
      {},
      { echecs: -1, attenteJusqua: 0 },
      { echecs: 1.5, attenteJusqua: 0 },
      { echecs: 'a', attenteJusqua: 0 },
      { echecs: 1, attenteJusqua: -5 },
      { echecs: 99, attenteJusqua: 0 },
    ]) {
      expect(lireEtatEssais(brut)).toEqual(ESSAIS_NEUFS);
    }
  });
});
