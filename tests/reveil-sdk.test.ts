import { describe, expect, it, vi } from 'vitest';
import { ClientEvent, SyncState, createClient } from 'matrix-js-sdk';
import { suivreSynchro } from '../src/matrix/reveil';

/*
 * Le VRAI client Matrix (matrix-js-sdk), seulement le réseau est simulé : vérifie ce dont le réveil rapide dépend
 * dans le SDK. Une longue requête /sync « morte » (aucune réponse, aucune erreur) n'est PAS vue par retryImmediately ;
 * une fois coupée par suivreSynchro, le SDK passe en reprise et retryImmediately le fait repartir aussitôt,
 * au lieu d'attendre 2 à 7 s (reprise toute seule) ou 110 s (délai de la requête morte).
 */

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

describe('réveil rapide avec le vrai client Matrix', () => {
  it('couper la longue requête /sync morte puis relancer : le client repart tout de suite', async () => {
    let nbSync = 0;
    const reseau = vi.fn((requete: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
      const chemin = new URL(
        typeof requete === 'string' ? requete : requete instanceof URL ? requete.href : requete.url,
      ).pathname;
      if (chemin.endsWith('/sync')) {
        nbSync += 1;
        if (nbSync === 1) return Promise.resolve(json({ next_batch: 's1' }));
        if (nbSync === 2) {
          // Connexion morte : ni réponse ni erreur, sauf si on coupe la requête.
          return new Promise<Response>((_, rejeter) => {
            options?.signal?.addEventListener('abort', () =>
              rejeter(new DOMException('coupée', 'AbortError')),
            );
          });
        }
        // Les suivantes imitent une vraie longue requête : elles répondent après un moment.
        return new Promise<Response>((fini) =>
          setTimeout(() => fini(json({ next_batch: 's3' })), 300),
        );
      }
      if (chemin.endsWith('/pushrules/')) return Promise.resolve(json({ global: {} }));
      if (chemin.endsWith('/filter')) return Promise.resolve(json({ filter_id: 'f1' }));
      if (chemin.endsWith('/versions')) return Promise.resolve(json({ versions: ['v1.1'] }));
      return Promise.resolve(json({ errcode: 'M_NOT_FOUND', error: 'inconnu' }, 404));
    });
    vi.stubGlobal('fetch', reseau);
    const suivi = suivreSynchro();
    const c = createClient({
      baseUrl: 'https://sia.tail94dc60.ts.net',
      accessToken: 'jeton',
      userId: '@moi:sia.tail94dc60.ts.net',
      deviceId: 'APP',
      fetchFn: suivi.fetchFn,
    });
    const etats: SyncState[] = [];
    c.on(ClientEvent.Sync, (etat: SyncState) => etats.push(etat));
    try {
      await c.startClient({ initialSyncLimit: 1 });
      await vi.waitFor(() => expect(nbSync).toBe(2), { timeout: 5000 });
      expect(c.getSyncState()).toBe(SyncState.Syncing);
      // Requête morte : pour le SDK tout va bien, il n'y a rien à relancer.
      expect(c.retryImmediately()).toBe(false);

      const depart = Date.now();
      suivi.couperSynchro();
      await vi.waitFor(() => expect(c.getSyncState()).toBe(SyncState.Reconnecting), {
        timeout: 5000,
      });
      expect(c.retryImmediately()).toBe(true);
      await vi.waitFor(() => expect(nbSync).toBeGreaterThanOrEqual(3), { timeout: 5000 });
      // Sans retryImmediately, le SDK attend au moins 2 s avant de réessayer.
      expect(Date.now() - depart).toBeLessThan(1900);
      expect(etats).toContain(SyncState.Reconnecting);
    } finally {
      c.stopClient();
      vi.unstubAllGlobals();
    }
  }, 20_000);
});
