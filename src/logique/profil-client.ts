// F5 / F5bis — Profil client (page modèle 2 : profil + premier besoin). Sans écran, sans réseau.
// Le profil enregistré ne garde que pseudo et quartier ; le besoin part en demande (demande.ts).

import { LIMITES, erreurTexte, estObjet, lirePrix, texteSur } from './profil';

export type ProfilClient = { version: 1; role: 'client'; pseudo: string; zone: string };

export type SaisieProfilClient = {
  pseudo: string;
  zone: string;
  service: string;
  budget: string;
  texte: string;
};

export type ErreursProfilClient = Partial<Record<'pseudo' | 'zone', string>>;

export function verifierProfilClient(
  s: SaisieProfilClient,
): { ok: true; profil: ProfilClient } | { ok: false; erreurs: ErreursProfilClient } {
  const pseudo = s.pseudo.trim();
  const zone = s.zone.trim();
  const erreurs: ErreursProfilClient = {};
  const ePseudo = erreurTexte(pseudo, LIMITES.pseudo, 'Écris ton pseudo.');
  const eZone = erreurTexte(zone, LIMITES.zone, 'Choisis ton quartier.');
  if (ePseudo) erreurs.pseudo = ePseudo;
  if (eZone) erreurs.zone = eZone;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, profil: { version: 1, role: 'client', pseudo, zone } };
}

// Bouton SIA gris tant que c'est faux. Le texte est facultatif.
export function profilClientComplet(s: SaisieProfilClient): boolean {
  return (
    s.pseudo.trim() !== '' &&
    s.zone.trim() !== '' &&
    s.service.trim() !== '' &&
    lirePrix(s.budget) !== null
  );
}

export function nettoyerProfilClient(inconnu: unknown): ProfilClient | null {
  if (!estObjet(inconnu) || inconnu.version !== 1 || inconnu.role !== 'client') return null;
  const pseudo = texteSur(inconnu.pseudo, LIMITES.pseudo);
  const zone = texteSur(inconnu.zone, LIMITES.zone);
  if (pseudo === null || zone === null) return null;
  return { version: 1, role: 'client', pseudo, zone };
}
