import { beforeEach, describe, expect, it } from 'vitest';
import { cheminBulle } from '../src/chemins';
import {
  acquitterSortie,
  cleCarte,
  salonDeAdresse,
  suivreBulles,
} from '../src/ecrans/bandeau/alertes-bulles';
import {
  MEMOIRE_VIDE,
  avecNonLus,
  avecOuverture,
  ecrireMemoire,
  lireMemoire,
} from '../src/ecrans/bandeau/memoire-alertes';
import type { ResumeBulle } from '../src/matrix/bulles';

const A = '!a:sia.tail94dc60.ts.net';
const B = '!b:sia.tail94dc60.ts.net';
const C = '!c:sia.tail94dc60.ts.net';

function bulle(roomId: string, o: Partial<ResumeBulle> = {}): ResumeBulle {
  return {
    roomId,
    autre: { pseudo: 'mangue-douce', zone: 'Owendo' },
    demande: null,
    etat: 'ouverte',
    nonLus: 0,
    autreEcrit: false,
    ...o,
  };
}

beforeEach(() => localStorage.clear());

describe('suivreBulles : « X a accepté » (ma bulle passe de en attente à ouverte)', () => {
  it('en attente : rien à dire, mais on s’en souvient', () => {
    const suivi = suivreBulles([bulle(A, { etat: 'en-attente' })], null, MEMOIRE_VIDE);
    expect(suivi.cartes).toEqual([]);
    expect(suivi.memoire.ouvertures).toEqual({ [A]: 'attente' });
  });

  it('elle s’ouvre alors que je suis ailleurs : une carte avec le pseudo de l’autre', () => {
    const attente = suivreBulles([bulle(A, { etat: 'en-attente' })], null, MEMOIRE_VIDE).memoire;
    const suivi = suivreBulles([bulle(A)], null, attente);
    expect(suivi.cartes).toEqual([{ genre: 'ouverte', roomId: A, pseudo: 'mangue-douce' }]);
  });

  it('la carte reste tant qu’elle n’est pas traitée (listes suivantes, bulle toujours ouverte)', () => {
    const attente = suivreBulles([bulle(A, { etat: 'en-attente' })], null, MEMOIRE_VIDE).memoire;
    const premiere = suivreBulles([bulle(A)], null, attente);
    const seconde = suivreBulles([bulle(A, { autreEcrit: true })], B, premiere.memoire);
    expect(seconde.cartes).toHaveLength(1);
  });

  it('bulle déjà ouverte au premier passage (jamais vue en attente) : rien', () => {
    const suivi = suivreBulles([bulle(A)], null, MEMOIRE_VIDE);
    expect(suivi.cartes).toEqual([]);
    expect(suivi.memoire).toBe(MEMOIRE_VIDE);
  });

  it('je suis déjà dans la bulle quand elle s’ouvre : pas de carte, et on n’en parlera plus', () => {
    const attente = suivreBulles([bulle(A, { etat: 'en-attente' })], A, MEMOIRE_VIDE).memoire;
    const suivi = suivreBulles([bulle(A)], A, attente);
    expect(suivi.cartes).toEqual([]);
    expect(suivi.memoire.ouvertures).toEqual({ [A]: 'dite' });
    // Je sors de la bulle : toujours rien.
    expect(suivreBulles([bulle(A)], null, suivi.memoire).cartes).toEqual([]);
  });

  it('j’entre dans la bulle alors que la carte est là : elle disparaît et ne revient pas', () => {
    const attente = suivreBulles([bulle(A, { etat: 'en-attente' })], null, MEMOIRE_VIDE).memoire;
    expect(suivreBulles([bulle(A)], null, attente).cartes).toHaveLength(1);
    const dedans = suivreBulles([bulle(A)], A, attente);
    expect(dedans.cartes).toEqual([]);
    expect(suivreBulles([bulle(A)], null, dedans.memoire).cartes).toEqual([]);
  });

  it('une seule fois par bulle : si elle repasse en attente puis ouverte, pas de seconde carte', () => {
    let memoire = avecOuverture(MEMOIRE_VIDE, A, 'dite');
    memoire = suivreBulles([bulle(A, { etat: 'en-attente' })], null, memoire).memoire;
    expect(suivreBulles([bulle(A)], null, memoire).cartes).toEqual([]);
  });

  it('l’autre est parti avant d’accepter : bulle oubliée, pas de carte', () => {
    const attente = suivreBulles([bulle(A, { etat: 'en-attente' })], null, MEMOIRE_VIDE).memoire;
    const suivi = suivreBulles([bulle(A, { etat: 'fermee' })], null, attente);
    expect(suivi.cartes).toEqual([]);
    expect(suivi.memoire.ouvertures).toEqual({});
  });

  it('une invitation reçue n’est ni une attente ni une ouverture', () => {
    const suivi = suivreBulles([bulle(A, { etat: 'invitation-recue' })], null, MEMOIRE_VIDE);
    expect(suivi.cartes).toEqual([]);
    expect(suivi.memoire).toBe(MEMOIRE_VIDE);
  });

  it('je n’ai pas accepté moi-même : accepter une invitation ne fait pas de carte', () => {
    const invitee = suivreBulles([bulle(A, { etat: 'invitation-recue' })], null, MEMOIRE_VIDE);
    expect(suivreBulles([bulle(A)], null, invitee.memoire).cartes).toEqual([]);
  });
});

describe('suivreBulles : « Nouveau message de X »', () => {
  it('un message arrive dans une bulle où je ne suis pas : une carte', () => {
    const suivi = suivreBulles([bulle(A, { nonLus: 1 })], null, MEMOIRE_VIDE);
    expect(suivi.cartes).toEqual([{ genre: 'message', roomId: A, pseudo: 'mangue-douce' }]);
  });

  it('plusieurs messages de la même bulle : une seule carte', () => {
    const suivi = suivreBulles([bulle(A, { nonLus: 4 })], null, MEMOIRE_VIDE);
    expect(suivi.cartes).toHaveLength(1);
  });

  it('une carte par bulle, dans l’ordre de la liste', () => {
    const suivi = suivreBulles(
      [bulle(A, { nonLus: 1 }), bulle(B), bulle(C, { nonLus: 2 })],
      null,
      MEMOIRE_VIDE,
    );
    expect(suivi.cartes.map((c) => c.roomId)).toEqual([A, C]);
  });

  it('je suis dans cette bulle : pas de carte', () => {
    expect(suivreBulles([bulle(A, { nonLus: 2 })], A, MEMOIRE_VIDE).cartes).toEqual([]);
  });

  it('je suis dans une AUTRE bulle : la carte vient', () => {
    const suivi = suivreBulles([bulle(A), bulle(B, { nonLus: 1 })], A, MEMOIRE_VIDE);
    expect(suivi.cartes.map((c) => c.roomId)).toEqual([B]);
  });

  it('pas de carte pour une bulle en attente, fermée ou une invitation', () => {
    const liste = (etat: ResumeBulle['etat']) => [bulle(A, { etat, nonLus: 1 })];
    for (const etat of ['en-attente', 'fermee', 'invitation-recue'] as const) {
      expect(suivreBulles(liste(etat), null, MEMOIRE_VIDE).cartes).toEqual([]);
    }
  });

  it('pas de message non lu : pas de carte', () => {
    expect(suivreBulles([bulle(A)], null, MEMOIRE_VIDE).cartes).toEqual([]);
  });

  it('non-lus déjà connus (rien d’illisible de nouveau) : pas de carte ; un de plus : carte', () => {
    const connu = avecNonLus(MEMOIRE_VIDE, A, 1);
    expect(suivreBulles([bulle(A, { nonLus: 1 })], null, connu).cartes).toEqual([]);
    expect(suivreBulles([bulle(A, { nonLus: 2 })], null, connu).cartes).toHaveLength(1);
  });

  it('le compteur baisse (lus ou effacés) : le niveau connu baisse, le suivant fera une carte', () => {
    const connu = avecNonLus(MEMOIRE_VIDE, A, 2);
    const baisse = suivreBulles([bulle(A, { nonLus: 1 })], null, connu);
    expect(baisse.cartes).toEqual([]);
    expect(baisse.memoire.messages).toEqual({ [A]: 1 });
    const zero = suivreBulles([bulle(A, { nonLus: 0 })], null, baisse.memoire);
    expect(zero.memoire.messages).toEqual({});
    expect(suivreBulles([bulle(A, { nonLus: 1 })], null, zero.memoire).cartes).toHaveLength(1);
  });

  it('rien n’est jamais retenu du contenu : la carte ne porte que bulle et pseudo', () => {
    const avecTexte = { ...bulle(A, { nonLus: 1 }), texte: 'rendez-vous secret' } as ResumeBulle;
    const suivi = suivreBulles([avecTexte], null, MEMOIRE_VIDE);
    expect(JSON.stringify(suivi)).not.toContain('secret');
  });
});

describe('acquitterSortie : ce que je n’ai pas pu lire dans la bulle n’est plus une nouveauté', () => {
  it('retient les non-lus qui restent à la sortie (messages illisibles)', () => {
    const memoire = acquitterSortie(MEMOIRE_VIDE, [bulle(A, { nonLus: 1 })], A);
    expect(memoire.messages).toEqual({ [A]: 1 });
    expect(suivreBulles([bulle(A, { nonLus: 1 })], null, memoire).cartes).toEqual([]);
  });

  it('tout a été lu : le niveau retombe à zéro', () => {
    const avant = avecNonLus(MEMOIRE_VIDE, A, 3);
    expect(acquitterSortie(avant, [bulle(A)], A).messages).toEqual({});
  });

  it('bulle disparue ou fermée : on l’oublie', () => {
    const avant = avecNonLus(MEMOIRE_VIDE, A, 3);
    expect(acquitterSortie(avant, [], A).messages).toEqual({});
    expect(acquitterSortie(avant, [bulle(A, { etat: 'fermee', nonLus: 2 })], A).messages).toEqual(
      {},
    );
  });

  it('ne touche pas aux autres bulles', () => {
    const avant = avecNonLus(MEMOIRE_VIDE, B, 2);
    expect(acquitterSortie(avant, [bulle(A, { nonLus: 1 })], A).messages).toEqual({
      [A]: 1,
      [B]: 2,
    });
  });
});

describe('cleCarte', () => {
  it('une clé par genre et par bulle (pas de collision avec la clé d’une offre)', () => {
    const ouverte = cleCarte({ genre: 'ouverte', roomId: A, pseudo: 'x' });
    const message = cleCarte({ genre: 'message', roomId: A, pseudo: 'x' });
    expect(new Set([ouverte, message, A]).size).toBe(3);
  });
});

describe('salonDeAdresse : la bulle montrée à l’écran', () => {
  it('lit le salon dans l’adresse d’une bulle (décodé)', () => {
    expect(salonDeAdresse(cheminBulle(A))).toBe(A);
  });

  it('rien pour les autres écrans', () => {
    for (const adresse of ['/', '/mur', '/bulles', '/bulle', '/bulle/', '/mur/metier/Plombier']) {
      expect(salonDeAdresse(adresse)).toBeNull();
    }
  });

  it('rien pour une adresse trop longue ou qui n’est pas un salon', () => {
    expect(salonDeAdresse('/bulle/abc')).toBeNull();
    expect(salonDeAdresse(`/bulle/${cheminBulle(A)}`)).toBeNull();
  });

  it('adresse mal encodée : rien, sans erreur', () => {
    expect(salonDeAdresse('/bulle/%E0%A4%A')).toBeNull();
  });
});

describe('mémoire des alertes (localStorage « sia.alertes »)', () => {
  it('vide au départ', () => {
    expect(lireMemoire()).toEqual(MEMOIRE_VIDE);
  });

  it('ce qu’on écrit se relit après un rechargement', () => {
    const memoire = avecNonLus(avecOuverture(MEMOIRE_VIDE, A, 'attente'), B, 2);
    ecrireMemoire(memoire);
    expect(lireMemoire()).toEqual({ ouvertures: { [A]: 'attente' }, messages: { [B]: 2 } });
  });

  it('une mémoire vide ne laisse rien sur le téléphone', () => {
    ecrireMemoire(avecOuverture(MEMOIRE_VIDE, A, 'dite'));
    expect(localStorage.getItem('sia.alertes')).not.toBeNull();
    ecrireMemoire(MEMOIRE_VIDE);
    expect(localStorage.getItem('sia.alertes')).toBeNull();
  });

  it('ne garde que des identifiants de bulle et des nombres, jamais de texte', () => {
    const avecTexte = { ...bulle(A, { etat: 'en-attente' }), texte: 'rendez-vous secret' };
    ecrireMemoire(suivreBulles([avecTexte as ResumeBulle], null, MEMOIRE_VIDE).memoire);
    expect(localStorage.getItem('sia.alertes')).toBe(
      JSON.stringify({ ouvertures: { [A]: 'attente' }, messages: {} }),
    );
    ecrireMemoire(avecNonLus(avecOuverture(MEMOIRE_VIDE, A, 'dite'), B, 1));
    expect(localStorage.getItem('sia.alertes')).toBe(
      JSON.stringify({ ouvertures: { [A]: 'dite' }, messages: { [B]: 1 } }),
    );
  });

  it('contenu abîmé ou piégé : ignoré, jamais d’erreur', () => {
    for (const brut of ['pas du json', '[]', 'null', '42', '{"ouvertures":"x","messages":[]}']) {
      localStorage.setItem('sia.alertes', brut);
      expect(lireMemoire()).toEqual(MEMOIRE_VIDE);
    }
    localStorage.setItem(
      'sia.alertes',
      JSON.stringify({
        ouvertures: { [A]: 'attente', 'sans-point-exclamation': 'dite', [B]: 'autre-chose' },
        messages: { [A]: 2, [B]: -1, [C]: 1.5, '!d:sia': 'x' },
      }),
    );
    expect(lireMemoire()).toEqual({ ouvertures: { [A]: 'attente' }, messages: { [A]: 2 } });
  });

  it('une clé « __proto__ » dans le contenu lu n’est jamais gardée', () => {
    // Écrit à la main en texte : un objet littéral ignorerait cette clé, un vrai JSON la crée.
    localStorage.setItem(
      'sia.alertes',
      `{"ouvertures":{"__proto__":"dite"},"messages":{"__proto__":3,"${A}":2}}`,
    );
    const memoire = lireMemoire();
    expect(memoire).toEqual({ ouvertures: {}, messages: { [A]: 2 } });
    expect(Object.keys(memoire.messages)).toEqual([A]);
    expect(({} as Record<string, unknown>).polluee).toBeUndefined();
  });

  it('bornée : les bulles les plus anciennes sont oubliées', () => {
    let memoire = MEMOIRE_VIDE;
    for (let i = 0; i < 130; i += 1) memoire = avecOuverture(memoire, `!s${i}:sia`, 'dite');
    const cles = Object.keys(memoire.ouvertures);
    expect(cles).toHaveLength(100);
    expect(cles[0]).toBe('!s30:sia');
    expect(cles.at(-1)).toBe('!s129:sia');
  });

  it('ne change rien (même objet) quand la valeur est déjà là', () => {
    const memoire = avecOuverture(MEMOIRE_VIDE, A, 'attente');
    expect(avecOuverture(memoire, A, 'attente')).toBe(memoire);
    expect(avecOuverture(memoire, B, null)).toBe(memoire);
    expect(avecNonLus(memoire, B, 0)).toBe(memoire);
    expect(avecNonLus(avecNonLus(memoire, B, 2), B, 2).messages).toEqual({ [B]: 2 });
  });

  it('ne modifie jamais l’objet de départ', () => {
    const depart = avecOuverture(MEMOIRE_VIDE, A, 'attente');
    const copie = JSON.stringify(depart);
    avecOuverture(depart, B, 'dite');
    avecNonLus(depart, A, 3);
    expect(JSON.stringify(depart)).toBe(copie);
  });

  it('stockage refusé : on ne plante pas', () => {
    const lecture = Storage.prototype.getItem;
    const ecriture = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error('refusé');
    };
    Storage.prototype.setItem = () => {
      throw new Error('refusé');
    };
    try {
      expect(lireMemoire()).toEqual(MEMOIRE_VIDE);
      expect(() => ecrireMemoire(avecOuverture(MEMOIRE_VIDE, A, 'dite'))).not.toThrow();
    } finally {
      Storage.prototype.getItem = lecture;
      Storage.prototype.setItem = ecriture;
    }
  });
});
