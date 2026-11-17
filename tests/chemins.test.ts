import { describe, expect, it } from 'vitest';
import { CHEMINS, cheminApresInscription, cheminBulle } from '../src/chemins';

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
