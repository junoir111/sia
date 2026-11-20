import { beforeEach, describe, expect, it } from 'vitest';
import { definirCode, deverrouiller, verrouiller } from '../src/appareil/verrou';
import { porteActuelle } from '../src/coquille/porte';
import { enregistrerSession } from '../src/matrix/session';

const SESSION = { userId: '@puma:sia', accessToken: 'jeton', deviceId: 'APP' };

beforeEach(() => {
  localStorage.clear();
  deverrouiller();
});

describe('porteActuelle', () => {
  it('pas connecté : la porte est ouverte, même avec un code sur le téléphone', async () => {
    expect(porteActuelle()).toBe('ouverte');
    await definirCode('4821');
    verrouiller();
    expect(porteActuelle()).toBe('ouverte');
  });

  it('connecté sans code : il faut en choisir un', () => {
    enregistrerSession(SESSION);
    expect(porteActuelle()).toBe('code-a-choisir');
  });

  it('connecté avec un code : ouverte après le choix, fermée à clé, puis ouverte avec le bon code', async () => {
    enregistrerSession(SESSION);
    await definirCode('4821');
    expect(porteActuelle()).toBe('ouverte');
    verrouiller();
    expect(porteActuelle()).toBe('code-a-taper');
    deverrouiller();
    expect(porteActuelle()).toBe('ouverte');
  });
});
