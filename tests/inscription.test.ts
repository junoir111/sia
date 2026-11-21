import { describe, expect, it } from 'vitest';
import {
  formulaireComplet,
  lireCodeInvitation,
  normaliserIdentifiant,
  verifierInscription,
  type ValeursInscription,
} from '../src/logique/inscription';

const valides: ValeursInscription = {
  identifiant: 'abel',
  codeSecret: '4821',
  confirmation: '4821',
  code: 'invitation',
  majeur: true,
};

const avec = (changement: Partial<ValeursInscription>): ValeursInscription => ({
  ...valides,
  ...changement,
});

describe('normaliserIdentifiant', () => {
  it('enlève les espaces autour et met en minuscules', () => {
    expect(normaliserIdentifiant('  Abel.K  ')).toBe('abel.k');
  });
});

describe('verifierInscription', () => {
  it('ne renvoie aucune erreur quand tout va bien', () => {
    expect(verifierInscription(valides)).toEqual({});
  });

  describe('identifiant', () => {
    const message = '3 à 30 signes : lettres, chiffres, . _ -';

    it('accepte majuscules et espaces autour (après normalisation)', () => {
      expect(verifierInscription(avec({ identifiant: '  Abel_K-2.x ' }))).toEqual({});
    });

    it('refuse moins de 3 signes', () => {
      expect(verifierInscription(avec({ identifiant: 'ab' })).identifiant).toBe(message);
    });

    it('accepte 3 et 30 signes', () => {
      expect(verifierInscription(avec({ identifiant: 'abc' })).identifiant).toBeUndefined();
      expect(
        verifierInscription(avec({ identifiant: 'a'.repeat(30) })).identifiant,
      ).toBeUndefined();
    });

    it('refuse plus de 30 signes', () => {
      expect(verifierInscription(avec({ identifiant: 'a'.repeat(31) })).identifiant).toBe(message);
    });

    it('refuse 2 signes entourés d’espaces', () => {
      expect(verifierInscription(avec({ identifiant: '  ab  ' })).identifiant).toBe(message);
    });

    it.each(['ab@cd', 'ab cd', 'abé', '@abel:sia', 'ab/cd', 'ab+cd'])(
      'refuse le caractère interdit dans « %s »',
      (identifiant) => {
        expect(verifierInscription(avec({ identifiant })).identifiant).toBe(message);
      },
    );

    it('refuse un identifiant vide', () => {
      expect(verifierInscription(avec({ identifiant: '' })).identifiant).toBe(message);
    });
  });

  describe('code secret (4 chiffres : mot de passe du compte ET verrou de l’appli)', () => {
    it('accepte 4 chiffres, zéros compris', () => {
      expect(verifierInscription(avec({ codeSecret: '0000', confirmation: '0000' })).codeSecret).toBeUndefined();
      expect(verifierInscription(avec({ codeSecret: '9081', confirmation: '9081' })).codeSecret).toBeUndefined();
    });

    it.each(['', '123', '12345', '12a4', '12 4', 'abcd'])('refuse « %s »', (codeSecret) => {
      expect(verifierInscription(avec({ codeSecret, confirmation: codeSecret })).codeSecret).toBe(
        'Ton code secret a 4 chiffres.',
      );
    });
  });

  describe('confirmation du code', () => {
    it('refuse deux codes différents', () => {
      expect(verifierInscription(avec({ confirmation: '4822' })).confirmation).toBe(
        'Les deux codes ne sont pas pareils.',
      );
    });

    it('ne parle pas de confirmation tant que le code n’est pas déjà 4 chiffres', () => {
      const erreurs = verifierInscription(avec({ codeSecret: '12', confirmation: '99' }));
      expect(erreurs.codeSecret).toBeTruthy();
      expect(erreurs.confirmation).toBeUndefined();
    });
  });

  describe('code', () => {
    it('refuse un code vide ou fait d’espaces', () => {
      expect(verifierInscription(avec({ code: '' })).code).toBeTruthy();
      expect(verifierInscription(avec({ code: '   ' })).code).toBeTruthy();
    });
  });

  describe('majeur', () => {
    it('refuse si la case n’est pas cochée', () => {
      expect(verifierInscription(avec({ majeur: false })).majeur).toBe(
        'SIA est réservé aux 18 ans et plus.',
      );
    });
  });

  it('renvoie toutes les erreurs à la fois', () => {
    const erreurs = verifierInscription({
      identifiant: '',
      codeSecret: '',
      confirmation: 'x',
      code: '',
      majeur: false,
    });
    // Code secret vide = erreur sur codeSecret ; la confirmation n'est jugée qu'une fois le code valide.
    expect(Object.keys(erreurs).sort()).toEqual(
      ['code', 'codeSecret', 'identifiant', 'majeur'].sort(),
    );
  });
});

describe('formulaireComplet', () => {
  it('est vrai quand tout est rempli et la case cochée', () => {
    expect(formulaireComplet(valides)).toBe(true);
  });

  it.each<[string, Partial<ValeursInscription>]>([
    ['identifiant vide', { identifiant: '  ' }],
    ['code secret vide', { codeSecret: '' }],
    ['confirmation vide', { confirmation: '' }],
    ['code vide', { code: '  ' }],
    ['case non cochée', { majeur: false }],
  ])('est faux avec %s', (_nom, changement) => {
    expect(formulaireComplet(avec(changement))).toBe(false);
  });

  it('ne juge pas la validité (un code et une confirmation différents restent « remplis »)', () => {
    expect(formulaireComplet(avec({ codeSecret: '12', confirmation: '34' }))).toBe(true);
  });
});

describe('lireCodeInvitation', () => {
  it('reconnaît un code prestataire', () => {
    expect(lireCodeInvitation('P-AB12-CD34-EF56')).toEqual({
      jeton: 'P-AB12-CD34-EF56',
      role: 'prestataire',
    });
  });

  it('reconnaît un code client', () => {
    expect(lireCodeInvitation('C-AB12-CD34-EF56')).toEqual({
      jeton: 'C-AB12-CD34-EF56',
      role: 'client',
    });
  });

  it('accepte les minuscules et rend le jeton en majuscules', () => {
    expect(lireCodeInvitation('p-ab12-cd34-ef56')).toEqual({
      jeton: 'P-AB12-CD34-EF56',
      role: 'prestataire',
    });
  });

  it('enlève les espaces autour et à l’intérieur', () => {
    expect(lireCodeInvitation('  c - ab12 -CD34-ef56 ')).toEqual({
      jeton: 'C-AB12-CD34-EF56',
      role: 'client',
    });
  });

  it('ne donne pas de rôle pour un préfixe inconnu', () => {
    expect(lireCodeInvitation(' X-AB12-CD34-EF56 ')).toEqual({
      jeton: 'X-AB12-CD34-EF56',
      role: null,
    });
  });

  it('ne donne pas de rôle si un bloc a la mauvaise longueur', () => {
    expect(lireCodeInvitation('P-AB12-CD34-EF5').role).toBeNull();
    expect(lireCodeInvitation('P-AB12-CD34-EF567').role).toBeNull();
  });

  it('garde un ancien code tel quel (trim seulement, casse gardée)', () => {
    expect(lireCodeInvitation('  AncienCode 42 ')).toEqual({
      jeton: 'AncienCode 42',
      role: null,
    });
  });
});
