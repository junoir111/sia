import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLE_VERROU,
  codeDefini,
  definirCode,
  deverrouiller,
  estVerrouille,
  etatVerrou,
  surVerrou,
  verifierCode,
  verrouiller,
} from '../src/appareil/verrou';
import { ATTENTE_MS, ESSAIS_AVANT_ATTENTE } from '../src/logique/code-secret';

const MAINTENANT = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  deverrouiller();
});
// Un test qui échoue ne doit pas laisser le stockage « en panne » pour les suivants.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('choisir son code', () => {
  it('sans code au départ ; après le choix, le téléphone en a un et reste ouvert', async () => {
    expect(codeDefini()).toBe(false);
    await definirCode('4821');
    expect(codeDefini()).toBe(true);
    expect(estVerrouille()).toBe(false);
  });

  it('ne garde jamais le code en clair : seulement un sel et une empreinte', async () => {
    await definirCode('4821');
    const garde = localStorage.getItem(CLE_VERROU) ?? '';
    expect(garde).not.toContain('4821');
    const lu = JSON.parse(garde) as Record<string, unknown>;
    expect(Object.keys(lu).sort()).toEqual(['empreinte', 'essais', 'iterations', 'sel']);
    expect(lu.empreinte).toMatch(/^[0-9a-f]{64}$/);
    expect(lu.sel).toMatch(/^[0-9a-f]{32}$/);
  });

  it('un même code ne donne pas deux fois la même empreinte (sel au hasard)', async () => {
    await definirCode('4821');
    const premiere = JSON.parse(localStorage.getItem(CLE_VERROU) ?? '{}').empreinte;
    await definirCode('4821');
    const seconde = JSON.parse(localStorage.getItem(CLE_VERROU) ?? '{}').empreinte;
    expect(seconde).not.toBe(premiere);
  });

  it.each(['', '123', '12345', '12a4', ' 123', 'abcd'])('refuse « %s »', async (code) => {
    await expect(definirCode(code)).rejects.toThrow();
    expect(codeDefini()).toBe(false);
  });
});

describe('taper son code', () => {
  it('le bon code ouvre l’appli', async () => {
    await definirCode('4821');
    verrouiller();
    expect(estVerrouille()).toBe(true);
    await expect(verifierCode('4821', MAINTENANT)).resolves.toEqual({ etat: 'ok' });
    expect(estVerrouille()).toBe(false);
  });

  it('un mauvais code dit combien d’essais restent, et laisse l’appli fermée', async () => {
    await definirCode('4821');
    verrouiller();
    await expect(verifierCode('0000', MAINTENANT)).resolves.toEqual({
      etat: 'faux',
      restants: ESSAIS_AVANT_ATTENTE - 1,
    });
    await expect(verifierCode('1111', MAINTENANT)).resolves.toEqual({
      etat: 'faux',
      restants: ESSAIS_AVANT_ATTENTE - 2,
    });
    expect(estVerrouille()).toBe(true);
  });

  it('un code mal formé est refusé comme un mauvais code', async () => {
    await definirCode('4821');
    verrouiller();
    await expect(verifierCode('48', MAINTENANT)).resolves.toMatchObject({ etat: 'faux' });
    await expect(verifierCode('abcd', MAINTENANT)).resolves.toMatchObject({ etat: 'faux' });
    expect(estVerrouille()).toBe(true);
  });

  it('au 5e code faux de suite : 30 s d’attente, même le bon code est refusé, puis ça repart', async () => {
    await definirCode('4821');
    verrouiller();
    let dernier: unknown;
    for (let i = 0; i < ESSAIS_AVANT_ATTENTE; i += 1)
      dernier = await verifierCode('0000', MAINTENANT);
    expect(dernier).toEqual({ etat: 'attente', ms: ATTENTE_MS });

    await expect(verifierCode('4821', MAINTENANT + 10_000)).resolves.toEqual({
      etat: 'attente',
      ms: ATTENTE_MS - 10_000,
    });
    expect(estVerrouille()).toBe(true);

    await expect(verifierCode('4821', MAINTENANT + ATTENTE_MS)).resolves.toEqual({ etat: 'ok' });
    expect(estVerrouille()).toBe(false);
  });

  it('les essais ratés sont gardés (fermer et rouvrir l’appli ne les remet pas à zéro)', async () => {
    await definirCode('4821');
    await verifierCode('0000', MAINTENANT);
    await verifierCode('0000', MAINTENANT);
    const garde = JSON.parse(localStorage.getItem(CLE_VERROU) ?? '{}');
    expect(garde.essais.echecs).toBe(2);
    await expect(verifierCode('0000', MAINTENANT)).resolves.toEqual({
      etat: 'faux',
      restants: ESSAIS_AVANT_ATTENTE - 3,
    });
  });

  it('l’essai est compté avant d’être vérifié : si le stockage refuse d’écrire, rien n’est calculé', async () => {
    await definirCode('4821');
    verrouiller();
    const calcul = vi.spyOn(crypto.subtle, 'deriveBits');
    const ecriture = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('stockage plein');
    });
    await expect(verifierCode('4821', MAINTENANT)).rejects.toThrow('stockage plein');
    ecriture.mockRestore();
    expect(calcul).not.toHaveBeenCalled();
    calcul.mockRestore();
    expect(estVerrouille()).toBe(true);
  });

  it('deux essais lancés en même temps comptent pour deux', async () => {
    await definirCode('4821');
    verrouiller();
    await Promise.all([verifierCode('0000', MAINTENANT), verifierCode('1111', MAINTENANT)]);
    expect(JSON.parse(localStorage.getItem(CLE_VERROU) ?? '{}').essais.echecs).toBe(2);
  });

  it('le bon code ouvre même si le compteur ne peut plus être remis à zéro', async () => {
    await definirCode('4821');
    verrouiller();
    let ecritures = 0;
    const reel = Storage.prototype.setItem;
    const ecriture = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      cle: string,
      valeur: string,
    ) {
      ecritures += 1;
      if (ecritures > 1) throw new Error('stockage plein');
      reel.call(this, cle, valeur);
    });
    await expect(verifierCode('4821', MAINTENANT)).resolves.toEqual({ etat: 'ok' });
    ecriture.mockRestore();
    expect(estVerrouille()).toBe(false);
  });

  it('un bon code remet les essais à zéro', async () => {
    await definirCode('4821');
    await verifierCode('0000', MAINTENANT);
    await verifierCode('4821', MAINTENANT);
    expect(JSON.parse(localStorage.getItem(CLE_VERROU) ?? '{}').essais.echecs).toBe(0);
  });

  it('sans code défini sur ce téléphone, rien ne s’ouvre avec un code', async () => {
    await expect(verifierCode('4821', MAINTENANT)).resolves.toMatchObject({ etat: 'faux' });
  });

  it('un stockage abîmé ou truqué compte comme « pas de code »', async () => {
    for (const abime of [
      'pas du json',
      '[]',
      '{"sel":"zz","empreinte":"ab","iterations":5}',
      '{"sel":"abcd","empreinte":"abcd","iterations":1}',
    ]) {
      localStorage.setItem(CLE_VERROU, abime);
      expect(codeDefini()).toBe(false);
    }
  });
});

describe('au démarrage de l’appli', () => {
  it('un code déjà choisi ferme la porte, sans rien avoir tapé', async () => {
    await definirCode('4821');
    vi.resetModules();
    const frais = await import('../src/appareil/verrou');
    expect(frais.etatVerrou()).toBe('ferme');
    expect(frais.estVerrouille()).toBe(true);
  });

  it('une lecture ratée au chargement ne laisse pas la porte ouverte', async () => {
    await definirCode('4821');
    vi.resetModules();
    const lecture = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('stockage illisible');
    });
    const frais = await import('../src/appareil/verrou');
    lecture.mockRestore();
    expect(frais.etatVerrou()).toBe('ferme');
  });

  it('sans code, le démarrage ne ferme rien : on est invité à en choisir un', async () => {
    vi.resetModules();
    const frais = await import('../src/appareil/verrou');
    expect(frais.etatVerrou()).toBe('sans-code');
    expect(frais.estVerrouille()).toBe(false);
  });
});

describe('ouvert / fermé à clé', () => {
  it('l’état suit : sans code, puis ouvert après le choix, fermé, ouvert après le bon code', async () => {
    expect(etatVerrou()).toBe('sans-code');
    await definirCode('4821');
    expect(etatVerrou()).toBe('ouvert');
    verrouiller();
    expect(etatVerrou()).toBe('ferme');
    await verifierCode('4821', MAINTENANT);
    expect(etatVerrou()).toBe('ouvert');
  });

  it('choisir un code prévient l’écran même si l’appli était déjà ouverte', async () => {
    const rappel = vi.fn();
    const arreter = surVerrou(rappel);
    await definirCode('4821');
    expect(rappel).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('sans code, on ne peut pas fermer à clé', () => {
    verrouiller();
    expect(estVerrouille()).toBe(false);
  });

  it('prévient quand l’état change, et plus rien après avoir arrêté d’écouter', async () => {
    await definirCode('4821');
    const rappel = vi.fn();
    const arreter = surVerrou(rappel);
    verrouiller();
    expect(rappel).toHaveBeenCalledTimes(1);
    verrouiller(); // déjà fermé : rien de nouveau
    expect(rappel).toHaveBeenCalledTimes(1);
    deverrouiller();
    expect(rappel).toHaveBeenCalledTimes(2);
    arreter();
    verrouiller();
    expect(rappel).toHaveBeenCalledTimes(2);
  });

  it('effacer le stockage (se déconnecter) ôte le verrou', async () => {
    await definirCode('4821');
    verrouiller();
    localStorage.removeItem(CLE_VERROU);
    expect(codeDefini()).toBe(false);
    expect(estVerrouille()).toBe(false);
  });
});
