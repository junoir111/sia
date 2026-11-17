import { describe, expect, it } from 'vitest';
import { DUREE_DEMANDE_MS } from '../src/logique/demande';
import {
  doitNotifier,
  type AnnonceRecue,
  type ContexteNotification,
} from '../src/logique/notification';

const MAINTENANT = 1_800_000_000_000;
const MOI = '@mangue-douce:sia.tail94dc60.ts.net';

const annonce: AnnonceRecue = {
  eventId: '$demande1',
  expediteur: '@palmier-48:sia.tail94dc60.ts.net',
  contenu: {
    role: 'client',
    pseudo: 'palmier-48',
    service: 'Plombier',
    zone: 'Akanda',
    texte: '',
    budget: 5000,
    fin: MAINTENANT + DUREE_DEMANDE_MS,
  },
};
const contexte: ContexteNotification = {
  moi: MOI,
  disponible: true,
  dejaVues: new Set(),
  maintenant: MAINTENANT,
};
const avec = (c: Record<string, unknown>): AnnonceRecue => ({
  ...annonce,
  contenu: { ...(annonce.contenu as object), ...c },
});

describe('doitNotifier', () => {
  it('oui pour une demande de client valide, quel que soit le quartier ou le métier', () => {
    expect(doitNotifier(annonce, contexte)).toBe(true);
    expect(doitNotifier(avec({ zone: 'PK12', service: 'Coiffeuse' }), contexte)).toBe(true);
  });
  it('non si je ne suis pas disponible', () => {
    expect(doitNotifier(annonce, { ...contexte, disponible: false })).toBe(false);
  });
  it('non pour ma propre demande', () => {
    expect(doitNotifier({ ...annonce, expediteur: MOI }, contexte)).toBe(false);
  });
  it('non si déjà vue', () => {
    expect(doitNotifier(annonce, { ...contexte, dejaVues: new Set(['$demande1']) })).toBe(false);
  });
  it('non si expirée (fin atteinte)', () => {
    expect(doitNotifier(annonce, { ...contexte, maintenant: MAINTENANT + DUREE_DEMANDE_MS })).toBe(
      false,
    );
    expect(
      doitNotifier(annonce, { ...contexte, maintenant: MAINTENANT + DUREE_DEMANDE_MS - 1 }),
    ).toBe(true);
  });
  it('non pour un statut de prestataire ou une donnée malformée', () => {
    expect(doitNotifier(avec({ role: 'prestataire' }), contexte)).toBe(false);
    expect(doitNotifier(avec({ role: undefined }), contexte)).toBe(false);
    expect(doitNotifier(avec({ budget: 'cher' }), contexte)).toBe(false);
    expect(doitNotifier({ ...annonce, contenu: null }, contexte)).toBe(false);
    expect(doitNotifier({ ...annonce, contenu: 'texte' }, contexte)).toBe(false);
  });
  it('non si la fin est trop lointaine', () => {
    expect(doitNotifier(avec({ fin: MAINTENANT + 10 * DUREE_DEMANDE_MS }), contexte)).toBe(false);
  });
});
