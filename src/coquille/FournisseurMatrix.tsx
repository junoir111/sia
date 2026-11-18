import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { MatrixClient } from 'matrix-js-sdk';
import { CHEMINS } from '../chemins';
import type { Session } from '../matrix/auth';
import { arreterClient, demarrerClient } from '../matrix/client';
import { nettoyerMesAnnonces, rejoindreMur } from '../matrix/mur';
import { lancerNotifications } from '../matrix/notifications';
import { effacerSession, lireSession } from '../matrix/session';

/*
 * Coquille de l'appli : démarre UN client Matrix dès qu'une session existe, rejoint le Mur
 * (et efface mes annonces expirées),
 * et le donne à tous les écrans par useMatrix(). Jeton refusé → session effacée, retour à l'accueil.
 */

export type EtatMatrix = 'demarrage' | 'pret' | 'erreur-session' | 'erreur-reseau';
export type ValeurMatrix = { client: MatrixClient | null; etat: EtatMatrix };

const AU_DEPART: ValeurMatrix = { client: null, etat: 'demarrage' };
/** Attentes entre deux reprises du démarrage après un échec passager (la dernière se répète). */
export const DELAIS_REPRISE_MS = [2_000, 5_000, 10_000, 20_000] as const;
const ContexteMatrix = createContext<ValeurMatrix>(AU_DEPART);

/** Client Matrix partagé et son état. `client` n'est non nul que si `etat === 'pret'`. */
export function useMatrix(): ValeurMatrix {
  return useContext(ContexteMatrix);
}

function estJetonRefuse(erreur: unknown): boolean {
  return (
    typeof erreur === 'object' &&
    erreur !== null &&
    (erreur as { errcode?: unknown }).errcode === 'M_UNKNOWN_TOKEN'
  );
}

async function demarrer(session: Session): Promise<MatrixClient> {
  const client = await demarrerClient(session);
  await rejoindreMur(client);
  // Ménage de mes annonces expirées : ne bloque pas l'ouverture, retenté à la prochaine.
  nettoyerMesAnnonces(client).catch(() => undefined);
  // Notifications (Android seulement) : ne bloque pas l'ouverture, ne rejette jamais.
  void lancerNotifications(client);
  return client;
}

type Etat = ValeurMatrix & { cle: string | null };

export function FournisseurMatrix({ children }: { children: ReactNode }) {
  // Relu à chaque changement d'écran : une connexion ou une déconnexion est vue tout de suite.
  useLocation();
  const session = lireSession();
  const cle = session ? `${session.userId}|${session.deviceId}` : null;
  const [etat, setEtat] = useState<Etat>({ cle: null, ...AU_DEPART });
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  });

  useEffect(() => {
    const courante = lireSession();
    if (cle === null || !courante) return;
    let enCours = true;
    let essai = 0;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    // Échec passager (réseau, serveur occupé) : on réessaie tout seul, de plus en plus lentement.
    const relancer = (): void => {
      clearTimeout(minuterie);
      if (enCours) lancer();
    };
    const lancer = (): void => {
      demarrer(courante).then(
        (client) => {
          if (enCours) setEtat({ cle, client, etat: 'pret' });
        },
        (erreur: unknown) => {
          if (!enCours) return;
          if (estJetonRefuse(erreur)) {
            arreterClient();
            effacerSession();
            // Session effacée : l'état est rangé sous « pas de session » (cle null).
            setEtat({ cle: null, client: null, etat: 'erreur-session' });
            navigateRef.current(CHEMINS.accueil, { replace: true });
            return;
          }
          setEtat({ cle, client: null, etat: 'erreur-reseau' });
          const delai = DELAIS_REPRISE_MS[Math.min(essai, DELAIS_REPRISE_MS.length - 1)];
          essai += 1;
          minuterie = setTimeout(relancer, delai);
        },
      );
    };
    lancer();
    window.addEventListener('online', relancer);
    return () => {
      enCours = false;
      clearTimeout(minuterie);
      window.removeEventListener('online', relancer);
      arreterClient();
    };
  }, [cle]);

  const valeur: ValeurMatrix =
    etat.cle === cle ? { client: etat.client, etat: etat.etat } : AU_DEPART;
  return <ContexteMatrix.Provider value={valeur}>{children}</ContexteMatrix.Provider>;
}
