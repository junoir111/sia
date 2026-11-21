import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { attenteAvantEssai, definirCode, verifierCode } from '../src/appareil/verrou';
import { CHEMINS } from '../src/chemins';
import { EcranCode } from '../src/ecrans/code/EcranCode';
import { deconnecter } from '../src/matrix/auth';
import { lireSession } from '../src/matrix/session';

// Jamais le vrai verrou ni le vrai serveur : tout est simulé ici.
vi.mock('../src/appareil/verrou', () => ({
  verifierCode: vi.fn(),
  definirCode: vi.fn(),
  attenteAvantEssai: vi.fn(),
}));
vi.mock('../src/matrix/auth', () => ({ deconnecter: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn() }));

const SESSION = { userId: '@puma:sia', accessToken: 'jeton', deviceId: 'APP' };

function afficher(mode: 'taper' | 'choisir') {
  return render(
    <MemoryRouter initialEntries={['/code']}>
      <Routes>
        <Route path="/code" element={<EcranCode mode={mode} />} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const touche = (nom: string) => screen.getByRole('button', { name: nom });
function taper(code: string) {
  for (const chiffre of code) fireEvent.click(touche(chiffre));
}
const ronds = (libelle: string) => screen.getByRole('img', { name: libelle });

beforeEach(() => {
  vi.mocked(verifierCode).mockReset();
  vi.mocked(definirCode).mockReset().mockResolvedValue(undefined);
  vi.mocked(attenteAvantEssai).mockReset().mockReturnValue(0);
  vi.mocked(deconnecter).mockReset().mockResolvedValue(undefined);
  vi.mocked(lireSession).mockReset().mockReturnValue(SESSION);
});
afterEach(() => vi.useRealTimers());

describe('Écran du code — taper son code', () => {
  it('les ronds se remplissent à chaque chiffre ; effacer retire le dernier', () => {
    afficher('taper');
    expect(screen.getByRole('heading', { name: 'Entre ton code' })).toBeInTheDocument();
    taper('48');
    expect(ronds('2 chiffres sur 4')).toBeInTheDocument();
    fireEvent.click(touche('Effacer'));
    expect(ronds('1 chiffre sur 4')).toBeInTheDocument();
    expect(verifierCode).not.toHaveBeenCalled();
  });

  it('« Effacer » est grisé tant qu’il n’y a rien à effacer', () => {
    afficher('taper');
    expect(touche('Effacer')).toBeDisabled();
    taper('4');
    expect(touche('Effacer')).toBeEnabled();
  });

  it('le code est vérifié dès le 4e chiffre ; un code faux dit combien d’essais restent, puis les ronds se vident', async () => {
    vi.mocked(verifierCode).mockResolvedValue({ etat: 'faux', restants: 4 });
    afficher('taper');
    taper('0000');
    expect(verifierCode).toHaveBeenCalledWith('0000');
    expect(await screen.findByText('Code faux. Il te reste 4 essais.')).toBeInTheDocument();
    await waitFor(() => expect(ronds('0 chiffre sur 4')).toBeInTheDocument());
    // Le message reste jusqu'au prochain chiffre.
    expect(screen.getByText('Code faux. Il te reste 4 essais.')).toBeInTheDocument();
    taper('1');
    expect(screen.queryByText(/Code faux/)).not.toBeInTheDocument();
  });

  it('un seul essai restant : le message est au singulier', async () => {
    vi.mocked(verifierCode).mockResolvedValue({ etat: 'faux', restants: 1 });
    afficher('taper');
    taper('0000');
    expect(await screen.findByText('Code faux. Il te reste 1 essai.')).toBeInTheDocument();
  });

  it('pendant la vérification et le temps du code faux, les chiffres suivants sont ignorés', async () => {
    vi.mocked(verifierCode).mockResolvedValue({ etat: 'faux', restants: 4 });
    afficher('taper');
    taper('0000');
    taper('99');
    await screen.findByText('Code faux. Il te reste 4 essais.');
    expect(verifierCode).toHaveBeenCalledTimes(1);
  });

  it('le bon code : aucun message (la porte s’ouvre ailleurs)', async () => {
    vi.mocked(verifierCode).mockResolvedValue({ etat: 'ok' });
    afficher('taper');
    taper('4821');
    await waitFor(() => expect(verifierCode).toHaveBeenCalledWith('4821'));
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('un souci imprévu à la vérification : un message, pas un écran figé', async () => {
    vi.mocked(verifierCode).mockRejectedValue(new Error('crypto indisponible'));
    afficher('taper');
    taper('4821');
    expect(
      await screen.findByText('Le code n’a pas pu être vérifié. Réessaie.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(ronds('0 chiffre sur 4')).toBeInTheDocument());
    taper('1');
    expect(ronds('1 chiffre sur 4')).toBeInTheDocument();
  });

  it('trop d’essais : clavier bloqué avec un décompte, puis on peut réessayer', async () => {
    vi.useFakeTimers();
    vi.mocked(verifierCode).mockResolvedValue({ etat: 'attente', ms: 3_000 });
    afficher('taper');
    taper('0000');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText("Trop d'essais. Réessaie dans 3 s.")).toBeInTheDocument();
    expect(touche('5')).toBeDisabled();
    expect(touche('0')).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText("Trop d'essais. Réessaie dans 2 s.")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.queryByText(/Trop d'essais/)).not.toBeInTheDocument();
    expect(touche('5')).toBeEnabled();
  });

  it('appli fermée pendant l’attente : le décompte est déjà là à la réouverture', () => {
    vi.mocked(attenteAvantEssai).mockReturnValue(12_000);
    afficher('taper');
    expect(screen.getByText("Trop d'essais. Réessaie dans 12 s.")).toBeInTheDocument();
    expect(touche('1')).toBeDisabled();
  });

  it('le clavier de l’ordinateur marche aussi (chiffres et retour arrière)', () => {
    afficher('taper');
    fireEvent.keyDown(window, { key: '4' });
    fireEvent.keyDown(window, { key: '8' });
    expect(ronds('2 chiffres sur 4')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(ronds('1 chiffre sur 4')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: '5', ctrlKey: true });
    fireEvent.keyDown(window, { key: '5', repeat: true });
    expect(ronds('1 chiffre sur 4')).toBeInTheDocument();
  });
});

describe('Écran du code — choisir son code', () => {
  it('le code se tape deux fois, puis il est gardé', async () => {
    afficher('choisir');
    expect(screen.getByRole('heading', { name: 'Choisis ton code secret' })).toBeInTheDocument();
    taper('4821');
    expect(screen.getByRole('heading', { name: 'Confirme ton code' })).toBeInTheDocument();
    expect(ronds('0 chiffre sur 4')).toBeInTheDocument();
    expect(definirCode).not.toHaveBeenCalled();
    taper('4821');
    await waitFor(() => expect(definirCode).toHaveBeenCalledWith('4821'));
    expect(verifierCode).not.toHaveBeenCalled();
  });

  it('deux codes différents : un message, et on recommence au début', async () => {
    afficher('choisir');
    taper('4821');
    taper('4822');
    expect(
      await screen.findByText('Les deux codes ne sont pas pareils. Recommence.'),
    ).toBeInTheDocument();
    expect(definirCode).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Choisis ton code secret' })).toBeInTheDocument();
  });

  it('le téléphone refuse de garder le code : un message, rien de figé', async () => {
    vi.mocked(definirCode).mockRejectedValue(new Error('stockage plein'));
    afficher('choisir');
    taper('4821');
    taper('4821');
    expect(
      await screen.findByText('Le téléphone n’a pas pu garder le code. Réessaie.'),
    ).toBeInTheDocument();
  });
});

describe('Écran du code — sortie', () => {
  it('« Code oublié ? » : confirmer déconnecte (téléphone effacé) et ramène à l’accueil', async () => {
    // La vraie déconnexion efface la session : la doublure le fait aussi.
    vi.mocked(deconnecter).mockImplementation(async () => {
      vi.mocked(lireSession).mockReturnValue(null);
    });
    afficher('taper');
    fireEvent.click(screen.getByRole('button', { name: 'Code oublié ?' }));
    const fenetre = screen.getByRole('dialog', { name: 'Code oublié ?' });
    expect(touche('5')).toBeDisabled();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Se déconnecter' }));
    expect(await screen.findByText('écran accueil')).toBeInTheDocument();
    expect(deconnecter).toHaveBeenCalledWith(SESSION);
  });

  it('le téléphone n’a pas pu être effacé : on reste derrière le code, avec un message', async () => {
    // La déconnexion « réussit » mais la session est toujours là (stockage en panne) : jamais d'ouverture.
    afficher('taper');
    fireEvent.click(screen.getByRole('button', { name: 'Code oublié ?' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Se déconnecter' }),
    );
    expect(
      await screen.findByText('La déconnexion n’a pas marché. Réessaie.'),
    ).toBeInTheDocument();
    expect(deconnecter).toHaveBeenCalledWith(SESSION);
    expect(screen.queryByText('écran accueil')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entre ton code' })).toBeInTheDocument();
  });

  it('annuler referme la fenêtre et rend le clavier', () => {
    afficher('taper');
    fireEvent.click(screen.getByRole('button', { name: 'Code oublié ?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(touche('5')).toBeEnabled();
    expect(deconnecter).not.toHaveBeenCalled();
  });

  it('la déconnexion échoue : message dans la fenêtre, on reste sur le code', async () => {
    vi.mocked(deconnecter).mockRejectedValue(new Error('réseau'));
    afficher('taper');
    fireEvent.click(screen.getByRole('button', { name: 'Code oublié ?' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Se déconnecter' }),
    );
    expect(
      await screen.findByText('La déconnexion n’a pas marché. Réessaie.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('écran accueil')).not.toBeInTheDocument();
  });

  it('choisir un code : le lien dit « Se déconnecter » (pas de code à oublier)', () => {
    afficher('choisir');
    expect(screen.queryByRole('button', { name: 'Code oublié ?' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(screen.getByRole('dialog', { name: 'Te déconnecter ?' })).toBeInTheDocument();
  });
});
