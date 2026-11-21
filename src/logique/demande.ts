// F8 — Demande d'un client : vérification de la saisie et lecture sûre de l'événement io.sia.annonce
// (7-contrats-mise-en-relation.md). Sans écran, sans réseau.

import {
  CARACTERE_NON_AUTORISE,
  LIMITES,
  contientCaracterePiege,
  erreurTexte,
  estObjet,
  formaterPrix,
  lirePrix,
  texteSur,
} from './profil';
import type { SaisieProfilClient } from './profil-client';

export type DemandeClient = {
  pseudo: string;
  service: string;
  zone: string;
  texte: string;
  budget: number;
  fin: number;
};

// 24 h (2026-11-21) : une demande reste sur le Mur une journée, pour qu'un prestataire qui n'était pas
// disponible la retrouve en revenant plus tard (la notification, elle, s'efface avant). Le robot du serveur
// garde les messages du Mur 25 h : la demande tient donc dans cette fenêtre.
export const DUREE_DEMANDE_MS = 24 * 60 * 60_000;
export const TEXTE_DEMANDE_MAX = 140;
// Les horloges des téléphones ne sont pas parfaitement à l'heure.
export const TOLERANCE_HORLOGE_MS = 5 * 60_000;

export type ErreursDemande = Partial<
  Record<'pseudo' | 'zone' | 'service' | 'budget' | 'texte', string>
>;

export function verifierDemande(
  s: SaisieProfilClient,
  maintenant: number,
): { ok: true; demande: DemandeClient } | { ok: false; erreurs: ErreursDemande } {
  const pseudo = s.pseudo.trim();
  const zone = s.zone.trim();
  const service = s.service.trim();
  const texte = s.texte.trim();
  const budget = lirePrix(s.budget);

  const erreurs: ErreursDemande = {};
  const ePseudo = erreurTexte(pseudo, LIMITES.pseudo, 'Écris ton pseudo.');
  const eZone = erreurTexte(zone, LIMITES.zone, 'Choisis ton quartier.');
  const eService = erreurTexte(service, LIMITES.service, 'Dis de quoi tu as besoin.');
  if (ePseudo) erreurs.pseudo = ePseudo;
  if (eZone) erreurs.zone = eZone;
  if (eService) erreurs.service = eService;
  if (budget === null) erreurs.budget = 'Écris ton budget en FCFA.';
  if (contientCaracterePiege(texte)) erreurs.texte = CARACTERE_NON_AUTORISE;
  else if (texte.length > TEXTE_DEMANDE_MAX) erreurs.texte = `${TEXTE_DEMANDE_MAX} signes au plus.`;

  if (Object.keys(erreurs).length > 0 || budget === null) return { ok: false, erreurs };
  return {
    ok: true,
    demande: { pseudo, service, zone, texte, budget, fin: maintenant + DUREE_DEMANDE_MS },
  };
}

export function texteFacultatifSur(v: unknown, max: number): string | null {
  if (v === undefined) return '';
  if (typeof v !== 'string' || contientCaracterePiege(v)) return null;
  const t = v.trim();
  return t.length <= max ? t : null;
}

function entierEntre(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

// Garde une demande expirée (le tri se fait dans notification.ts ou l'affichage), mais refuse
// une fin plus lointaine que la durée de vie après « maintenant ». Le rôle peut manquer (demande gardée sur le
// téléphone) ; s'il est là, ce doit être « client ». Les annonces du Mur : passer par doitNotifier.
export function nettoyerDemande(
  inconnu: unknown,
  maintenant: number = Date.now(),
): DemandeClient | null {
  if (!estObjet(inconnu)) return null;
  if (inconnu.role !== undefined && inconnu.role !== 'client') return null;
  const pseudo = texteSur(inconnu.pseudo, LIMITES.pseudo);
  const service = texteSur(inconnu.service, LIMITES.service);
  const zone = texteSur(inconnu.zone, LIMITES.zone);
  const texte = texteFacultatifSur(inconnu.texte, TEXTE_DEMANDE_MAX);
  const budget = entierEntre(inconnu.budget, 1, LIMITES.prixMax);
  const fin = entierEntre(inconnu.fin, 0, maintenant + DUREE_DEMANDE_MS + TOLERANCE_HORLOGE_MS);
  if (pseudo === null || service === null || zone === null || texte === null) return null;
  if (budget === null || fin === null) return null;
  return { pseudo, service, zone, texte, budget, fin };
}

export function texteBandeau(d: DemandeClient): string {
  return `${d.pseudo} · ${d.zone} · ${formaterPrix(d.budget)} FCFA · ${d.service}`;
}
