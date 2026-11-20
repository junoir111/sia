import { beforeEach, describe, expect, it, vi } from 'vitest';
import { surveillerAbsence } from '../src/appareil/absence';
import { ABSENCE_MAX_MS } from '../src/logique/code-secret';

type EtatAppli = { isActive: boolean };

// Jamais le vrai téléphone : le plugin « App » de Capacitor est simulé.
const faux = vi.hoisted(() => ({
  ecoute: null as null | ((etat: { isActive: boolean }) => void),
  retirer: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_nom: string, rappel: (etat: EtatAppli) => void) => {
      faux.ecoute = rappel;
      return { remove: faux.retirer };
    }),
  },
}));

let heure = 1_800_000_000_000;
const maintenant = () => heure;
const quitter = () => faux.ecoute?.({ isActive: false });
const revenir = () => faux.ecoute?.({ isActive: true });

beforeEach(() => {
  heure = 1_800_000_000_000;
  faux.ecoute = null;
  faux.retirer.mockClear();
});

describe('surveillerAbsence', () => {
  it('une minute dehors ou plus : au retour, on referme à clé', () => {
    const referme = vi.fn();
    surveillerAbsence(referme, maintenant);
    quitter();
    heure += ABSENCE_MAX_MS;
    revenir();
    expect(referme).toHaveBeenCalledTimes(1);
  });

  it('moins d’une minute dehors : rien ne se passe', () => {
    const referme = vi.fn();
    surveillerAbsence(referme, maintenant);
    quitter();
    heure += ABSENCE_MAX_MS - 1;
    revenir();
    expect(referme).not.toHaveBeenCalled();
  });

  it('un retour sans départ connu ne referme rien', () => {
    const referme = vi.fn();
    surveillerAbsence(referme, maintenant);
    revenir();
    expect(referme).not.toHaveBeenCalled();
  });

  it('plusieurs départs d’affilée comptent depuis le premier', () => {
    const referme = vi.fn();
    surveillerAbsence(referme, maintenant);
    quitter();
    heure += 40_000;
    quitter();
    heure += 30_000;
    revenir();
    expect(referme).toHaveBeenCalledTimes(1);
  });

  it('chaque absence compte à part : après un retour, le décompte repart de zéro', () => {
    const referme = vi.fn();
    surveillerAbsence(referme, maintenant);
    quitter();
    heure += ABSENCE_MAX_MS;
    revenir();
    quitter();
    heure += 10_000;
    revenir();
    expect(referme).toHaveBeenCalledTimes(1);
  });

  it('arrêter de surveiller retire l’écoute', async () => {
    const arreter = surveillerAbsence(vi.fn(), maintenant);
    expect(faux.retirer).not.toHaveBeenCalled();
    arreter();
    await vi.waitFor(() => expect(faux.retirer).toHaveBeenCalledTimes(1));
  });
});
