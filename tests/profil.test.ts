import { describe, expect, it } from 'vitest';
import {
  LIMITES,
  choixDepuisModalite,
  formaterPrix,
  lirePrix,
  modaliteDepuisChoix,
  nettoyerProfil,
  profilComplet,
  pseudoPropose,
  verifierProfil,
  type ProfilPrestataire,
  type SaisieProfil,
} from '../src/logique/profil';

const saisieValide: SaisieProfil = {
  pseudo: 'mangue-douce',
  metier: 'Plombier',
  zone: 'Akanda',
  recoit: false,
  deplace: true,
  services: [
    { label: 'Réparer une fuite', prix: '5 000' },
    { label: 'Déboucher un évier', prix: '10000' },
    { label: '', prix: '' },
  ],
};

const saisie = (changement: Partial<SaisieProfil>): SaisieProfil => ({ ...saisieValide, ...changement });

const profilValide: ProfilPrestataire = {
  version: 1,
  role: 'prestataire',
  pseudo: 'mangue-douce',
  metier: 'Plombier',
  zone: 'Akanda',
  modalite: 'deplace',
  services: [{ label: 'Réparer une fuite', prix: 5000 }],
};

describe('LIMITES', () => {
  it('reprend les tailles du schéma PROFIL', () => {
    expect(LIMITES).toEqual({ pseudo: 30, metier: 40, zone: 40, service: 40, servicesMax: 3, prixMax: 100000000 });
  });
});

describe('pseudoPropose', () => {
  it("prend la partie avant les deux-points de l'identifiant", () => {
    expect(pseudoPropose('@mangue-douce:sia.tail94dc60.ts.net')).toBe('mangue-douce');
  });
  it('rend une chaîne vide pour une entrée bizarre', () => {
    expect(pseudoPropose('')).toBe('');
    expect(pseudoPropose('mangue-douce')).toBe('');
    expect(pseudoPropose('@:sia.tail94dc60.ts.net')).toBe('');
    expect(pseudoPropose('@mangue')).toBe('');
  });
  it('coupe à 30 signes', () => {
    expect(pseudoPropose(`@${'a'.repeat(40)}:serveur`)).toBe('a'.repeat(30));
  });
});

describe('modalité', () => {
  it('traduit les deux boutons en modalité', () => {
    expect(modaliteDepuisChoix(true, false)).toBe('recoit');
    expect(modaliteDepuisChoix(false, true)).toBe('deplace');
    expect(modaliteDepuisChoix(true, true)).toBe('les-deux');
    expect(modaliteDepuisChoix(false, false)).toBeNull();
  });
  it('rallume les bons boutons depuis une modalité', () => {
    expect(choixDepuisModalite('recoit')).toEqual({ recoit: true, deplace: false });
    expect(choixDepuisModalite('deplace')).toEqual({ recoit: false, deplace: true });
    expect(choixDepuisModalite('les-deux')).toEqual({ recoit: true, deplace: true });
    expect(choixDepuisModalite(null)).toEqual({ recoit: false, deplace: false });
  });
});

describe('lirePrix', () => {
  it('accepte les écritures courantes', () => {
    expect(lirePrix('5 000')).toBe(5000);
    expect(lirePrix('5000')).toBe(5000);
    expect(lirePrix('5.000 FCFA')).toBe(5000);
    expect(lirePrix(' 10 000 ')).toBe(10000);
    expect(lirePrix('1 000 000 fcfa')).toBe(1000000);
    expect(lirePrix('100000000')).toBe(LIMITES.prixMax);
  });
  it('refuse vide, zéro, trop grand et texte', () => {
    expect(lirePrix('')).toBeNull();
    expect(lirePrix('   ')).toBeNull();
    expect(lirePrix('0')).toBeNull();
    expect(lirePrix('100000001')).toBeNull();
    expect(lirePrix('cinq mille')).toBeNull();
    expect(lirePrix('-500')).toBeNull();
    expect(lirePrix('5,5')).toBeNull();
    expect(lirePrix('5000abc')).toBeNull();
  });
});

describe('formaterPrix', () => {
  it('groupe les chiffres par 3 avec une espace normale', () => {
    expect(formaterPrix(5000)).toBe('5 000');
    expect(formaterPrix(500)).toBe('500');
    expect(formaterPrix(1234567)).toBe('1 234 567');
  });
});

describe('verifierProfil', () => {
  it('rend le profil propre quand tout est bon', () => {
    const r = verifierProfil(saisie({ pseudo: '  mangue-douce ', zone: ' Akanda ' }));
    expect(r).toEqual({
      ok: true,
      profil: {
        version: 1,
        role: 'prestataire',
        pseudo: 'mangue-douce',
        metier: 'Plombier',
        zone: 'Akanda',
        modalite: 'deplace',
        services: [
          { label: 'Réparer une fuite', prix: 5000 },
          { label: 'Déboucher un évier', prix: 10000 },
        ],
      },
    });
  });
  it('accepte aucun service', () => {
    const r = verifierProfil(saisie({ services: [] }));
    expect(r.ok && r.profil.services).toEqual([]);
  });
  it('exige pseudo, métier et zone', () => {
    const r = verifierProfil(saisie({ pseudo: ' ', metier: '', zone: '  ' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual(['metier', 'pseudo', 'zone']);
    }
  });
  it('refuse les textes trop longs', () => {
    const r = verifierProfil(saisie({ pseudo: 'a'.repeat(31), metier: 'b'.repeat(41), zone: 'c'.repeat(41) }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.pseudo).toBeTruthy();
      expect(r.erreurs.metier).toBeTruthy();
      expect(r.erreurs.zone).toBeTruthy();
    }
  });
  it('accepte les longueurs pile au maximum', () => {
    const r = verifierProfil(
      saisie({ pseudo: 'a'.repeat(30), metier: 'b'.repeat(40), services: [{ label: 'd'.repeat(40), prix: '1' }] }),
    );
    expect(r.ok).toBe(true);
  });
  it('exige au moins un choix reçoit ou déplace', () => {
    const r = verifierProfil(saisie({ recoit: false, deplace: false }));
    expect(!r.ok && r.erreurs.modalite).toBeTruthy();
  });
  it('refuse un nom de service sans prix valide', () => {
    const r = verifierProfil(saisie({ services: [{ label: 'Fuite', prix: '' }] }));
    expect(!r.ok && r.erreurs.services).toBeTruthy();
    const r2 = verifierProfil(saisie({ services: [{ label: 'Fuite', prix: 'gratuit' }] }));
    expect(!r2.ok && r2.erreurs.services).toBeTruthy();
  });
  it('refuse un prix sans nom de service', () => {
    const r = verifierProfil(saisie({ services: [{ label: '  ', prix: '5000' }] }));
    expect(!r.ok && r.erreurs.services).toBeTruthy();
  });
  it('refuse un nom de service trop long', () => {
    const r = verifierProfil(saisie({ services: [{ label: 'x'.repeat(41), prix: '5000' }] }));
    expect(!r.ok && r.erreurs.services).toBeTruthy();
  });
  it('refuse plus de 3 services remplis, mais ignore les lignes vides', () => {
    const ligne = { label: 'Fuite', prix: '5000' };
    const trop = verifierProfil(saisie({ services: [ligne, ligne, ligne, ligne] }));
    expect(!trop.ok && trop.erreurs.services).toBeTruthy();
    const vides = { label: ' ', prix: '' };
    const ok = verifierProfil(saisie({ services: [ligne, vides, ligne, vides, ligne] }));
    expect(ok.ok && ok.profil.services).toHaveLength(3);
  });
  it('donne des messages en français', () => {
    const r = verifierProfil(saisie({ pseudo: '', recoit: false, deplace: false }));
    expect(!r.ok && r.erreurs.pseudo).toMatch(/pseudo/i);
    expect(!r.ok && r.erreurs.modalite).toMatch(/travailles/i);
  });
});

describe('profilComplet', () => {
  it('vrai quand pseudo, métier, zone et un choix sont remplis', () => {
    expect(profilComplet(saisieValide)).toBe(true);
    expect(profilComplet(saisie({ services: [] }))).toBe(true);
  });
  it('faux dès qu’un élément manque', () => {
    expect(profilComplet(saisie({ pseudo: '  ' }))).toBe(false);
    expect(profilComplet(saisie({ metier: '' }))).toBe(false);
    expect(profilComplet(saisie({ zone: '' }))).toBe(false);
    expect(profilComplet(saisie({ recoit: false, deplace: false }))).toBe(false);
  });
});

describe('nettoyerProfil', () => {
  it('rend un profil valide tel quel', () => {
    expect(nettoyerProfil(profilValide)).toEqual(profilValide);
  });
  it('ne garde que les champs connus', () => {
    const r = nettoyerProfil({
      ...profilValide,
      intrus: 'x',
      services: [{ label: 'Fuite', prix: 5000, autre: 1 }],
    });
    expect(r).toEqual({ ...profilValide, services: [{ label: 'Fuite', prix: 5000 }] });
  });
  it.each([
    ['null', null],
    ['texte', 'profil'],
    ['nombre', 42],
    ['tableau', []],
    ['mauvaise version', { ...profilValide, version: 2 }],
    ['rôle client', { ...profilValide, role: 'client' }],
    ['pseudo manquant', { ...profilValide, pseudo: undefined }],
    ['pseudo vide', { ...profilValide, pseudo: '   ' }],
    ['pseudo nombre', { ...profilValide, pseudo: 12 }],
    ['pseudo trop long', { ...profilValide, pseudo: 'a'.repeat(31) }],
    ['métier trop long', { ...profilValide, metier: 'a'.repeat(41) }],
    ['zone trop longue', { ...profilValide, zone: 'a'.repeat(41) }],
    ['zone objet', { ...profilValide, zone: { nom: 'Akanda' } }],
    ['modalité inconnue', { ...profilValide, modalite: 'partout' }],
    ['services pas une liste', { ...profilValide, services: 'Fuite' }],
    ['trop de services', { ...profilValide, services: Array(4).fill({ label: 'a', prix: 1 }) }],
    ['service null', { ...profilValide, services: [null] }],
    ['service sans nom', { ...profilValide, services: [{ label: '', prix: 1 }] }],
    ['nom de service trop long', { ...profilValide, services: [{ label: 'a'.repeat(41), prix: 1 }] }],
    ['prix texte', { ...profilValide, services: [{ label: 'a', prix: '5000' }] }],
    ['prix à virgule', { ...profilValide, services: [{ label: 'a', prix: 5.5 }] }],
    ['prix nul', { ...profilValide, services: [{ label: 'a', prix: 0 }] }],
    ['prix trop grand', { ...profilValide, services: [{ label: 'a', prix: 100000001 }] }],
    ['prix infini', { ...profilValide, services: [{ label: 'a', prix: Infinity }] }],
    ['prix NaN', { ...profilValide, services: [{ label: 'a', prix: NaN }] }],
  ])('refuse : %s', (_nom, donnee) => {
    expect(nettoyerProfil(donnee)).toBeNull();
  });
});
