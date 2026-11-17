import { describe, expect, it } from 'vitest';
import { CHEMINS, cheminApresInscription } from '../src/chemins';

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
