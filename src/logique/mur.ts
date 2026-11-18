// F7 — Le Mur : règles pures (sans écran, sans réseau). Contrat : projet/8-contrats-mur.md.

import { formaterPrix, type Modalite } from './profil';

export type EntreeStatut = {
  eventId: string;
  userId: string;
  pseudo: string;
  metier: string;
  zone: string;
  fin: number;
  modalite?: Modalite;
};

export type EntreeDemande = {
  eventId: string;
  userId: string;
  pseudo: string;
  service: string;
  zone: string;
  texte: string;
  budget: number;
  fin: number;
  creeLe: number;
};

export type TuileMur = { metier: string; dispo: number };

export type OptionsMur = { quartier?: string; recherche?: string; maintenant: number };

// « Électricien » et « electricien » donnent la même clé.
export function cleTexte(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const estActif = (fin: number, maintenant: number): boolean => fin > maintenant;

// Un quartier vide (ou d'espaces) ne filtre rien ; sinon la zone doit le contenir (filtre « en tapant »).
function dansQuartier(zone: string, quartier: string | undefined): boolean {
  const cle = cleTexte(quartier ?? '');
  return cle === '' || cleTexte(zone).includes(cle);
}

// Le Mur ne montre que les prestataires disponibles : une case par métier ayant au moins un prestataire actif.
export function grilleMur(statuts: readonly EntreeStatut[], options: OptionsMur): TuileMur[] {
  const { quartier, recherche, maintenant } = options;
  const tuiles = new Map<string, TuileMur>(); // l'ordre d'insertion = ordre d'arrivée
  for (const s of statuts) {
    if (!estActif(s.fin, maintenant) || !dansQuartier(s.zone, quartier)) continue;
    const cle = cleTexte(s.metier);
    if (cle === '') continue;
    const tuile = tuiles.get(cle);
    if (tuile) tuile.dispo += 1;
    else tuiles.set(cle, { metier: s.metier.trim(), dispo: 1 });
  }
  const cleRecherche = cleTexte(recherche ?? '');
  return [...tuiles.entries()]
    .filter(([cle]) => cle.includes(cleRecherche))
    .map(([, t]) => t)
    .sort((a, b) => b.dispo - a.dispo); // tri stable
}

export function listeMetier(
  statuts: readonly EntreeStatut[],
  metier: string,
  quartier: string | undefined,
  maintenant: number,
): EntreeStatut[] {
  const cle = cleTexte(metier);
  return statuts
    .filter(
      (s) =>
        estActif(s.fin, maintenant) && cleTexte(s.metier) === cle && dansQuartier(s.zone, quartier),
    )
    .sort((a, b) => b.fin - a.fin);
}

export function libelleModalite(m: Modalite): string {
  if (m === 'recoit') return 'Reçoit sur place';
  if (m === 'deplace') return 'Se déplace';
  return 'Reçoit et se déplace';
}

// Prix indicatif d'un service ; un nombre invalide ou négatif ne donne rien à afficher.
export function prixIndicatif(prix: number): string {
  if (!Number.isFinite(prix) || prix < 1) return '';
  return `à partir de ${formaterPrix(Math.round(prix))} FCFA`;
}
