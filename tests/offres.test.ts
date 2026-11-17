import { describe, expect, it } from 'vitest';
import { avecRef, estIdEvenement, lireRaison, offresSoeurs } from '../src/logique/offres';

const REF = '$abc123:sia.tail94dc60.ts.net';
const REF2 = '$autre';

describe('estIdEvenement', () => {
  it('accepte un identifiant Matrix d’événement', () => {
    expect(estIdEvenement(REF)).toBe(true);
    expect(estIdEvenement('$Yq3_-x')).toBe(true);
  });
  it('refuse le reste', () => {
    for (const v of ['', '$', 'abc', '$a b', '$a]b', '$a[b', `$${'a'.repeat(255)}`, 42, null]) {
      expect(estIdEvenement(v)).toBe(false);
    }
  });
});

describe('avecRef', () => {
  it('ajoute la référence cachée à la fin', () => {
    expect(avecRef('palmier-48 (Akanda) dit oui', REF)).toBe(
      `palmier-48 (Akanda) dit oui [ref:${REF}]`,
    );
  });
  it('refuse une référence invalide', () => {
    expect(() => avecRef('x', '')).toThrow();
    expect(() => avecRef('x', 'a]b')).toThrow();
  });
});

describe('lireRaison', () => {
  it('sépare le texte et la référence', () => {
    expect(lireRaison(`mangue-douce (Akanda) dit oui [ref:${REF}]`)).toEqual({
      texte: 'mangue-douce (Akanda) dit oui',
      ref: REF,
    });
  });
  it('relit ce que fabrique avecRef', () => {
    expect(lireRaison(avecRef('a (b) dit oui', REF2))).toEqual({
      texte: 'a (b) dit oui',
      ref: REF2,
    });
  });
  it('sans référence : texte seul', () => {
    expect(lireRaison('bonjour')).toEqual({ texte: 'bonjour' });
  });
  it('ignore une référence mal fermée', () => {
    expect(lireRaison(`x dit oui [ref:${REF}`)).toEqual({ texte: `x dit oui [ref:${REF}` });
  });
  it('ignore une référence vide', () => {
    expect(lireRaison('x dit oui [ref:]').ref).toBeUndefined();
  });
  it('ignore une référence qui n’est pas un identifiant d’événement', () => {
    expect(lireRaison('x [ref:pas-un-id]').ref).toBeUndefined();
    expect(lireRaison('x [ref:$a b]').ref).toBeUndefined();
  });
  it('ignore une référence très longue', () => {
    expect(lireRaison(`x [ref:$${'a'.repeat(300)}]`).ref).toBeUndefined();
  });
  it('ne garde que la dernière référence, collée à la fin', () => {
    expect(lireRaison(`faux [ref:${REF2}] dit oui [ref:${REF}]`).ref).toBe(REF);
    expect(lireRaison(`x [ref:${REF}] et la suite`).ref).toBeUndefined();
  });
  it('coupe un texte trop long', () => {
    const r = lireRaison(`${'a'.repeat(500)} [ref:${REF}]`);
    expect(r.texte.length).toBeLessThanOrEqual(81);
    expect(r.ref).toBe(REF);
  });
  it('ignore une raison qui contient un caractère piège', () => {
    expect(lireRaison(`mangue‮ (Akanda) dit oui [ref:${REF}]`)).toEqual({ texte: '' });
    expect(lireRaison('a\u0000b (Akanda) dit oui')).toEqual({ texte: '' });
  });
  it('supporte une entrée qui n’est pas du texte', () => {
    expect(lireRaison(undefined)).toEqual({ texte: '' });
    expect(lireRaison(42)).toEqual({ texte: '' });
    expect(lireRaison({ ref: REF })).toEqual({ texte: '' });
  });
});

describe('offresSoeurs', () => {
  const invitations = [
    { roomId: '!a', raison: avecRef('a (x) dit oui', REF) },
    { roomId: '!b', raison: avecRef('b (x) dit oui', REF) },
    { roomId: '!c', raison: avecRef('c (x) dit oui', REF2) },
    { roomId: '!d', raison: 'sans ref' },
    { roomId: '!e', raison: undefined },
    { roomId: '!f', raison: avecRef('f (x) dit oui', REF) },
  ];
  it('rend les autres offres pour la même demande', () => {
    expect(offresSoeurs(invitations, '!a')).toEqual(['!b', '!f']);
    expect(offresSoeurs(invitations, '!c')).toEqual([]);
  });
  it('rien si la bulle choisie est inconnue ou sans référence', () => {
    expect(offresSoeurs(invitations, '!z')).toEqual([]);
    expect(offresSoeurs(invitations, '!d')).toEqual([]);
    expect(offresSoeurs(invitations, '!e')).toEqual([]);
  });
  it('ne modifie pas la liste reçue', () => {
    const copie = structuredClone(invitations);
    offresSoeurs(invitations, '!a');
    expect(invitations).toEqual(copie);
  });
});
