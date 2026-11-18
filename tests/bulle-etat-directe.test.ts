import { describe, expect, it } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { lireEtat } from '../src/matrix/bulles';

const PARTICIPANTS = {
  '@a:sia': { pseudo: 'a', zone: 'Akanda' },
  '@b:sia': { pseudo: 'b', zone: 'Akanda' },
};

function salon(contenu: unknown): Room {
  return { currentState: { getStateEvents: () => ({ getContent: () => contenu }) } } as unknown as Room;
}

describe('lireEtat', () => {
  it('lit une bulle ouverte par « Demander » (sans demande attachée)', () => {
    const etat = lireEtat(salon({ participants: PARTICIPANTS }));
    expect(etat?.demande).toBeNull();
    expect(Object.keys(etat?.participants ?? {})).toEqual(['@a:sia', '@b:sia']);
  });

  it('refuse un état sans participants', () => {
    expect(lireEtat(salon({}))).toBeNull();
  });
});
