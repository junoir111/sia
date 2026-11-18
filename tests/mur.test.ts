import { describe, expect, it } from 'vitest';
import {
  cleTexte,
  grilleMur,
  libelleModalite,
  listeMetier,
  prixIndicatif,
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

describe('grilleMur (prestataires disponibles seulement)', () => {
  it('sans rien : aucune case (pas de métiers de base)', () => {
    expect(grilleMur([], { maintenant: MAINTENANT })).toEqual([]);
  });

  it('compte les prestataires par métier ; pas de champ demandes ni vide', () => {
    const g = grilleMur([statut(), statut({ eventId: '$s2', userId: '@b:sia' })], {
      maintenant: MAINTENANT,
    });
    expect(g).toEqual([{ metier: 'Plombier', dispo: 2 }]);
  });

  it('ignore les entrées expirées (fin <= maintenant) : plus de case', () => {
    const g = grilleMur(
      [statut({ fin: PASSE }), statut({ eventId: '$s2', metier: 'Soudeur', fin: MAINTENANT })],
      { maintenant: MAINTENANT },
    );
    expect(g).toEqual([]);
  });

  it('regroupe malgré accents et majuscules', () => {
    const g = grilleMur(
      [
        statut({ metier: 'Soudeur' }),
        statut({ eventId: '$s2', metier: 'electricien' }),
        statut({ eventId: '$s3', metier: 'ÉLECTRICIEN' }),
      ],
      { maintenant: MAINTENANT },
    );
    expect(g).toHaveLength(2);
    expect(g.filter((t) => cleTexte(t.metier) === 'electricien')).toEqual([
      { metier: 'electricien', dispo: 2 },
    ]);
    expect(tuile(g, 'Soudeur')?.dispo).toBe(1);
  });

  it('filtre par quartier, sans tenir compte des accents ni des majuscules', () => {
    const g = grilleMur(
      [statut({ zone: 'Akanda' }), statut({ eventId: '$s2', zone: 'Owendo' })],
      { maintenant: MAINTENANT, quartier: 'akanda' },
    );
    expect(tuile(g, 'Plombier')?.dispo).toBe(1);
    const g2 = grilleMur([statut({ zone: 'Nzeng-Ayong' })], {
      maintenant: MAINTENANT,
      quartier: 'NZENG',
    });
    expect(tuile(g2, 'Plombier')?.dispo).toBe(1);
  });

  it('un quartier sans correspondance ne donne aucune case', () => {
    expect(grilleMur([statut()], { maintenant: MAINTENANT, quartier: 'Port-Gentil' })).toEqual([]);
  });

  it('un quartier vide ou fait d’espaces ne filtre rien', () => {
    const g = grilleMur([statut()], { maintenant: MAINTENANT, quartier: '   ' });
    expect(tuile(g, 'Plombier')?.dispo).toBe(1);
  });

  it('la recherche filtre sur le métier (accents ignorés)', () => {
    const s = [statut({ metier: 'Électricien' }), statut({ eventId: '$s2' })];
    expect(grilleMur(s, { maintenant: MAINTENANT, recherche: 'electri' }).map((t) => t.metier)).toEqual([
      'Électricien',
    ]);
    expect(grilleMur(s, { maintenant: MAINTENANT, recherche: 'ÉLECTRI' })).toHaveLength(1);
  });

  it('une recherche sans résultat donne une grille vide', () => {
    expect(grilleMur([statut()], { maintenant: MAINTENANT, recherche: 'zzz' })).toEqual([]);
  });

  it('trie : les plus fournis en tête, ordre d’arrivée à égalité', () => {
    const g = grilleMur(
      [
        statut({ metier: 'Peintre' }),
        statut({ eventId: '$s2', metier: 'Maçon' }),
        statut({ eventId: '$s3', metier: 'Maçon' }),
        statut({ eventId: '$s4', metier: 'Soudeur' }),
      ],
      { maintenant: MAINTENANT },
    );
    expect(g.map((t) => t.metier)).toEqual(['Maçon', 'Peintre', 'Soudeur']);
  });

  it('ignore les entrées sans métier lisible', () => {
    expect(grilleMur([statut({ metier: '   ' })], { maintenant: MAINTENANT })).toEqual([]);
  });

  it('ne modifie pas les listes reçues', () => {
    const s = [statut()];
    const copie = JSON.stringify(s);
    grilleMur(s, { maintenant: MAINTENANT });
    expect(JSON.stringify(s)).toBe(copie);
  });
});

describe('listeMetier (prestataires seulement)', () => {
  it('compare le métier avec cleTexte et rend un simple tableau', () => {
    const r = listeMetier(
      [statut({ metier: 'electricien' }), statut({ eventId: '$s2', metier: 'Plombier' })],
      'Électricien',
      undefined,
      MAINTENANT,
    );
    expect(r.map((p) => p.eventId)).toEqual(['$s1']);
  });
  it('ignore les expirés et filtre le quartier', () => {
    const r = listeMetier(
      [
        statut({ fin: PASSE }),
        statut({ eventId: '$s2', zone: 'Owendo' }),
        statut({ eventId: '$s3' }),
      ],
      'Plombier',
      'Akanda',
      MAINTENANT,
    );
    expect(r.map((p) => p.eventId)).toEqual(['$s3']);
  });
  it('les plus récents d’abord', () => {
    const r = listeMetier(
      [statut({ eventId: '$vieux', fin: FUTUR }), statut({ eventId: '$neuf', fin: FUTUR + 5000 })],
      'Plombier',
      undefined,
      MAINTENANT,
    );
    expect(r.map((p) => p.eventId)).toEqual(['$neuf', '$vieux']);
  });
  it('cas vide', () => {
    expect(listeMetier([], 'Plombier', undefined, MAINTENANT)).toEqual([]);
  });
  it('ne modifie pas les listes reçues', () => {
    const s = [statut({ eventId: '$a' }), statut({ eventId: '$b', fin: FUTUR + 1 })];
    listeMetier(s, 'Plombier', undefined, MAINTENANT);
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
