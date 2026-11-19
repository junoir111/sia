import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, SyncState } from 'matrix-js-sdk';
import {
  AGE_SYNCHRO_SUSPECTE_MS,
  DELAI_CHIEN_DE_GARDE_MS,
  ECHECS_AVANT_REDEMARRAGE,
  suivreSynchro,
  surveillerSynchro,
} from '../src/matrix/reveil';
import { emetteur } from './faux-matrix';

/*
 * Réveil rapide et chien de garde de la synchro : aucun réseau, minuteries simulées.
 */

const SECONDE = 1000;

/** Faux client : seulement ce que surveillerSynchro lui demande. */
function fauxClient(sdkRetente = false) {
  const e = emetteur();
  return {
    on: e.on,
    off: e.off,
    emit: e.emit,
    retryImmediately: vi.fn(() => sdkRetente),
    getSyncState: vi.fn((): SyncState | null => SyncState.Syncing),
  };
}
type Faux = ReturnType<typeof fauxClient>;

function surveiller(c: Faux) {
  const actions = { couperSynchro: vi.fn(), redemarrer: vi.fn() };
  const arreter = surveillerSynchro(
    c as unknown as Parameters<typeof surveillerSynchro>[0],
    actions,
  );
  return { actions, arreter };
}

function cycleAbouti(c: Faux): void {
  c.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
}

function pageVisible(visible: boolean): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visible ? 'visible' : 'hidden');
}

function enLigne(oui: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(oui);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 18, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('réveil de la synchro', () => {
  it('page de nouveau visible, réseau de retour, « resume » de Capacitor : relance tout de suite', () => {
    const c = fauxClient();
    const { arreter } = surveiller(c);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(c.retryImmediately).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(c.retryImmediately).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('resume'));
    expect(c.retryImmediately).toHaveBeenCalledTimes(3);
    arreter();
  });

  it('page qui se cache ou hors ligne : rien à relancer', () => {
    const c = fauxClient();
    const { arreter } = surveiller(c);
    pageVisible(false);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('resume'));
    expect(c.retryImmediately).not.toHaveBeenCalled();
    pageVisible(true);
    enLigne(false);
    window.dispatchEvent(new Event('online'));
    expect(c.retryImmediately).not.toHaveBeenCalled();
    arreter();
  });

  it('dernière synchro récente : relance seulement, la connexion n’est pas coupée', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    vi.advanceTimersByTime(AGE_SYNCHRO_SUSPECTE_MS - SECONDE);
    document.dispatchEvent(new Event('resume'));
    expect(c.retryImmediately).toHaveBeenCalledTimes(1);
    expect(actions.couperSynchro).not.toHaveBeenCalled();
    arreter();
  });

  it('dernière synchro trop vieille : la longue requête est coupée, puis la relance part sans attendre', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    vi.advanceTimersByTime(AGE_SYNCHRO_SUSPECTE_MS + SECONDE);
    document.dispatchEvent(new Event('resume'));
    expect(actions.couperSynchro).toHaveBeenCalledTimes(1);
    expect(c.retryImmediately).toHaveBeenCalledTimes(1);
    // Le SDK ne note l'échec de la requête coupée qu'un instant plus tard : alors seulement la relance compte.
    vi.advanceTimersByTime(60);
    expect(c.retryImmediately).toHaveBeenCalledTimes(2);
    arreter();
  });

  it('le SDK réessaie déjà (relance acceptée) : rien n’est coupé', () => {
    const c = fauxClient(true);
    const { actions, arreter } = surveiller(c);
    vi.advanceTimersByTime(AGE_SYNCHRO_SUSPECTE_MS + SECONDE);
    document.dispatchEvent(new Event('resume'));
    expect(c.retryImmediately).toHaveBeenCalledTimes(1);
    expect(actions.couperSynchro).not.toHaveBeenCalled();
    arreter();
  });

  it('un cycle de synchro abouti remet la dernière synchro à zéro', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    vi.advanceTimersByTime(AGE_SYNCHRO_SUSPECTE_MS + SECONDE);
    cycleAbouti(c);
    document.dispatchEvent(new Event('resume'));
    expect(actions.couperSynchro).not.toHaveBeenCalled();
    arreter();
  });

  it('une relance ou une coupure qui échoue ne fait jamais remonter d’erreur', () => {
    const c = fauxClient();
    c.retryImmediately.mockImplementation(() => {
      throw new Error('boum');
    });
    const { actions, arreter } = surveiller(c);
    actions.couperSynchro.mockImplementation(() => {
      throw new Error('boum');
    });
    vi.advanceTimersByTime(AGE_SYNCHRO_SUSPECTE_MS + SECONDE);
    expect(() => document.dispatchEvent(new Event('resume'))).not.toThrow();
    expect(() => vi.advanceTimersByTime(2 * DELAI_CHIEN_DE_GARDE_MS)).not.toThrow();
    expect(actions.couperSynchro.mock.calls.length).toBeGreaterThan(1);
    arreter();
  });
});

describe('chien de garde', () => {
  it('aucun cycle abouti depuis 45 s, page visible et en ligne : relance et coupe la requête', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    vi.advanceTimersByTime(DELAI_CHIEN_DE_GARDE_MS - SECONDE);
    expect(c.retryImmediately).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10 * SECONDE);
    expect(c.retryImmediately).toHaveBeenCalled();
    expect(actions.couperSynchro).toHaveBeenCalledTimes(1);
    expect(actions.redemarrer).not.toHaveBeenCalled();
    arreter();
  });

  it('un cycle abouti tient le chien de garde tranquille', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(30 * SECONDE);
      cycleAbouti(c);
    }
    expect(c.retryImmediately).not.toHaveBeenCalled();
    expect(actions.couperSynchro).not.toHaveBeenCalled();
    arreter();
  });

  it(`après ${ECHECS_AVANT_REDEMARRAGE} interventions sans effet : on repart de zéro`, () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    vi.advanceTimersByTime(DELAI_CHIEN_DE_GARDE_MS + 5 * SECONDE);
    vi.advanceTimersByTime(DELAI_CHIEN_DE_GARDE_MS + 5 * SECONDE);
    expect(actions.couperSynchro).toHaveBeenCalledTimes(ECHECS_AVANT_REDEMARRAGE - 1);
    expect(actions.redemarrer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DELAI_CHIEN_DE_GARDE_MS + 5 * SECONDE);
    expect(actions.redemarrer).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('un cycle abouti entre deux interventions remet le compte à zéro', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    vi.advanceTimersByTime(2 * (DELAI_CHIEN_DE_GARDE_MS + 5 * SECONDE));
    cycleAbouti(c);
    vi.advanceTimersByTime(2 * (DELAI_CHIEN_DE_GARDE_MS + 5 * SECONDE));
    expect(actions.redemarrer).not.toHaveBeenCalled();
    arreter();
  });

  it('le SDK réessaie déjà (serveur injoignable) : jamais de redémarrage, la relance continue', () => {
    const c = fauxClient(true);
    for (const etat of [SyncState.Error, SyncState.Reconnecting, SyncState.Catchup]) {
      c.getSyncState.mockReturnValue(etat);
      const { actions, arreter } = surveiller(c);
      vi.advanceTimersByTime(5 * (DELAI_CHIEN_DE_GARDE_MS + 5 * SECONDE));
      expect(actions.redemarrer).not.toHaveBeenCalled();
      expect(actions.couperSynchro).not.toHaveBeenCalled();
      expect(c.retryImmediately).toHaveBeenCalled();
      arreter();
    }
  });

  it('page cachée ou hors ligne : aucune intervention, et le décompte repart au retour', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    pageVisible(false);
    vi.advanceTimersByTime(10 * DELAI_CHIEN_DE_GARDE_MS);
    pageVisible(true);
    enLigne(false);
    vi.advanceTimersByTime(10 * DELAI_CHIEN_DE_GARDE_MS);
    enLigne(true);
    vi.advanceTimersByTime(DELAI_CHIEN_DE_GARDE_MS - 10 * SECONDE);
    expect(c.retryImmediately).not.toHaveBeenCalled();
    expect(actions.couperSynchro).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20 * SECONDE);
    expect(actions.couperSynchro).toHaveBeenCalledTimes(1);
    arreter();
  });

  it('un redémarrage qui échoue ne fait jamais remonter d’erreur', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    actions.redemarrer.mockImplementation(() => {
      throw new Error('boum');
    });
    expect(() => vi.advanceTimersByTime(4 * (DELAI_CHIEN_DE_GARDE_MS + 5 * SECONDE))).not.toThrow();
    expect(actions.redemarrer).toHaveBeenCalled();
    arreter();
  });

  it('une fois arrêtée, la surveillance ne fait plus rien', () => {
    const c = fauxClient();
    const { actions, arreter } = surveiller(c);
    arreter();
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(5 * DELAI_CHIEN_DE_GARDE_MS);
    expect(c.retryImmediately).not.toHaveBeenCalled();
    expect(actions.couperSynchro).not.toHaveBeenCalled();
    expect(actions.redemarrer).not.toHaveBeenCalled();
  });
});

describe('suivi des requêtes /sync', () => {
  /** Faux fetch : la requête ne finit jamais, sauf si son signal est coupé. */
  function fetchSuspendu() {
    return vi.fn(
      (_requete: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((_, rejeter) => {
          const refuser = (): void => rejeter(new DOMException('coupée', 'AbortError'));
          if (options?.signal?.aborted) refuser();
          options?.signal?.addEventListener('abort', refuser);
        }),
    );
  }
  const URL_SYNC = 'https://sia.tail94dc60.ts.net/_matrix/client/v3/sync?timeout=30000&since=s1';

  it('les autres requêtes passent telles quelles (même signal, même réponse)', async () => {
    const reponse = new Response('{}');
    const faux = vi.fn(async () => reponse);
    vi.stubGlobal('fetch', faux);
    const signal = new AbortController().signal;
    const { fetchFn, couperSynchro } = suivreSynchro();
    for (const url of [
      'https://sia.tail94dc60.ts.net/_matrix/client/v3/keys/query',
      'https://sia.tail94dc60.ts.net/_matrix/client/v3/rooms/!a:x/send/m.room.encrypted/t1',
      'https://sia.tail94dc60.ts.net/_matrix/client/v3/sync/historique',
    ]) {
      await expect(fetchFn(url, { signal, method: 'POST' })).resolves.toBe(reponse);
      expect(faux).toHaveBeenLastCalledWith(url, { signal, method: 'POST' });
    }
    couperSynchro();
    expect(signal.aborted).toBe(false);
  });

  it('couperSynchro coupe la requête /sync en cours (le SDK la voit échouer et en relance une)', async () => {
    vi.stubGlobal('fetch', fetchSuspendu());
    const { fetchFn, couperSynchro } = suivreSynchro();
    const enCours = fetchFn(URL_SYNC, { signal: new AbortController().signal });
    const verdict = expect(enCours).rejects.toMatchObject({ name: 'AbortError' });
    couperSynchro();
    await verdict;
    // Plus rien à couper ensuite.
    expect(() => couperSynchro()).not.toThrow();
  });

  it('reconnaît /sync dans un objet URL ou une Request, et coupe tout ce qui est en cours', async () => {
    vi.stubGlobal('fetch', fetchSuspendu());
    const { fetchFn, couperSynchro } = suivreSynchro();
    const a = fetchFn(new URL(URL_SYNC));
    const b = fetchFn(new Request(URL_SYNC));
    const verdicts = Promise.all([
      expect(a).rejects.toMatchObject({ name: 'AbortError' }),
      expect(b).rejects.toMatchObject({ name: 'AbortError' }),
    ]);
    couperSynchro();
    await verdicts;
  });

  it('un arrêt demandé par le SDK (signal reçu) coupe aussi la requête, même déjà coupé', async () => {
    const faux = fetchSuspendu();
    vi.stubGlobal('fetch', faux);
    const { fetchFn } = suivreSynchro();
    const sdk = new AbortController();
    const enCours = fetchFn(URL_SYNC, { signal: sdk.signal });
    const verdict = expect(enCours).rejects.toMatchObject({ name: 'AbortError' });
    sdk.abort();
    await verdict;
    sdk.abort();
    await expect(fetchFn(URL_SYNC, { signal: sdk.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('une requête /sync qui aboutit est oubliée : couperSynchro ne touche plus à rien', async () => {
    const reponse = new Response('{}');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reponse),
    );
    const { fetchFn, couperSynchro } = suivreSynchro();
    const sdk = new AbortController();
    await expect(fetchFn(URL_SYNC, { signal: sdk.signal })).resolves.toBe(reponse);
    couperSynchro();
    sdk.abort();
    expect(sdk.signal.aborted).toBe(true);
  });
});
