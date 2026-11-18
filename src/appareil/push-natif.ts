import { Capacitor, registerPlugin } from '@capacitor/core';

/*
 * Pont vers le petit plugin Android « SiaPush » (UnifiedPush, sans Firebase).
 * Absent dans le navigateur : `pushNatif()` rend alors null et rien ne se passe.
 */

export type StatutActivation = 'ok' | 'sans-distributeur' | 'autorisation-refusee';

export type EtatPushNatif = {
  distributeurs: string[];
  distributeur: string | null;
  endpoint: string | null;
};

export type PushNatif = {
  etat(): Promise<EtatPushNatif>;
  activer(): Promise<{ statut: StatutActivation }>;
  desactiver(): Promise<void>;
  addListener(
    evenement: 'endpoint',
    action: (donnees: { endpoint: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    evenement: 'desinscrit' | 'echec',
    action: () => void,
  ): Promise<{ remove: () => Promise<void> }>;
};

const plugin = registerPlugin<PushNatif>('SiaPush');

/** Le plugin Android, ou null (navigateur, aperçu du PC). */
export function pushNatif(): PushNatif | null {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SiaPush') ? plugin : null;
  } catch {
    return null;
  }
}
