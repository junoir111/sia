import { beforeEach, describe, expect, it } from 'vitest';
import { noterPseudo, pseudoDe } from '../src/matrix/annuaire';

const A = '@a:sia.tail94dc60.ts.net';
const B = '@b:sia.tail94dc60.ts.net';

beforeEach(() => localStorage.clear());

describe('annuaire pseudo ↔ compte', () => {
  it('le premier compte vu garde le pseudo (majuscules comprises)', () => {
    expect(noterPseudo(A, 'puma')).toBe(true);
    expect(noterPseudo(A, 'puma')).toBe(true);
    expect(noterPseudo(B, 'puma')).toBe(false);
    expect(noterPseudo(B, 'PUMA')).toBe(false);
    expect(pseudoDe(A)).toBe('puma');
    expect(pseudoDe(B)).toBeNull();
  });

  it('refuse un compte ou un pseudo invalide', () => {
    expect(noterPseudo('pas-un-compte', 'puma')).toBe(false);
    expect(noterPseudo(A, '')).toBe(false);
    expect(noterPseudo(A, 'x'.repeat(500))).toBe(false);
    expect(noterPseudo(A, 42 as unknown as string)).toBe(false);
    expect(localStorage.getItem('sia.annuaire')).toBeNull();
  });

  it('ignore un stockage abîmé et garde 500 entrées au plus', () => {
    localStorage.setItem('sia.annuaire', '{pas du json');
    expect(pseudoDe(A)).toBeNull();
    localStorage.setItem('sia.annuaire', JSON.stringify([{ userId: 3, pseudo: 'x' }, 'x', null]));
    expect(noterPseudo(A, 'x')).toBe(true);
    for (let i = 0; i < 510; i += 1) noterPseudo(`@u${i}:sia.tail94dc60.ts.net`, `p${i}`);
    const liste: unknown = JSON.parse(localStorage.getItem('sia.annuaire') ?? '[]');
    expect(Array.isArray(liste) && liste.length).toBe(500);
  });
});
