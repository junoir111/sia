import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { RoutesSia } from '../src/navigation';

// Le profil prestataire lit le serveur au chargement : jamais le vrai serveur ici.
vi.mock('../src/matrix/profil', () => ({
  lireProfil: vi.fn().mockResolvedValue({ ok: true, profil: null }),
  enregistrerProfil: vi.fn(),
}));

function afficher(adresse: string) {
  render(
    <MemoryRouter initialEntries={[adresse]}>
      <RoutesSia />
    </MemoryRouter>,
  );
}

describe('Navigation', () => {
  it("/ affiche l'accueil (E1)", () => {
    afficher(CHEMINS.accueil);
    expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
  });

  it("/inscription affiche l'inscription (E3)", () => {
    afficher(CHEMINS.inscription);
    expect(screen.getByRole('main')).toHaveTextContent('Créer mon compte');
  });

  it('/connexion affiche la connexion (E2)', () => {
    afficher(CHEMINS.connexion);
    expect(screen.getAllByText(/Se connecter/).length).toBeGreaterThan(0);
  });

  it.each([CHEMINS.codeSecret, CHEMINS.role, CHEMINS.mur])(
    '%s affiche « Bientôt disponible »',
    (chemin) => {
      afficher(chemin);
      expect(screen.getByText('Bientôt disponible')).toBeInTheDocument();
    },
  );

  it('/profil/prestataire affiche le profil prestataire (avec une session)', () => {
    localStorage.setItem(
      'sia.session',
      JSON.stringify({ userId: '@essai:sia', accessToken: 'faux', deviceId: 'X' }),
    );
    afficher(CHEMINS.profilPrestataire);
    expect(screen.getAllByText(/Ton profil/).length).toBeGreaterThan(0);
    localStorage.clear();
  });

  it("le lien de « Bientôt disponible » ramène à l'accueil", () => {
    afficher(CHEMINS.codeSecret);
    fireEvent.click(screen.getByRole('link', { name: "Retour à l'accueil" }));
    expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
  });

  it("une adresse inconnue renvoie à l'accueil", () => {
    afficher('/nimporte-quoi');
    expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
  });
});
