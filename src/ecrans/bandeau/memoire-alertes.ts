import { estIdSalon } from '../../matrix/evenements';

/*
 * Mémoire des alertes de bulle (« X a accepté », « Nouveau message de X »), gardée sur ce téléphone dans
 * localStorage « sia.alertes » : des identifiants de bulles et des nombres, jamais le texte d'un message.
 * Elle sert à ne jamais remontrer une alerte déjà traitée après un rechargement, et à retrouver celles
 * qui attendent encore quand Android a fermé l'appli entre-temps. Effacée à la déconnexion (auth.ts).
 */

const CLE_STOCKAGE = 'sia.alertes';
/** Au-delà, les bulles les plus anciennes sont oubliées (dans chaque table). */
const NOMBRE_MAX = 100;
/** Garde-fou : un nombre de messages non lus plus grand n'est pas cru. */
const NON_LUS_MAX = 10_000;

/**
 * - `attente` : la bulle a été vue « en attente » de l'autre ; si elle s'ouvre, on le dira une fois.
 * - `dite` : son ouverture est déjà dite (ou vue de l'intérieur) ; plus jamais.
 */
export type Ouverture = 'attente' | 'dite';

export type MemoireAlertes = {
  ouvertures: Readonly<Record<string, Ouverture>>;
  /** Messages non lus déjà connus, par bulle (montrés ou illisibles) : on n'alerte qu'au-delà. */
  messages: Readonly<Record<string, number>>;
};

export const MEMOIRE_VIDE: MemoireAlertes = { ouvertures: {}, messages: {} };

function estOuverture(v: unknown): v is Ouverture {
  return v === 'attente' || v === 'dite';
}

function estNombreDeNonLus(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= NON_LUS_MAX;
}

/** Table lue sur le téléphone : seules les clés de salon et les valeurs voulues sont gardées. */
function tableSure<T>(brut: unknown, valide: (v: unknown) => v is T): Record<string, T> {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return {};
  const gardees = Object.entries(brut).filter(
    (entree): entree is [string, T] => estIdSalon(entree[0]) && valide(entree[1]),
  );
  return Object.fromEntries(gardees.slice(-NOMBRE_MAX));
}

export function lireMemoire(): MemoireAlertes {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (brut === null) return MEMOIRE_VIDE;
    const donnees: unknown = JSON.parse(brut);
    if (typeof donnees !== 'object' || donnees === null || Array.isArray(donnees)) {
      return MEMOIRE_VIDE;
    }
    const { ouvertures, messages } = donnees as Record<string, unknown>;
    return {
      ouvertures: tableSure(ouvertures, estOuverture),
      messages: tableSure(messages, estNombreDeNonLus),
    };
  } catch {
    return MEMOIRE_VIDE;
  }
}

export function ecrireMemoire(memoire: MemoireAlertes): void {
  try {
    const vide =
      Object.keys(memoire.ouvertures).length === 0 && Object.keys(memoire.messages).length === 0;
    if (vide) localStorage.removeItem(CLE_STOCKAGE);
    else localStorage.setItem(CLE_STOCKAGE, JSON.stringify(memoire));
  } catch {
    // Stockage plein ou interdit : on se souvient au moins jusqu'à la fermeture de l'appli.
  }
}

/** Nouvelle table avec `cle` en dernier (la plus récente) ; `null` la retire. */
function avecEntree<T>(
  table: Readonly<Record<string, T>>,
  cle: string,
  valeur: T | null,
): Record<string, T> {
  const autres = Object.entries(table).filter(([k]) => k !== cle);
  const suite = valeur === null ? autres : [...autres, [cle, valeur] as [string, T]];
  return Object.fromEntries(suite.slice(-NOMBRE_MAX));
}

/** Même mémoire (même objet) si rien ne change ; `null` retire la bulle. */
export function avecOuverture(
  memoire: MemoireAlertes,
  roomId: string,
  ouverture: Ouverture | null,
): MemoireAlertes {
  if ((memoire.ouvertures[roomId] ?? null) === ouverture) return memoire;
  return { ...memoire, ouvertures: avecEntree(memoire.ouvertures, roomId, ouverture) };
}

/** Même mémoire (même objet) si rien ne change ; zéro retire la bulle. */
export function avecNonLus(
  memoire: MemoireAlertes,
  roomId: string,
  nombre: number,
): MemoireAlertes {
  const valeur = nombre > 0 ? Math.min(nombre, NON_LUS_MAX) : null;
  if ((memoire.messages[roomId] ?? null) === valeur) return memoire;
  return { ...memoire, messages: avecEntree(memoire.messages, roomId, valeur) };
}
