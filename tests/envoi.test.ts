import { describe, expect, it } from 'vitest';
import { ConnectionError, EventType, MatrixError, MatrixEvent } from 'matrix-js-sdk';
import {
  ATTENTE_MAX_MS,
  ATTENTE_MIN_MS,
  DELAI_REQUETE_MS,
  ENVOIS_MAX,
  fileEnvoi,
  reessaiEnvoi,
} from '../src/matrix/envoi';

const SALON = '!abc:sia.tail94dc60.ts.net';

/** `null` : événement sans bulle (une valeur absente donnerait la bulle par défaut). */
function evenement(type: string, roomId: string | null = SALON): MatrixEvent {
  return new MatrixEvent({ type, room_id: roomId ?? undefined, content: {}, sender: '@moi:sia' });
}

function erreurHttp(statut: number, corps: Record<string, unknown> = {}): MatrixError {
  return new MatrixError({ errcode: 'M_X', error: 'x', ...corps }, statut);
}

describe('fileEnvoi : une file par bulle, seulement pour les messages', () => {
  it('un message va dans la file de sa bulle', () => {
    expect(fileEnvoi(evenement(EventType.RoomMessage))).toBe(`bulle:${SALON}`);
  });

  it('deux bulles = deux files (un échec dans l’une ne touche pas l’autre)', () => {
    const autre = '!autre:sia.tail94dc60.ts.net';
    expect(fileEnvoi(evenement(EventType.RoomMessage, autre))).not.toBe(
      fileEnvoi(evenement(EventType.RoomMessage)),
    );
  });

  it('un effacement ne fait pas la queue derrière les messages', () => {
    expect(fileEnvoi(evenement(EventType.RoomRedaction))).toBeNull();
  });

  it('tout autre événement part tout de suite', () => {
    expect(fileEnvoi(evenement(EventType.Typing))).toBeNull();
  });

  it('un message déjà chiffré (type « m.room.encrypted » sur le réseau) est bien dans la file de sa bulle', () => {
    const chiffre = evenement(EventType.RoomMessage);
    chiffre.makeEncrypted(
      EventType.RoomMessageEncrypted,
      { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'x' },
      'cle-curve',
      'cle-ed',
    );
    expect(chiffre.getWireType()).toBe('m.room.encrypted');
    expect(fileEnvoi(chiffre)).toBe(`bulle:${SALON}`);
  });

  it('un message sans bulle connue n’est dans aucune file', () => {
    expect(fileEnvoi(evenement(EventType.RoomMessage, null))).toBeNull();
  });
});

describe('reessaiEnvoi : quand renvoyer un message', () => {
  it('coupure du réseau : on renvoie, de plus en plus tard, avec un plafond', () => {
    const coupure = new ConnectionError('fetch failed');
    const attentes = [1, 2, 3, 4].map((n) => reessaiEnvoi(null, n, coupure));
    expect(attentes[0]).toBe(ATTENTE_MIN_MS);
    expect(attentes[1]).toBe(2 * ATTENTE_MIN_MS);
    expect(attentes[2]).toBe(4 * ATTENTE_MIN_MS);
    expect(attentes.every((a) => a >= ATTENTE_MIN_MS && a <= ATTENTE_MAX_MS)).toBe(true);
    expect(attentes).toEqual([...attentes].sort((a, b) => a - b));
  });

  it(`on abandonne après ${ENVOIS_MAX} envois en échec`, () => {
    const coupure = new ConnectionError('fetch failed');
    expect(reessaiEnvoi(null, ENVOIS_MAX - 1, coupure)).toBeGreaterThan(0);
    expect(reessaiEnvoi(null, ENVOIS_MAX, coupure)).toBe(-1);
    expect(reessaiEnvoi(null, ENVOIS_MAX + 3, coupure)).toBe(-1);
  });

  it('requête sans réponse coupée par le délai (AbortError) : on renvoie aussi', () => {
    const delai = new DOMException('coupée', 'AbortError');
    expect(reessaiEnvoi(null, 1, delai)).toBe(ATTENTE_MIN_MS);
  });

  it('serveur en panne passagère (502, 503, 504, 500) : on renvoie', () => {
    for (const statut of [500, 502, 503, 504]) {
      expect(reessaiEnvoi(null, 1, erreurHttp(statut))).toBe(ATTENTE_MIN_MS);
    }
  });

  it('refus définitif du serveur (400, 401, 403, 404) : inutile de renvoyer', () => {
    for (const statut of [400, 401, 403, 404]) {
      expect(reessaiEnvoi(null, 1, erreurHttp(statut))).toBe(-1);
    }
  });

  it('message trop gros : jamais renvoyé', () => {
    expect(reessaiEnvoi(null, 1, erreurHttp(413, { errcode: 'M_TOO_LARGE' }))).toBe(-1);
  });

  it('trop de demandes (429) : on attend le délai du serveur, borné', () => {
    expect(reessaiEnvoi(null, 1, erreurHttp(429, { retry_after_ms: 1200 }))).toBe(1200);
    expect(reessaiEnvoi(null, 1, erreurHttp(429, { retry_after_ms: 90_000 }))).toBe(5000);
    expect(reessaiEnvoi(null, 1, erreurHttp(429, { retry_after_ms: 3 }))).toBe(500);
    expect(reessaiEnvoi(null, 1, erreurHttp(429))).toBe(2000);
  });

  it('une erreur inattendue (même sans statut) ne fait jamais planter la décision', () => {
    expect(reessaiEnvoi(null, 1, undefined)).toBe(ATTENTE_MIN_MS);
    expect(reessaiEnvoi(null, 1, null)).toBe(ATTENTE_MIN_MS);
    expect(reessaiEnvoi(null, 1, 'texte')).toBe(ATTENTE_MIN_MS);
    expect(reessaiEnvoi(null, 1, new Error('?'))).toBe(ATTENTE_MIN_MS);
  });
});

describe('délai des requêtes', () => {
  it('assez long pour un réseau lent (relais), assez court pour ne pas bloquer longtemps', () => {
    expect(DELAI_REQUETE_MS).toBeGreaterThanOrEqual(10_000);
    expect(DELAI_REQUETE_MS).toBeLessThanOrEqual(20_000);
  });
});
