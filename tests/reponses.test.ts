import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  commencerReponse,
  enFile,
  etatReponse,
  finirReponse,
  messageEchec,
  oublierReponses,
  rater,
  reponseParties,
  useReponse,
} from '../src/ecrans/bandeau/reponses';
import { differe } from './faux-ecran';

describe('réponses « Oui » / « Non » en route', () => {
  beforeEach(() => oublierReponses());

  it('au repos tant qu’on n’a rien répondu', () => {
    expect(etatReponse('$d1')).toBe('repos');
    expect(reponseParties('repos')).toBe(false);
    expect(messageEchec('repos')).toBeNull();
  });

  it('commencer : la réponse part, et une carte ne reçoit jamais deux réponses', () => {
    expect(commencerReponse('$d1')).toBe(true);
    expect(etatReponse('$d1')).toBe('envoi');
    expect(reponseParties('envoi')).toBe(true);
    expect(commencerReponse('$d1')).toBe(false);
    // Une autre carte n'est pas concernée.
    expect(commencerReponse('$d2')).toBe(true);
  });

  it('finir : la carte reste « envoyée » jusqu’à son départ, et ne reçoit plus de réponse', () => {
    commencerReponse('$d1');
    finirReponse('$d1');
    expect(etatReponse('$d1')).toBe('fait');
    expect(reponseParties('fait')).toBe(true);
    expect(commencerReponse('$d1')).toBe(false);
  });

  it('rater : un message qui dit quoi faire, et on peut répondre à nouveau', () => {
    commencerReponse('$d1');
    rater('$d1', 'reseau');
    expect(reponseParties(etatReponse('$d1'))).toBe(false);
    expect(messageEchec('reseau')).toBe('Pas de réseau. Réessaie.');
    expect(messageEchec('probleme')).toBe('Ça n’a pas marché. Réessaie.');
    expect(commencerReponse('$d1')).toBe(true);
    expect(etatReponse('$d1')).toBe('envoi');
  });

  it('useReponse suit la carte et se met à jour tout seul', () => {
    const { result } = renderHook(() => useReponse('$d1'));
    expect(result.current).toBe('repos');
    act(() => {
      commencerReponse('$d1');
    });
    expect(result.current).toBe('envoi');
    act(() => rater('$d1', 'probleme'));
    expect(result.current).toBe('probleme');
    act(() => finirReponse('$d1'));
    expect(result.current).toBe('fait');
  });

  it('seules les 50 réponses les plus récentes sont gardées', () => {
    for (let i = 0; i < 60; i += 1) finirReponse(`$e${i}`);
    expect(etatReponse('$e0')).toBe('repos'); // oubliée
    expect(etatReponse('$e9')).toBe('repos');
    expect(etatReponse('$e10')).toBe('fait');
    expect(etatReponse('$e59')).toBe('fait');
  });

  describe('acceptations en file', () => {
    it('passent une par une, dans l’ordre', async () => {
      const journal: string[] = [];
      const premiere = differe();
      const a = enFile(async () => {
        journal.push('a début');
        await premiere.promesse;
        journal.push('a fin');
      });
      const b = enFile(async () => {
        journal.push('b début');
      });
      await Promise.resolve();
      expect(journal).toEqual(['a début']);
      premiere.resoudre();
      await Promise.all([a, b]);
      expect(journal).toEqual(['a début', 'a fin', 'b début']);
    });

    it('une acceptation qui échoue ne bloque pas la suivante, et son échec est rendu à son appelant', async () => {
      const ratee = enFile(() => Promise.reject(new Error('refusée')));
      const suivante = enFile(() => Promise.resolve('ok'));
      await expect(ratee).rejects.toThrow('refusée');
      await expect(suivante).resolves.toBe('ok');
    });
  });
});
