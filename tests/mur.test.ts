import { describe, expect, it } from 'vitest';
import {
  METIERS_DE_BASE,
  cleTexte,
  grilleMur,
  libelleModalite,
  listeMetier,
  phraseMur,
  prixIndicatif,
  type EntreeDemande,
  type EntreeStatut,
} from '../src/logique/mur';

const MAINTENANT = 1_000_000;
const FUTUR = MAINTENANT + 60_000;
const PASSE = MAINTENANT - 1;

function statut(p: Partial<EntreeStatut> = {}): EntreeStatut {
  return {
    eventId: '$s1',
    userId: '@a:sia',
    pseudo: 'a',
    metier: 'Plombier',
    zone: 'Akanda',
    fin: FUTUR,
    ...p,
  };
}
function demande(p: Partial<EntreeDemande> = {}): EntreeDemande {
  return {
    eventId: '$d1',
    userId: '@c:sia',
    pseudo: 'c',
    service: 'Plombier',
    zone: 'Akanda',
    texte: '',
    budget: 5000,
    fin: FUTUR,
    creeLe: 10,
    ...p,
  };
}
function tuile(grille: ReturnType<typeof grilleMur>, metier: string) {
  return grille.find((t) => cleTexte(t.metier) === cleTexte(metier));
}

describe('cleTexte', () => {
  it('met en minuscules, enlève les accents et réduit les espaces', () => {
    expect(cleTexte('  Électricien ')).toBe('electricien');
    expect(cleTexte('Couturière   de  luxe')).toBe('couturiere de luxe');
    expect(cleTexte('')).toBe('');
  });
});

describe('METIERS_DE_BASE', () => {
  it('contient les 8 métiers du contrat', () => {
    expect(METIERS_DE_BASE).toEqual([
      'Plombier',
      'Électricien',
      'Coiffeuse',
      'Maçon',
      'Mécanicien',
      'Couturière',
      'Menuisier',
      'Peintre',
    ]);
  });
});

describe('grilleMur', () => {
  it('sans rien : les 8 métiers de base, tous vides, à zéro', () => {
    const g = grilleMur([], [], { maintenant: MAINTENANT });
    expect(g).toHaveLength(8);
    for (const t of g) expect(t).toMatchObject({ dispo: 0, demandes: 0, vide: true });
  });

  it('compte les prestataires et les demandes par métier', () => {
    const g = grilleMur([statut(), statut({ eventId: '$s2', userId: '@b:sia' })], [demande()], {
      maintenant: MAINTENANT,
    });
    expect(tuile(g, 'Plombier')).toMatchObject({ dispo: 2, demandes: 1, vide: false });
    expect(tuile(g, 'Peintre')?.vide).toBe(true);
  });

  it('ignore les entrées expirées (fin <= maintenant)', () => {
    const g = grilleMur(
      [statut({ fin: PASSE }), statut({ eventId: '$s2', fin: MAINTENANT })],
      [demande({ fin: PASSE })],
      { maintenant: MAINTENANT },
    );
    expect(tuile(g, 'Plombier')).toMatchObject({ dispo: 0, demandes: 0, vide: true });
  });

  it('un métier expiré seul n’ajoute pas de case', () => {
    const g = grilleMur([statut({ metier: 'Soudeur', fin: PASSE })], [], {
      maintenant: MAINTENANT,
    });
    expect(g).toHaveLength(8);
  });

  it('ajoute les métiers rencontrés, sans doublon malgré accents et majuscules', () => {
    const g = grilleMur(
      [
        statut({ metier: 'Soudeur' }),
        statut({ eventId: '$s2', metier: 'electricien' }),
        statut({ eventId: '$s3', metier: 'ÉLECTRICIEN' }),
      ],
      [demande({ service: 'soudeur' })],
      { maintenant: MAINTENANT },
    );
    expect(g).toHaveLength(9);
    expect(tuile(g, 'Soudeur')).toMatchObject({ dispo: 1, demandes: 1 });
    const elec = g.filter((t) => cleTexte(t.metier) === 'electricien');
    expect(elec).toHaveLength(1);
    expect(elec[0]).toMatchObject({ metier: 'Électricien', dispo: 2 });
  });

  it('filtre par quartier, sans tenir compte des accents ni des majuscules', () => {
    const g = grilleMur(
      [statut({ zone: 'Akanda' }), statut({ eventId: '$s2', zone: 'Owendo' })],
      [demande({ zone: 'Owendo' })],
      { maintenant: MAINTENANT, quartier: 'akanda' },
    );
    expect(tuile(g, 'Plombier')).toMatchObject({ dispo: 1, demandes: 0 });
    const g2 = grilleMur([statut({ zone: 'Nzeng-Ayong' })], [], {
      maintenant: MAINTENANT,
      quartier: 'NZENG',
    });
    expect(tuile(g2, 'Plombier')?.dispo).toBe(1);
  });

  it('un quartier sans correspondance grise toutes les cases', () => {
    const g = grilleMur([statut()], [demande()], {
      maintenant: MAINTENANT,
      quartier: 'Port-Gentil',
    });
    expect(g.every((t) => t.vide)).toBe(true);
  });

  it('un quartier vide ou fait d’espaces ne filtre rien', () => {
    const g = grilleMur([statut()], [], { maintenant: MAINTENANT, quartier: '   ' });
    expect(tuile(g, 'Plombier')?.dispo).toBe(1);
  });

  it('la recherche filtre sur le métier (accents ignorés)', () => {
    const g = grilleMur([], [], { maintenant: MAINTENANT, recherche: 'electri' });
    expect(g.map((t) => t.metier)).toEqual(['Électricien']);
    expect(grilleMur([], [], { maintenant: MAINTENANT, recherche: 'ÉLECTRI' })).toHaveLength(1);
  });

  it('une recherche sans résultat donne une grille vide', () => {
    expect(grilleMur([], [], { maintenant: MAINTENANT, recherche: 'zzz' })).toEqual([]);
  });

  it('trie : cases actives d’abord (les plus fournies en tête), puis ordre de base', () => {
    const g = grilleMur(
      [statut({ metier: 'Peintre' }), statut({ eventId: '$s2', metier: 'Maçon' })],
      [demande({ service: 'Maçon' }), demande({ eventId: '$d2', service: 'Soudeur' })],
      { maintenant: MAINTENANT },
    );
    expect(g.slice(0, 3).map((t) => t.metier)).toEqual(['Maçon', 'Peintre', 'Soudeur']);
    expect(g.slice(3).map((t) => t.metier)).toEqual([
      'Plombier',
      'Électricien',
      'Coiffeuse',
      'Mécanicien',
      'Couturière',
      'Menuisier',
    ]);
  });

  it('les chiffres ne sont jamais négatifs', () => {
    const g = grilleMur([statut()], [demande()], { maintenant: MAINTENANT });
    for (const t of g) {
      expect(t.dispo).toBeGreaterThanOrEqual(0);
      expect(t.demandes).toBeGreaterThanOrEqual(0);
    }
  });

  it('ignore les entrées sans métier lisible', () => {
    const g = grilleMur([statut({ metier: '   ' })], [demande({ service: '' })], {
      maintenant: MAINTENANT,
    });
    expect(g).toHaveLength(8);
    expect(g.every((t) => t.vide)).toBe(true);
  });

  it('ne modifie pas les listes reçues', () => {
    const s = [statut()];
    const copie = JSON.stringify(s);
    grilleMur(s, [], { maintenant: MAINTENANT });
    expect(JSON.stringify(s)).toBe(copie);
  });
});

describe('phraseMur', () => {
  it('personne : phrase de repos', () => {
    expect(phraseMur([], undefined, MAINTENANT)).toBe('Personne ne cherche pour l’instant.');
  });
  it('un seul client, avec quartier', () => {
    expect(phraseMur([demande()], 'Akanda', MAINTENANT)).toBe('1 client cherche à Akanda');
  });
  it('plusieurs clients, avec quartier', () => {
    expect(phraseMur([demande(), demande({ eventId: '$d2' })], 'Akanda', MAINTENANT)).toBe(
      '2 clients cherchent à Akanda',
    );
  });
  it('sans quartier', () => {
    expect(phraseMur([demande(), demande({ eventId: '$d2' })], undefined, MAINTENANT)).toBe(
      '2 clients cherchent quelqu’un en ce moment',
    );
    expect(phraseMur([demande()], '  ', MAINTENANT)).toBe(
      '1 client cherche quelqu’un en ce moment',
    );
  });
  it('ignore les demandes expirées et celles d’un autre quartier', () => {
    const d = [demande({ fin: PASSE }), demande({ eventId: '$d2', zone: 'Owendo' })];
    expect(phraseMur(d, 'Akanda', MAINTENANT)).toBe('Personne ne cherche pour l’instant.');
    expect(phraseMur(d, undefined, MAINTENANT)).toBe('1 client cherche quelqu’un en ce moment');
  });
});

describe('listeMetier', () => {
  it('compare le métier avec cleTexte', () => {
    const r = listeMetier(
      [statut({ metier: 'electricien' }), statut({ eventId: '$s2', metier: 'Plombier' })],
      [demande({ service: 'ÉLECTRICIEN' }), demande({ eventId: '$d2', service: 'Peintre' })],
      'Électricien',
      undefined,
      MAINTENANT,
    );
    expect(r.prestataires.map((p) => p.eventId)).toEqual(['$s1']);
    expect(r.demandes.map((d) => d.eventId)).toEqual(['$d1']);
  });
  it('ignore les expirés et filtre le quartier', () => {
    const r = listeMetier(
      [
        statut({ fin: PASSE }),
        statut({ eventId: '$s2', zone: 'Owendo' }),
        statut({ eventId: '$s3' }),
      ],
      [demande({ fin: PASSE }), demande({ eventId: '$d2', zone: 'Owendo' })],
      'Plombier',
      'Akanda',
      MAINTENANT,
    );
    expect(r.prestataires.map((p) => p.eventId)).toEqual(['$s3']);
    expect(r.demandes).toEqual([]);
  });
  it('les plus récents d’abord', () => {
    const r = listeMetier(
      [statut({ eventId: '$vieux', fin: FUTUR }), statut({ eventId: '$neuf', fin: FUTUR + 5000 })],
      [demande({ eventId: '$d-vieux', creeLe: 1 }), demande({ eventId: '$d-neuf', creeLe: 9 })],
      'Plombier',
      undefined,
      MAINTENANT,
    );
    expect(r.prestataires.map((p) => p.eventId)).toEqual(['$neuf', '$vieux']);
    expect(r.demandes.map((d) => d.eventId)).toEqual(['$d-neuf', '$d-vieux']);
  });
  it('cas vide', () => {
    expect(listeMetier([], [], 'Plombier', undefined, MAINTENANT)).toEqual({
      prestataires: [],
      demandes: [],
    });
  });
  it('ne modifie pas les listes reçues', () => {
    const s = [statut({ eventId: '$a' }), statut({ eventId: '$b', fin: FUTUR + 1 })];
    listeMetier(s, [], 'Plombier', undefined, MAINTENANT);
    expect(s.map((x) => x.eventId)).toEqual(['$a', '$b']);
  });
});

describe('libelleModalite', () => {
  it('donne une phrase par modalité', () => {
    expect(libelleModalite('recoit')).toBe('Reçoit sur place');
    expect(libelleModalite('deplace')).toBe('Se déplace');
    expect(libelleModalite('les-deux')).toBe('Reçoit et se déplace');
  });
});

describe('prixIndicatif', () => {
  it('écrit « à partir de … FCFA » avec les milliers séparés', () => {
    expect(prixIndicatif(5000)).toBe('à partir de 5 000 FCFA');
    expect(prixIndicatif(1_250_000)).toBe('à partir de 1 250 000 FCFA');
    expect(prixIndicatif(500)).toBe('à partir de 500 FCFA');
  });
  it('un prix négatif, nul ou absurde ne donne rien', () => {
    expect(prixIndicatif(-5000)).toBe('');
    expect(prixIndicatif(0)).toBe('');
    expect(prixIndicatif(Number.NaN)).toBe('');
    expect(prixIndicatif(Infinity)).toBe('');
  });
});
