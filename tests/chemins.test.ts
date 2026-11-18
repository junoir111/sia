import { describe, expect, it } from 'vitest';
import {
  CHEMINS,
  cheminApresInscription,
  cheminBulle,
  cheminFicheDemande,
  cheminFichePrestataire,
  cheminListeMetier,
  cheminMur,
} from '../src/chemins';

describe('cheminApresInscription', () => {
  it('prestataire → profil prestataire (E5)', () => {
    expect(cheminApresInscription('prestataire')).toBe(CHEMINS.profilPrestataire);
  });

  it('client → profil client (E6)', () => {
    expect(cheminApresInscription('client')).toBe(CHEMINS.profilClient);
  });

  it('pas de rôle → choix du rôle (E4)', () => {
    expect(cheminApresInscription(null)).toBe(CHEMINS.role);
  });
});

describe('cheminBulle', () => {
  it("encode l'identifiant du salon", () => {
    expect(cheminBulle('!abc:sia.tail94dc60.ts.net')).toBe('/bulle/!abc%3Asia.tail94dc60.ts.net');
  });

  it('les chemins de la mise en relation existent', () => {
    expect(CHEMINS.bulles).toBe('/bulles');
    expect(CHEMINS.bulle).toBe('/bulle/:roomId');
  });
});

describe('chemins du Mur', () => {
  it('les motifs de route existent', () => {
    expect(CHEMINS.listeMetier).toBe('/mur/metier/:metier');
    expect(CHEMINS.fichePrestataire).toBe('/mur/prestataire/:eventId');
    expect(CHEMINS.ficheDemande).toBe('/mur/demande/:eventId');
  });

  it('cheminListeMetier encode le métier et garde le quartier', () => {
    expect(cheminListeMetier('Électricien', 'Akanda')).toBe(
      '/mur/metier/%C3%89lectricien?quartier=Akanda',
    );
    expect(cheminListeMetier('Plombier')).toBe('/mur/metier/Plombier');
  });

  it('les fiches gardent le métier et le quartier pour le retour', () => {
    expect(cheminFichePrestataire('$a:b', 'Plombier', 'Nzeng Ayong')).toBe(
      '/mur/prestataire/%24a%3Ab?metier=Plombier&quartier=Nzeng+Ayong',
    );
    expect(cheminFicheDemande('$c', 'Plombier')).toBe('/mur/demande/%24c?metier=Plombier');
  });

  it('cheminMur reprend le quartier', () => {
    expect(cheminMur()).toBe('/mur');
    expect(cheminMur('Akanda')).toBe('/mur?quartier=Akanda');
  });

  it('profil complet → le Mur', () => {
    expect(cheminApresInscription('client', true)).toBe(CHEMINS.mur);
  });
});
