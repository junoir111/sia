import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { RoutesSia } from '../src/navigation';

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

  it.each([
    CHEMINS.connexion,
    CHEMINS.codeSecret,
    CHEMINS.role,
    CHEMINS.profilPrestataire,
    CHEMINS.profilClient,
  ])('%s affiche « Bientôt disponible »', (chemin) => {
    afficher(chemin);
    expect(screen.getByText('Bientôt disponible')).toBeInTheDocument();
  });

  it("le lien de « Bientôt disponible » ramène à l'accueil", () => {
    afficher(CHEMINS.connexion);
    fireEvent.click(screen.getByRole('link', { name: "Retour à l'accueil" }));
    expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
  });

  it("une adresse inconnue renvoie à l'accueil", () => {
    afficher('/nimporte-quoi');
    expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
  });
});
