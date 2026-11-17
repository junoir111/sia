// F4 — Profil prestataire : règles du formulaire et lecture sûre du profil venu du serveur
// (sans écran, sans réseau). Schéma : donnée de compte io.sia.profile (5-schema-backend.md §2 PROFIL).

export type Modalite = 'recoit' | 'deplace' | 'les-deux';
export type Service = { label: string; prix: number };
export type ProfilPrestataire = {
  version: 1;
  role: 'prestataire';
  pseudo: string;
  metier: string;
  zone: string;
  modalite: Modalite;
  services: Service[];
};

export const LIMITES: {
  pseudo: 30;
  metier: 40;
  zone: 40;
  service: 40;
  servicesMax: 3;
  prixMax: 100000000;
} = {
  pseudo: 30,
  metier: 40,
  zone: 40,
  service: 40,
  servicesMax: 3,
  prixMax: 100000000,
};

const MODALITES: readonly Modalite[] = ['recoit', 'deplace', 'les-deux'];

// '@mangue-douce:sia.tail94dc60.ts.net' -> 'mangue-douce'
export function pseudoPropose(userId: string): string {
  const trouve = /^@([^:\s]+):\S+$/.exec(userId);
  return trouve?.[1]?.slice(0, LIMITES.pseudo) ?? '';
}

export function modaliteDepuisChoix(recoit: boolean, deplace: boolean): Modalite | null {
  if (recoit && deplace) return 'les-deux';
  if (recoit) return 'recoit';
  if (deplace) return 'deplace';
  return null;
}

export function choixDepuisModalite(m: Modalite | null): { recoit: boolean; deplace: boolean } {
  return {
    recoit: m === 'recoit' || m === 'les-deux',
    deplace: m === 'deplace' || m === 'les-deux',
  };
}

// Chiffres seuls, ou groupés par 3 avec espace, point ou virgule ; « FCFA » facultatif à la fin.
const FORME_PRIX = /^(\d+|\d{1,3}([ .,]\d{3})+)$/;

export function lirePrix(brut: string): number | null {
  const texte = brut
    .replace(/\s/g, ' ')
    .trim()
    .replace(/\s*fcfa$/i, '');
  if (!FORME_PRIX.test(texte)) return null;
  const prix = Number(texte.replace(/[ .,]/g, ''));
  return prix >= 1 && prix <= LIMITES.prixMax ? prix : null;
}

export function formaterPrix(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export type LigneService = { label: string; prix: string };
export type SaisieProfil = {
  pseudo: string;
  metier: string;
  zone: string;
  recoit: boolean;
  deplace: boolean;
  services: LigneService[];
};
export type ErreursProfil = Partial<
  Record<'pseudo' | 'metier' | 'zone' | 'modalite' | 'services', string>
>;

export const CARACTERE_NON_AUTORISE = 'Caractère non autorisé.';

export function erreurTexte(valeur: string, max: number, vide: string): string | undefined {
  if (valeur === '') return vide;
  if (contientCaracterePiege(valeur)) return CARACTERE_NON_AUTORISE;
  if (valeur.length > max) return `${max} signes au plus.`;
  return undefined;
}

function lireServices(lignes: LigneService[]): { services: Service[] } | { erreur: string } {
  const remplies = lignes
    .map((l) => ({ label: l.label.trim(), prix: l.prix.trim() }))
    .filter((l) => l.label !== '' || l.prix !== '');
  if (remplies.length > LIMITES.servicesMax) {
    return { erreur: `${LIMITES.servicesMax} services au plus.` };
  }
  const services: Service[] = [];
  for (const ligne of remplies) {
    if (ligne.label === '') return { erreur: 'Donne un nom à chaque service.' };
    if (contientCaracterePiege(ligne.label)) return { erreur: CARACTERE_NON_AUTORISE };
    if (ligne.label.length > LIMITES.service) {
      return { erreur: `Nom de service : ${LIMITES.service} signes au plus.` };
    }
    const prix = lirePrix(ligne.prix);
    if (prix === null) return { erreur: 'Écris un prix en FCFA pour chaque service.' };
    services.push({ label: ligne.label, prix });
  }
  return { services };
}

export function verifierProfil(
  s: SaisieProfil,
): { ok: true; profil: ProfilPrestataire } | { ok: false; erreurs: ErreursProfil } {
  const pseudo = s.pseudo.trim();
  const metier = s.metier.trim();
  const zone = s.zone.trim();
  const modalite = modaliteDepuisChoix(s.recoit, s.deplace);
  const services = lireServices(s.services);

  const erreurs: ErreursProfil = {};
  const ePseudo = erreurTexte(pseudo, LIMITES.pseudo, 'Écris ton pseudo.');
  const eMetier = erreurTexte(metier, LIMITES.metier, 'Écris ton métier.');
  const eZone = erreurTexte(zone, LIMITES.zone, 'Choisis ton quartier.');
  if (ePseudo) erreurs.pseudo = ePseudo;
  if (eMetier) erreurs.metier = eMetier;
  if (eZone) erreurs.zone = eZone;
  if (modalite === null) erreurs.modalite = 'Dis comment tu travailles.';
  if ('erreur' in services) erreurs.services = services.erreur;

  if (Object.keys(erreurs).length > 0 || modalite === null || 'erreur' in services) {
    return { ok: false, erreurs };
  }
  return {
    ok: true,
    profil: {
      version: 1,
      role: 'prestataire',
      pseudo,
      metier,
      zone,
      modalite,
      services: services.services,
    },
  };
}

export function profilComplet(s: SaisieProfil): boolean {
  return (
    s.pseudo.trim() !== '' &&
    s.metier.trim() !== '' &&
    s.zone.trim() !== '' &&
    (s.recoit || s.deplace)
  );
}

// --- Lecture des données venues du serveur : on ne fait confiance à rien. ---

export function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Caractères de contrôle, invisibles ou d'inversion de sens : ils peuvent tromper l'affichage
// (un pseudo qui s'affiche à l'envers, par exemple). Un texte qui en contient est refusé, pas réparé.
// Aussi les remplissages qui s'affichent vides (coreen, braille, mongol) : sinon un pseudo
// peut paraitre vide ou devenir le faux double d'un autre.
const CARACTERE_PIEGE =
  // eslint-disable-next-line no-control-regex, no-misleading-character-class -- chercher ces caractères est le but
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\u2800\u3164\uFEFF\uFFA0]/;

export function contientCaracterePiege(t: string): boolean {
  return CARACTERE_PIEGE.test(t);
}

export function texteSur(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || contientCaracterePiege(v)) return null;
  const t = v.trim();
  return t !== '' && t.length <= max ? t : null;
}

function serviceSur(v: unknown): Service | null {
  if (!estObjet(v)) return null;
  const label = texteSur(v.label, LIMITES.service);
  const prix = v.prix;
  if (label === null || typeof prix !== 'number' || !Number.isInteger(prix)) return null;
  return prix >= 1 && prix <= LIMITES.prixMax ? { label, prix } : null;
}

export function nettoyerProfil(inconnu: unknown): ProfilPrestataire | null {
  if (!estObjet(inconnu) || inconnu.version !== 1 || inconnu.role !== 'prestataire') return null;
  const pseudo = texteSur(inconnu.pseudo, LIMITES.pseudo);
  const metier = texteSur(inconnu.metier, LIMITES.metier);
  const zone = texteSur(inconnu.zone, LIMITES.zone);
  const modalite = MODALITES.find((m) => m === inconnu.modalite);
  const brut = inconnu.services;
  if (pseudo === null || metier === null || zone === null || modalite === undefined) return null;
  if (!Array.isArray(brut) || brut.length > LIMITES.servicesMax) return null;
  const services = brut.map(serviceSur).filter((x): x is Service => x !== null);
  if (services.length !== brut.length) return null;
  return { version: 1, role: 'prestataire', pseudo, metier, zone, modalite, services };
}
