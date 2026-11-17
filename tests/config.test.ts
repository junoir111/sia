import { describe, expect, it } from 'vitest';
import { ADRESSE_SERVEUR, DUREE_MAX_ANNONCE_MS, DUREE_MESSAGE_MS } from '../src/config';

describe('config', () => {
  it('pointe vers le serveur SIA en HTTPS', () => {
    expect(ADRESSE_SERVEUR).toBe('https://sia.tail94dc60.ts.net');
  });

  it('donne une minute de vie à un message', () => {
    expect(DUREE_MESSAGE_MS).toBe(60_000);
  });

  it('limite une annonce à 24 heures', () => {
    expect(DUREE_MAX_ANNONCE_MS).toBe(24 * 60 * 60 * 1000);
  });
});
