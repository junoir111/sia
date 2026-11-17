import { describe, expect, it } from 'vitest';
import { QUARTIERS, chercherQuartiers } from '../src/logique/quartiers';

describe('QUARTIERS', () => {
  it('contient les communes et quartiers cités dans le PRD', () => {
    for (const nom of ['Libreville', 'Akanda', 'Owendo', 'Ntoum', 'PK12', 'Nzeng-Ayong', 'Mont-Bouët']) {
      expect(QUARTIERS).toContain(nom);
    }
  });
  it("n'a pas de doublon et chaque nom tient dans la zone (40 signes)", () => {
    expect(new Set(QUARTIERS).size).toBe(QUARTIERS.length);
    for (const nom of QUARTIERS) {
      expect(nom.trim()).toBe(nom);
      expect(nom.length).toBeGreaterThan(0);
      expect(nom.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('chercherQuartiers', () => {
  it('rend une liste vide pour une saisie vide', () => {
    expect(chercherQuartiers('')).toEqual([]);
    expect(chercherQuartiers('   ')).toEqual([]);
  });
  it('ignore les accents et la casse', () => {
    expect(chercherQuartiers('akebe')).toContain('Akébé');
    expect(chercherQuartiers('MONT-BOUET')).toContain('Mont-Bouët');
  });
  it('ignore tirets et espaces', () => {
    expect(chercherQuartiers('nzeng ayong')).toContain('Nzeng-Ayong');
    expect(chercherQuartiers('pk 12')).toContain('PK12');
  });
  it("met d'abord ceux qui commencent par la saisie, puis ceux qui la contiennent", () => {
    // « Alénakiri » et « Kalikak » contiennent « ak » sans commencer par : ils viennent après les « Ak… ».
    expect(chercherQuartiers('ak', 20)).toEqual(['Akanda', 'Akébé', 'Akournam', 'Alénakiri', 'Kalikak']);
  });
  it('respecte le maximum (4 par défaut)', () => {
    expect(chercherQuartiers('a').length).toBe(4);
    expect(chercherQuartiers('a', 2).length).toBe(2);
  });
  it('rend une liste vide si rien ne correspond', () => {
    expect(chercherQuartiers('zzzz')).toEqual([]);
  });
});
