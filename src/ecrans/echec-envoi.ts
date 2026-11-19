/*
 * Quand un bouton d'envoi (SIA du prestataire, SIA du client) file vers l'écran suivant sans attendre le serveur, un
 * refus qui arrive ensuite doit se voir : le message et ce qui était tapé sont déposés ici, et la page du formulaire les
 * reprend, qu'elle soit déjà ouverte (refus très rapide) ou qu'on la rouvre. Mémoire seulement (rien sur le téléphone).
 * Chaque formulaire a sa propre boîte (`creerBoiteEchec`), avec sa propre forme de saisie.
 */
export type EchecEnvoi<T> = { message: string; saisie: T };

export type BoiteEchec<T> = {
  deposer: (echec: EchecEnvoi<T>) => void;
  /** Rend l'échec déposé, une seule fois ; null s'il n'y en a pas. */
  reprendre: () => EchecEnvoi<T> | null;
  /** Prévient quand un échec est déposé. Rend la fonction qui arrête d'écouter. */
  ecouter: (rappel: () => void) => () => void;
  /** Pour les tests : oublie l'échec déposé. */
  oublier: () => void;
};

export function creerBoiteEchec<T>(): BoiteEchec<T> {
  let depose: EchecEnvoi<T> | null = null;
  const ecouteurs = new Set<() => void>();
  return {
    deposer(echec) {
      depose = echec;
      for (const rappel of [...ecouteurs]) rappel();
    },
    reprendre() {
      const echec = depose;
      depose = null;
      return echec;
    },
    ecouter(rappel) {
      ecouteurs.add(rappel);
      return () => {
        ecouteurs.delete(rappel);
      };
    },
    oublier() {
      depose = null;
    },
  };
}
