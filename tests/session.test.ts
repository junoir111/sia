import { afterEach, describe, expect, it } from 'vitest';
import { effacerSession, enregistrerSession, lireSession } from '../src/matrix/session';

const SESSION = {
  userId: '@puma-35:sia.tail94dc60.ts.net',
  accessToken: 'jeton',
  deviceId: 'APPAREIL1',
};

afterEach(() => {
  localStorage.clear();
});

describe('session', () => {
  it('renvoie null quand rien n’est enregistré', () => {
    expect(lireSession()).toBeNull();
  });

  it('enregistre puis relit la session sous la clé sia.session', () => {
    enregistrerSession(SESSION);
    expect(lireSession()).toEqual(SESSION);
    expect(localStorage.getItem('sia.session')).not.toBeNull();
  });

  it('n’enregistre que les 3 champs', () => {
    enregistrerSession({ ...SESSION, intrus: 'x' } as typeof SESSION);
    expect(JSON.parse(localStorage.getItem('sia.session') ?? '{}')).toEqual(SESSION);
  });

  it('efface la session', () => {
    enregistrerSession(SESSION);
    effacerSession();
    expect(lireSession()).toBeNull();
  });

  it.each([
    ['texte non JSON', '{abc'],
    ['null', 'null'],
    ['tableau', '[]'],
    ['nombre', '3'],
    ['champ manquant', JSON.stringify({ userId: 'a', accessToken: 'b' })],
    ['champ non texte', JSON.stringify({ ...SESSION, deviceId: 5 })],
    ['champ vide', JSON.stringify({ ...SESSION, accessToken: '' })],
    ['champ trop long', JSON.stringify({ ...SESSION, accessToken: 'x'.repeat(2000) })],
  ])('renvoie null si le contenu est mal formé (%s)', (_nom, brut) => {
    localStorage.setItem('sia.session', brut);
    expect(lireSession()).toBeNull();
  });

  it('ne renvoie pas les champs en trop', () => {
    localStorage.setItem('sia.session', JSON.stringify({ ...SESSION, intrus: 'x' }));
    expect(lireSession()).toEqual(SESSION);
  });
});
