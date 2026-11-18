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

export type TuileMur = { metier: string; dispo: number; demandes: number; vide: boolean };

export type OptionsMur = { quartier?: string; recherche?: string; maintenant: number };

export const METIERS_DE_BASE: readonly string[] = [
  'Plombier',
  'Électricien',
  'Coiffeuse',
  'Maçon',
  'Mécanicien',
  'Couturière',
  'Menuisier',
  'Peintre',
];

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

export function grilleMur(
  statuts: readonly EntreeStatut[],
  demandes: readonly EntreeDemande[],
  options: OptionsMur,
): TuileMur[] {
  const { quartier, recherche, maintenant } = options;
  // clé -> tuile ; l'ordre d'insertion = métiers de base puis métiers rencontrés.
  const tuiles = new Map<string, { metier: string; dispo: number; demandes: number }>();
  for (const metier of METIERS_DE_BASE) {
    tuiles.set(cleTexte(metier), { metier, dispo: 0, demandes: 0 });
  }
  const tuilePour = (metier: string) => {
    const cle = cleTexte(metier);
    if (cle === '') return null;
    let tuile = tuiles.get(cle);
    if (!tuile) {
      tuile = { metier: metier.trim(), dispo: 0, demandes: 0 };
      tuiles.set(cle, tuile);
    }
    return tuile;
  };

  for (const s of statuts) {
    if (!estActif(s.fin, maintenant) || !dansQuartier(s.zone, quartier)) continue;
    const t = tuilePour(s.metier);
    if (t) t.dispo += 1;
  }
  for (const d of demandes) {
    if (!estActif(d.fin, maintenant) || !dansQuartier(d.zone, quartier)) continue;
    const t = tuilePour(d.service);
    if (t) t.demandes += 1;
  }

  const cleRecherche = cleTexte(recherche ?? '');
  return [...tuiles.entries()]
    .filter(([cle]) => cle.includes(cleRecherche))
    .map(([, t]) => ({ ...t, vide: t.dispo === 0 && t.demandes === 0 }))
    .sort((a, b) => b.dispo + b.demandes - (a.dispo + a.demandes)); // tri stable : ordre d'origine à égalité
}

export function phraseMur(
  demandes: readonly EntreeDemande[],
  quartier: string | undefined,
  maintenant: number,
): string {
  const n = demandes.filter(
    (d) => estActif(d.fin, maintenant) && dansQuartier(d.zone, quartier),
  ).length;
  if (n === 0) return 'Personne ne cherche pour l’instant.';
  const lieu = (quartier ?? '').trim();
  const sujet = n === 1 ? '1 client cherche' : `${n} clients cherchent`;
  return lieu === '' ? `${sujet} quelqu’un en ce moment` : `${sujet} à ${lieu}`;
}

export function listeMetier(
  statuts: readonly EntreeStatut[],
  demandes: readonly EntreeDemande[],
  metier: string,
  quartier: string | undefined,
  maintenant: number,
): { prestataires: EntreeStatut[]; demandes: EntreeDemande[] } {
  const cle = cleTexte(metier);
  return {
    prestataires: statuts
      .filter(
        (s) =>
          estActif(s.fin, maintenant) &&
          cleTexte(s.metier) === cle &&
          dansQuartier(s.zone, quartier),
      )
      .sort((a, b) => b.fin - a.fin),
    demandes: demandes
      .filter(
        (d) =>
          estActif(d.fin, maintenant) &&
          cleTexte(d.service) === cle &&
          dansQuartier(d.zone, quartier),
      )
      .sort((a, b) => b.creeLe - a.creeLe),
  };
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
