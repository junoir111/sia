import { describe, expect, it } from 'vitest';
import {
  NB_CLIENTS_MAX,
  ajouterClient,
  contenuClients,
  nettoyerClients,
  retirerClient,
  trierClients,
} from '../src/logique/clients';

const ALPHA = { userId: '@alpha:sia.tail94dc60.ts.net', pseudo: 'alpha', zone: 'Akanda' };
const BRAVO = { userId: '@bravo:sia.tail94dc60.ts.net', pseudo: 'Bravo', zone: 'Owendo' };

function numero(n: number) {
  return { userId: `@c${n}:sia.tail94dc60.ts.net`, pseudo: `client-${n}`, zone: 'Akanda' };
}

describe('nettoyerClients (lecture de la liste gardée sur le compte)', () => {
  it('lit une liste bien formée', () => {
    expect(nettoyerClients({ version: 1, clients: [ALPHA, BRAVO] })).toEqual([ALPHA, BRAVO]);
  });

  it("rend une liste vide pour tout ce qui n'est pas une liste", () => {
    for (const brut of [undefined, null, 'x', 3, [], {}, { clients: 3 }, { clients: 'x' }]) {
      expect(nettoyerClients(brut)).toEqual([]);
    }
  });

  it('ignore les entrées mal formées sans refuser le reste', () => {
    const brut = {
      version: 1,
      clients: [
        null,
        'x',
        { userId: 'alpha', pseudo: 'a', zone: 'Akanda' },
        { userId: '@sans-serveur', pseudo: 'a', zone: 'Akanda' },
        { userId: ALPHA.userId, pseudo: '', zone: 'Akanda' },
        { userId: ALPHA.userId, pseudo: 'x'.repeat(31), zone: 'Akanda' },
        { userId: ALPHA.userId, pseudo: 'alpha', zone: 'z'.repeat(41) },
        { userId: ALPHA.userId, pseudo: 'alpha‮', zone: 'Akanda' },
        { userId: ALPHA.userId, pseudo: 12, zone: 'Akanda' },
        BRAVO,
      ],
    };
    expect(nettoyerClients(brut)).toEqual([BRAVO]);
  });

  it('retire les doublons (même compte) et garde le premier', () => {
    const copie = { ...ALPHA, pseudo: 'autre', zone: 'Owendo' };
    expect(nettoyerClients({ clients: [ALPHA, BRAVO, copie] })).toEqual([ALPHA, BRAVO]);
  });

  it('ne garde que le compte, le pseudo et le quartier', () => {
    const [lu] = nettoyerClients({ clients: [{ ...ALPHA, note: 'secret', tel: '0102' }] });
    expect(lu).toEqual(ALPHA);
    expect(Object.keys(lu ?? {}).sort()).toEqual(['pseudo', 'userId', 'zone']);
  });

  it(`ne garde pas plus de ${NB_CLIENTS_MAX} clients`, () => {
    const beaucoup = Array.from({ length: NB_CLIENTS_MAX + 20 }, (_, n) => numero(n));
    expect(nettoyerClients({ clients: beaucoup })).toHaveLength(NB_CLIENTS_MAX);
  });
});

describe('ajouterClient', () => {
  it('ajoute un nouveau client à la fin', () => {
    expect(ajouterClient([ALPHA], BRAVO)).toEqual([ALPHA, BRAVO]);
  });

  it('un client déjà là est mis à jour, sans doublon', () => {
    const change = { ...ALPHA, zone: 'Owendo' };
    expect(ajouterClient([ALPHA, BRAVO], change)).toEqual([change, BRAVO]);
  });

  it('liste pleine : refuse un nouveau client mais accepte la mise à jour', () => {
    const pleine = Array.from({ length: NB_CLIENTS_MAX }, (_, n) => numero(n));
    expect(ajouterClient(pleine, BRAVO)).toBeNull();
    const change = { ...numero(3), zone: 'Owendo' };
    expect(ajouterClient(pleine, change)?.[3]).toEqual(change);
  });

  it('refuse un client invalide', () => {
    expect(ajouterClient([ALPHA], { userId: 'alpha', pseudo: 'a', zone: 'Akanda' })).toBeNull();
    expect(ajouterClient([ALPHA], { ...BRAVO, pseudo: '' })).toBeNull();
    expect(ajouterClient([ALPHA], { ...BRAVO, zone: '   ' })).toBeNull();
  });

  it('ne modifie jamais la liste reçue', () => {
    const avant = [ALPHA];
    ajouterClient(avant, BRAVO);
    expect(avant).toEqual([ALPHA]);
  });
});

describe('retirerClient', () => {
  it('retire ce client et garde les autres', () => {
    expect(retirerClient([ALPHA, BRAVO], ALPHA.userId)).toEqual([BRAVO]);
  });

  it('un client absent ne change rien', () => {
    expect(retirerClient([ALPHA], BRAVO.userId)).toEqual([ALPHA]);
  });
});

describe('trierClients', () => {
  it("range par pseudo, sans tenir compte des majuscules ni des accents, sans toucher à l'original", () => {
    const zoe = { ...numero(1), pseudo: 'zoé' };
    const eve = { ...numero(2), pseudo: 'Éva' };
    const abel = { ...numero(3), pseudo: 'abel' };
    const liste = [zoe, eve, abel];
    expect(trierClients(liste).map((c) => c.pseudo)).toEqual(['abel', 'Éva', 'zoé']);
    expect(liste.map((c) => c.pseudo)).toEqual(['zoé', 'Éva', 'abel']);
  });
});

describe('contenuClients', () => {
  it('donne ce qui est écrit sur le compte', () => {
    expect(contenuClients([ALPHA])).toEqual({ version: 1, clients: [ALPHA] });
  });
});
