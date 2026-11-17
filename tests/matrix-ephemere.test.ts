import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arreterEphemere,
  dejaAffiche,
  echeanceEffacement,
  effacerTout,
  marquerAffiche,
  reprendreEffacements,
  toutEffacerMaintenant,
} from '../src/matrix/ephemere';
import { AUTRE, MOI, comme, evenement, fauxClient, salon } from './faux-matrix';

const BULLE = '!b1:sia.tail94dc60.ts.net';
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  arreterEphemere();
  vi.useRealTimers();
});

describe('marquerAffiche', () => {
  it("efface le message 60 s après l'affichage, pas avant", async () => {
    const c = fauxClient([]);
    marquerAffiche(comme(c), BULLE, '$m1');
    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(c.redactEvent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(c.redactEvent).toHaveBeenCalledWith(BULLE, '$m1');
    expect(localStorage.getItem('sia.a-effacer')).toBeNull();
  });

  it('garde seulement les identifiants et l’échéance dans la file', () => {
    marquerAffiche(comme(fauxClient([])), BULLE, '$m1');
    const file: unknown = JSON.parse(localStorage.getItem('sia.a-effacer') ?? '[]');
    expect(file).toEqual([{ roomId: BULLE, eventId: '$m1', echeance: Date.now() + MINUTE }]);
    expect(dejaAffiche('$m1')).toBe(true);
    expect(dejaAffiche('$m2')).toBe(false);
  });

  it('ne relance pas le compte à rebours si le message est réaffiché', async () => {
    const c = fauxClient([]);
    marquerAffiche(comme(c), BULLE, '$m1');
    await vi.advanceTimersByTimeAsync(30_000);
    marquerAffiche(comme(c), BULLE, '$m1');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(c.redactEvent).toHaveBeenCalledTimes(1);
  });

  it('ignore des identifiants invalides', () => {
    marquerAffiche(comme(fauxClient([])), 'pas-un-salon', '$m1');
    marquerAffiche(comme(fauxClient([])), BULLE, 'pas un id');
    expect(localStorage.getItem('sia.a-effacer')).toBeNull();
  });

  it('réessaie après une coupure réseau, abandonne si le serveur refuse', async () => {
    const c = fauxClient([]);
    c.redactEvent.mockRejectedValueOnce(new TypeError('réseau'));
    marquerAffiche(comme(c), BULLE, '$m1');
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(localStorage.getItem('sia.a-effacer')).toContain('$m1');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(c.redactEvent).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('sia.a-effacer')).toBeNull();

    c.redactEvent.mockRejectedValueOnce({ httpStatus: 403, errcode: 'M_FORBIDDEN' });
    marquerAffiche(comme(c), BULLE, '$m2');
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(localStorage.getItem('sia.a-effacer')).toBeNull();
  });
});

describe('reprendreEffacements', () => {
  it('reprend la file après un redémarrage et ignore les entrées abîmées', async () => {
    const maintenant = Date.now();
    localStorage.setItem(
      'sia.a-effacer',
      JSON.stringify([
        { roomId: BULLE, eventId: '$vieux', echeance: maintenant - 1 },
        { roomId: BULLE, eventId: '$bientot', echeance: maintenant + 10_000 },
        { roomId: 'x', eventId: '$faux', echeance: 0 },
        'n’importe quoi',
      ]),
    );
    const c = fauxClient([]);
    reprendreEffacements(comme(c));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.redactEvent).toHaveBeenCalledWith(BULLE, '$vieux');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.redactEvent).toHaveBeenCalledWith(BULLE, '$bientot');
    expect(c.redactEvent).toHaveBeenCalledTimes(2);
  });

  it('survit à une file illisible', () => {
    localStorage.setItem('sia.a-effacer', '{pas du json');
    expect(() => reprendreEffacements(comme(fauxClient([])))).not.toThrow();
  });
});

describe('effacerTout', () => {
  it('efface les messages que je peux effacer, pas les états ni les messages déjà effacés', async () => {
    const mien = evenement({ type: 'm.room.message', sender: MOI, roomId: BULLE, id: '$a' });
    const sien = evenement({ type: 'm.room.message', sender: AUTRE, roomId: BULLE, id: '$b' });
    const chiffre = evenement({ type: 'm.room.encrypted', sender: AUTRE, roomId: BULLE, id: '$c' });
    const deja = evenement({
      type: 'm.room.message',
      sender: AUTRE,
      roomId: BULLE,
      id: '$d',
      redacted: true,
    });
    const etat = evenement({
      type: 'io.sia.bulle',
      stateKey: '',
      sender: AUTRE,
      roomId: BULLE,
      id: '$e',
    });
    const interdit = evenement({ type: 'm.room.message', sender: AUTRE, roomId: BULLE, id: '$f' });
    const b = salon({
      roomId: BULLE,
      appartenance: 'join',
      membres: {},
      etat: {},
      evenements: [mien, sien, chiffre, deja, etat, interdit],
      peutEffacer: (ev) => ev.getId() !== '$f',
    });
    const c = fauxClient([b]);
    expect(await effacerTout(comme(c), BULLE)).toBe(3);
    expect(c.redactEvent.mock.calls.map((a) => (a as unknown[])[1])).toEqual(['$a', '$b', '$c']);
  });
});

describe('echeanceEffacement', () => {
  it("rend l'échéance d'un message en file, sinon null", () => {
    marquerAffiche(comme(fauxClient([])), BULLE, '$m1');
    expect(echeanceEffacement('$m1')).toBe(Date.now() + MINUTE);
    expect(echeanceEffacement('$inconnu')).toBeNull();
    expect(echeanceEffacement('pas un id')).toBeNull();
  });
});

describe('toutEffacerMaintenant', () => {
  it('efface toute la file sans attendre la minute ; une coupure garde le message en file', async () => {
    const c = fauxClient([]);
    marquerAffiche(comme(c), BULLE, '$m1');
    marquerAffiche(comme(c), BULLE, '$m2');
    marquerAffiche(comme(c), BULLE, '$m3');
    c.redactEvent
      .mockResolvedValueOnce({ event_id: '$x' })
      .mockRejectedValueOnce(Object.assign(new Error('déjà'), { httpStatus: 404 }))
      .mockRejectedValueOnce(new Error('réseau'));
    await toutEffacerMaintenant(comme(c));
    expect(c.redactEvent.mock.calls.map((a) => (a as unknown[])[1])).toEqual(['$m1', '$m2', '$m3']);
    expect(echeanceEffacement('$m1')).toBeNull();
    expect(echeanceEffacement('$m2')).toBeNull();
    expect(echeanceEffacement('$m3')).not.toBeNull();
    // Les minuteries sont coupées : rien ne repart tout seul.
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(c.redactEvent).toHaveBeenCalledTimes(3);
  });
});
