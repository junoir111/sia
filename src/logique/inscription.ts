// F1 — Créer son compte : règles du formulaire d'inscription (sans écran, sans réseau).

import { codeValide } from './code-secret';

export type ChampInscription = 'identifiant' | 'codeSecret' | 'confirmation' | 'code' | 'majeur';

export type ValeursInscription = {
  identifiant: string;
  /**
   * Code secret à 4 chiffres. C'est à la fois le mot de passe du compte (pour se connecter) et le
   * verrou de l'appli (F12). Un seul secret à retenir ; le serveur freine les essais en rafale (429).
   */
  codeSecret: string;
  /** Le code retapé : évite une faute de frappe qui enfermerait dehors (le code ouvre tout le compte). */
  confirmation: string;
  /** Code d'invitation donné par la personne qui invite. */
  code: string;
  majeur: boolean;
};

export type ErreursInscription = Partial<Record<ChampInscription, string>>;

// Règle Matrix simplifiée : 3 à 30 signes, lettres a-z, chiffres, . _ -
const FORME_IDENTIFIANT = /^[a-z0-9._-]{3,30}$/;

export function normaliserIdentifiant(brut: string): string {
  return brut.trim().toLowerCase();
}

export function verifierInscription(v: ValeursInscription): ErreursInscription {
  const erreurs: ErreursInscription = {};
  if (!FORME_IDENTIFIANT.test(normaliserIdentifiant(v.identifiant))) {
    erreurs.identifiant = '3 à 30 signes : lettres, chiffres, . _ -';
  }
  if (!codeValide(v.codeSecret)) {
    erreurs.codeSecret = 'Ton code secret a 4 chiffres.';
  } else if (v.confirmation !== v.codeSecret) {
    erreurs.confirmation = 'Les deux codes ne sont pas pareils.';
  }
  if (v.code.trim() === '') {
    erreurs.code = "Écris ton code d'invitation.";
  }
  if (!v.majeur) {
    erreurs.majeur = 'SIA est réservé aux 18 ans et plus.';
  }
  return erreurs;
}

// F1 : le code d'invitation dit le rôle (P- prestataire, C- client). Le serveur vérifie le code en entier.
export type RoleCode = 'prestataire' | 'client' | null;

const FORME_CODE_AVEC_ROLE = /^([PC])-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function lireCodeInvitation(brut: string): { jeton: string; role: RoleCode } {
  const compact = brut.replace(/\s+/g, '').toUpperCase();
  const trouve = FORME_CODE_AVEC_ROLE.exec(compact);
  if (!trouve) {
    return { jeton: brut.trim(), role: null };
  }
  return { jeton: compact, role: trouve[1] === 'P' ? 'prestataire' : 'client' };
}

export function formulaireComplet(v: ValeursInscription): boolean {
  return (
    v.identifiant.trim() !== '' &&
    v.codeSecret !== '' &&
    v.confirmation !== '' &&
    v.code.trim() !== '' &&
    v.majeur
  );
}
