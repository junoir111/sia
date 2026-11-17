/*
 * Demandes déjà montrées (et répondues) sur ce téléphone : identifiants d'événements seulement,
 * jamais de contenu. Gardées dans localStorage « sia.vues » pour ne pas reproposer après un redémarrage.
 */

const CLE_STOCKAGE = 'sia.vues';
/** Au-delà, les plus anciennes sont oubliées (une demande vit 2 h). */
const NOMBRE_MAX = 200;
const ID_MAX = 255;

function estId(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('$') && v.length <= ID_MAX;
}

export function lireVues(): Set<string> {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    const donnees: unknown = brut === null ? [] : JSON.parse(brut);
    return new Set(Array.isArray(donnees) ? donnees.filter(estId).slice(-NOMBRE_MAX) : []);
  } catch {
    return new Set();
  }
}

/** Rend un nouvel ensemble avec `eventId` en plus, et l'enregistre. */
export function ajouterVue(vues: ReadonlySet<string>, eventId: string): Set<string> {
  const suite = new Set([...vues, eventId]);
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify([...suite].slice(-NOMBRE_MAX)));
  } catch {
    // Stockage plein ou interdit : on se souvient au moins jusqu'à la fermeture de l'appli.
  }
  return suite;
}
