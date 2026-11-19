import { Capacitor, registerPlugin } from '@capacitor/core';

/*
 * Pont vers le petit plugin Android « SiaPush » (Firebase Cloud Messaging).
 * Absent dans le navigateur : `pushNatif()` rend alors null et rien ne se passe.
 */

/** `indisponible` : pas de services Google sur ce téléphone, ou Firebase non configuré dans cette version. */
export type StatutActivation = 'ok' | 'indisponible' | 'autorisation-refusee';

export type EtatPushNatif = {
  /** Jeton de notification déjà reçu de Google, ou null. */
  jeton: string | null;
  disponible: boolean;
};

export type PushNatif = {
  etat(): Promise<EtatPushNatif>;
  activer(): Promise<{ statut: StatutActivation }>;
  desactiver(): Promise<void>;
  addListener(
    evenement: 'jeton',
    action: (donnees: { jeton: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    evenement: 'echec',
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
