// F8 — Faut-il montrer le bandeau d'une demande ? (appli ouverte seulement). Sans écran, sans réseau.

import { nettoyerDemande } from './demande';

export type AnnonceRecue = { eventId: string; expediteur: string; contenu: unknown };
export type ContexteNotification = {
  moi: string;
  disponible: boolean;
  dejaVues: ReadonlySet<string>;
  maintenant: number;
};

// Demande de client valide, pas la mienne, pas expirée, je suis disponible, pas déjà vue.
// Tous les prestataires disponibles la reçoivent, quel que soit le quartier ou le métier.
export function doitNotifier(annonce: AnnonceRecue, c: ContexteNotification): boolean {
  if (!c.disponible || annonce.expediteur === c.moi || c.dejaVues.has(annonce.eventId))
    return false;
  const contenu = annonce.contenu;
  if (typeof contenu !== 'object' || contenu === null || !('role' in contenu)) return false;
  if (contenu.role !== 'client') return false;
  const demande = nettoyerDemande(contenu, c.maintenant);
  return demande !== null && demande.fin > c.maintenant;
}
