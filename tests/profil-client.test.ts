import { describe, expect, it } from 'vitest';
import {
  nettoyerProfilClient,
  profilClientComplet,
  verifierProfilClient,
  type ProfilClient,
  type SaisieProfilClient,
} from '../src/logique/profil-client';

const saisieValide: SaisieProfilClient = {
  pseudo: 'palmier-48',
  zone: 'Akanda',
  service: 'Plombier',
  budget: '5 000',
  texte: '',
};
const saisie = (c: Partial<SaisieProfilClient>): SaisieProfilClient => ({ ...saisieValide, ...c });

const profilValide: ProfilClient = {
  version: 1,
  role: 'client',
  pseudo: 'palmier-48',
  zone: 'Akanda',
};

describe('verifierProfilClient', () => {
  it('rend le profil propre (pseudo et zone seulement)', () => {
    expect(verifierProfilClient(saisie({ pseudo: ' palmier-48 ', zone: ' Akanda ' }))).toEqual({
      ok: true,
      profil: profilValide,
    });
  });
  it('refuse un caractère piège dans le pseudo ou la zone', () => {
    const r = verifierProfilClient(saisie({ pseudo: 'a‮b', zone: 'Akanda​' }));
    expect(!r.ok && r.erreurs).toEqual({
      pseudo: 'Caractère non autorisé.',
      zone: 'Caractère non autorisé.',
    });
  });
  it('exige pseudo et zone, avec des messages en français', () => {
    const r = verifierProfilClient(saisie({ pseudo: ' ', zone: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual(['pseudo', 'zone']);
      expect(r.erreurs.pseudo).toMatch(/pseudo/i);
      expect(r.erreurs.zone).toMatch(/quartier/i);
    }
  });
  it('refuse les textes trop longs, accepte pile au maximum', () => {
    expect(verifierProfilClient(saisie({ pseudo: 'a'.repeat(31) })).ok).toBe(false);
    expect(verifierProfilClient(saisie({ zone: 'a'.repeat(41) })).ok).toBe(false);
    expect(verifierProfilClient(saisie({ pseudo: 'a'.repeat(30), zone: 'b'.repeat(40) })).ok).toBe(
      true,
    );
  });
  it('ne regarde pas le besoin (service, budget, texte)', () => {
    expect(
      verifierProfilClient(saisie({ service: '', budget: 'rien', texte: 'x'.repeat(500) })).ok,
    ).toBe(true);
  });
});

describe('profilClientComplet', () => {
  it('vrai avec pseudo, zone, service et budget valide ; texte facultatif', () => {
    expect(profilClientComplet(saisieValide)).toBe(true);
    expect(profilClientComplet(saisie({ texte: 'Fuite sous l’évier' }))).toBe(true);
  });
  it('faux dès qu’un élément manque ou que le budget est faux', () => {
    expect(profilClientComplet(saisie({ pseudo: ' ' }))).toBe(false);
    expect(profilClientComplet(saisie({ zone: '' }))).toBe(false);
    expect(profilClientComplet(saisie({ service: '  ' }))).toBe(false);
    expect(profilClientComplet(saisie({ budget: '' }))).toBe(false);
    expect(profilClientComplet(saisie({ budget: '0' }))).toBe(false);
    expect(profilClientComplet(saisie({ budget: 'cinq mille' }))).toBe(false);
  });
});

describe('nettoyerProfilClient', () => {
  it('rend un profil valide, sans champ en trop', () => {
    expect(nettoyerProfilClient(profilValide)).toEqual(profilValide);
    expect(nettoyerProfilClient({ ...profilValide, photo: 'x', metier: 'y' })).toEqual(
      profilValide,
    );
  });
  it('nettoie les espaces', () => {
    expect(nettoyerProfilClient({ ...profilValide, pseudo: ' palmier-48 ' })).toEqual(profilValide);
  });
  it.each([
    ['null', null],
    ['texte', 'profil'],
    ['tableau', []],
    ['mauvaise version', { ...profilValide, version: 2 }],
    ['rôle prestataire', { ...profilValide, role: 'prestataire' }],
    ['pseudo manquant', { ...profilValide, pseudo: undefined }],
    ['pseudo vide', { ...profilValide, pseudo: '  ' }],
    ['pseudo nombre', { ...profilValide, pseudo: 7 }],
    ['pseudo trop long', { ...profilValide, pseudo: 'a'.repeat(31) }],
    ['zone trop longue', { ...profilValide, zone: 'a'.repeat(41) }],
    ['zone objet', { ...profilValide, zone: { nom: 'Akanda' } }],
  ])('refuse : %s', (_nom, donnee) => {
    expect(nettoyerProfilClient(donnee)).toBeNull();
  });
});
