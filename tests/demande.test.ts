import { describe, expect, it } from 'vitest';
import {
  DUREE_DEMANDE_MS,
  TEXTE_DEMANDE_MAX,
  nettoyerDemande,
  texteBandeau,
  verifierDemande,
  type DemandeClient,
} from '../src/logique/demande';
import type { SaisieProfilClient } from '../src/logique/profil-client';

const MAINTENANT = 1_800_000_000_000;

const saisieValide: SaisieProfilClient = {
  pseudo: 'palmier-48',
  zone: 'Akanda',
  service: 'Plombier',
  budget: '5 000 FCFA',
  texte: 'Fuite sous l’évier',
};
const saisie = (c: Partial<SaisieProfilClient>): SaisieProfilClient => ({ ...saisieValide, ...c });

const demandeValide: DemandeClient = {
  pseudo: 'palmier-48',
  service: 'Plombier',
  zone: 'Akanda',
  texte: 'Fuite sous l’évier',
  budget: 5000,
  fin: MAINTENANT + DUREE_DEMANDE_MS,
};
const evenement = { role: 'client', ...demandeValide };

describe('constantes', () => {
  it('une demande dure 24 h, texte 140 signes', () => {
    expect(DUREE_DEMANDE_MS).toBe(24 * 60 * 60_000);
    expect(TEXTE_DEMANDE_MAX).toBe(140);
  });
});

describe('verifierDemande : caractères pièges', () => {
  it('refuse un caractère piège dans chaque champ texte, avec un message clair', () => {
    const r = verifierDemande(
      saisie({ pseudo: 'a‮b', zone: 'Akanda​', service: 'a\u0007b', texte: 'vite\nsvp' }),
      0,
    );
    expect(!r.ok && r.erreurs).toEqual({
      pseudo: 'Caractère non autorisé.',
      zone: 'Caractère non autorisé.',
      service: 'Caractère non autorisé.',
      texte: 'Caractère non autorisé.',
    });
  });
});

describe('verifierDemande', () => {
  it('rend la demande propre avec fin = maintenant + 24 h', () => {
    const r = verifierDemande(
      saisie({ pseudo: ' palmier-48 ', texte: ' Fuite sous l’évier ' }),
      MAINTENANT,
    );
    expect(r).toEqual({ ok: true, demande: demandeValide });
  });
  it('accepte un texte vide', () => {
    const r = verifierDemande(saisie({ texte: '  ' }), MAINTENANT);
    expect(r.ok && r.demande.texte).toBe('');
  });
  it('exige pseudo, zone, service et budget', () => {
    const r = verifierDemande(
      saisie({ pseudo: '', zone: ' ', service: '', budget: '' }),
      MAINTENANT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual(['budget', 'pseudo', 'service', 'zone']);
      expect(r.erreurs.service).toMatch(/besoin/i);
      expect(r.erreurs.budget).toMatch(/FCFA/);
    }
  });
  it('refuse un budget faux', () => {
    for (const budget of ['0', '-5', 'beaucoup', '100000001', '5,5']) {
      const r = verifierDemande(saisie({ budget }), MAINTENANT);
      expect(!r.ok && r.erreurs.budget).toBeTruthy();
    }
  });
  it('refuse les textes trop longs, accepte pile au maximum', () => {
    const trop = verifierDemande(
      saisie({
        pseudo: 'a'.repeat(31),
        zone: 'b'.repeat(41),
        service: 'c'.repeat(41),
        texte: 'd'.repeat(141),
      }),
      MAINTENANT,
    );
    expect(!trop.ok && Object.keys(trop.erreurs).sort()).toEqual([
      'pseudo',
      'service',
      'texte',
      'zone',
    ]);
    const pile = verifierDemande(
      saisie({
        pseudo: 'a'.repeat(30),
        zone: 'b'.repeat(40),
        service: 'c'.repeat(40),
        texte: 'd'.repeat(140),
      }),
      MAINTENANT,
    );
    expect(pile.ok).toBe(true);
  });
});

describe('nettoyerDemande', () => {
  it('rend une demande valide, sans le rôle ni champ en trop', () => {
    expect(nettoyerDemande({ ...evenement, intrus: 1 }, MAINTENANT)).toEqual(demandeValide);
  });
  it('accepte un texte vide ou absent', () => {
    expect(nettoyerDemande({ ...evenement, texte: '' }, MAINTENANT)?.texte).toBe('');
    expect(nettoyerDemande({ ...evenement, texte: undefined }, MAINTENANT)?.texte).toBe('');
  });
  it('accepte une demande sans rôle (gardée sur le téléphone)', () => {
    expect(nettoyerDemande(demandeValide, MAINTENANT)).toEqual(demandeValide);
  });
  it('prend l’heure du téléphone si « maintenant » manque', () => {
    expect(nettoyerDemande({ ...evenement, fin: Date.now() + DUREE_DEMANDE_MS })).not.toBeNull();
    expect(nettoyerDemande({ ...evenement, fin: Date.now() + 10 * DUREE_DEMANDE_MS })).toBeNull();
  });
  it('garde une demande déjà expirée (le tri se fait ailleurs)', () => {
    expect(nettoyerDemande({ ...evenement, fin: MAINTENANT - 1 }, MAINTENANT)).not.toBeNull();
  });
  it('tolère 5 min d’avance d’horloge, pas plus', () => {
    const limite = MAINTENANT + DUREE_DEMANDE_MS + 5 * 60_000;
    expect(nettoyerDemande({ ...evenement, fin: limite }, MAINTENANT)).not.toBeNull();
    expect(nettoyerDemande({ ...evenement, fin: limite + 1 }, MAINTENANT)).toBeNull();
  });
  it.each([
    ['null', null],
    ['texte', 'demande'],
    ['tableau', [evenement]],
    ['rôle vide', { ...evenement, role: '' }],
    ['rôle prestataire', { ...evenement, role: 'prestataire' }],
    ['pseudo vide', { ...evenement, pseudo: ' ' }],
    ['pseudo trop long', { ...evenement, pseudo: 'a'.repeat(31) }],
    ['service manquant', { ...evenement, service: undefined }],
    ['service trop long', { ...evenement, service: 'a'.repeat(41) }],
    ['zone nombre', { ...evenement, zone: 3 }],
    ['zone trop longue', { ...evenement, zone: 'a'.repeat(41) }],
    ['texte trop long', { ...evenement, texte: 'a'.repeat(141) }],
    ['texte objet', { ...evenement, texte: { a: 1 } }],
    ['pseudo avec inversion de sens', { ...evenement, pseudo: 'a‮b' }],
    ['zone avec caractère invisible', { ...evenement, zone: 'Akanda​' }],
    ['service avec caractère de contrôle', { ...evenement, service: 'a\u0007b' }],
    ['texte avec inversion de sens', { ...evenement, texte: 'vite⁦svp' }],
    ['budget texte', { ...evenement, budget: '5000' }],
    ['budget à virgule', { ...evenement, budget: 5.5 }],
    ['budget nul', { ...evenement, budget: 0 }],
    ['budget trop grand', { ...evenement, budget: 100_000_001 }],
    ['budget NaN', { ...evenement, budget: NaN }],
    ['fin texte', { ...evenement, fin: '123' }],
    ['fin à virgule', { ...evenement, fin: MAINTENANT + 0.5 }],
    ['fin négative', { ...evenement, fin: -1 }],
    ['fin infinie', { ...evenement, fin: Infinity }],
    ['fin trop lointaine', { ...evenement, fin: MAINTENANT + 30 * 3_600_000 }],
  ])('refuse : %s', (_nom, donnee) => {
    expect(nettoyerDemande(donnee, MAINTENANT)).toBeNull();
  });
});

describe('texteBandeau', () => {
  it('pseudo · quartier · budget FCFA · service', () => {
    expect(texteBandeau(demandeValide)).toBe('palmier-48 · Akanda · 5 000 FCFA · Plombier');
  });
});
