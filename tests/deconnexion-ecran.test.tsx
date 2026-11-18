import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { deconnecter } from '../src/matrix/auth';
import { lireSession } from '../src/matrix/session';
import { BoutonDeconnexion } from '../src/ui/BoutonDeconnexion';

// Jamais le vrai serveur ni le vrai stockage : tout est simulé.
vi.mock('../src/matrix/auth', () => ({ deconnecter: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn() }));

const SESSION = { userId: '@mangue:sia', accessToken: 'jeton', deviceId: 'APPAREIL' };

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.bulles]}>
      <Routes>
        <Route path={CHEMINS.bulles} element={<BoutonDeconnexion />} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Bouton Se déconnecter', () => {
  beforeEach(() => {
    vi.mocked(lireSession).mockReset().mockReturnValue(SESSION);
    vi.mocked(deconnecter).mockReset().mockResolvedValue(undefined);
  });

  it("demande confirmation avant et ne déconnecte pas tant qu'on n'a pas confirmé", () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(screen.getByRole('dialog', { name: 'Te déconnecter ?' })).toBeInTheDocument();
    expect(
      screen.getByText('Tes bulles en cours seront fermées sur ce téléphone.'),
    ).toBeInTheDocument();
    expect(deconnecter).not.toHaveBeenCalled();
  });

  it('Annuler ferme la feuille sans rien effacer', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deconnecter).not.toHaveBeenCalled();
  });

  it("confirmer déconnecte puis ramène à l'accueil", async () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    const dialogue = screen.getByRole('dialog');
    fireEvent.click(dialogue.querySelector('.bouton--alerte') as HTMLElement);
    await waitFor(() => expect(screen.getByText('écran accueil')).toBeInTheDocument());
    expect(deconnecter).toHaveBeenCalledWith(SESSION);
  });

  it("sans session, va quand même à l'accueil", async () => {
    vi.mocked(lireSession).mockReturnValue(null);
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    fireEvent.click(screen.getByRole('dialog').querySelector('.bouton--alerte') as HTMLElement);
    await waitFor(() => expect(screen.getByText('écran accueil')).toBeInTheDocument());
    expect(deconnecter).not.toHaveBeenCalled();
  });
});
