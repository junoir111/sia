/*
 * Range les erreurs du réseau Matrix en trois familles montrées à l'écran
 * (contrats : projet/7-contrats-mise-en-relation.md). Le client Matrix vient de useMatrix().
 */

export type ErreurReseau = 'session' | 'reseau' | 'inconnue';

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Range une erreur de matrix-js-sdk dans l'une des trois familles montrées à l'écran. */
export function familleErreur(e: unknown): ErreurReseau {
  if (!estObjet(e)) return 'inconnue';
  if (e.errcode === 'M_UNKNOWN_TOKEN') return 'session';
  if (e.name === 'ConnectionError' || e.name === 'TimeoutError' || e instanceof TypeError) {
    return 'reseau';
  }
  if (typeof e.httpStatus === 'number' && [502, 503, 504].includes(e.httpStatus)) return 'reseau';
  return 'inconnue';
}
