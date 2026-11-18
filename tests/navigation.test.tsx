import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  CHEMINS,
  cheminFicheDemande,
  cheminFichePrestataire,
  cheminListeMetier,
} from '../src/chemins';
import { RoutesSia } from '../src/navigation';

// Le profil prestataire lit le serveur au chargement : jamais le vrai serveur ici.
vi.mock('../src/matrix/profil', () => ({
  lireProfil: vi.fn().mockResolvedValue({ ok: true, profil: null }),
  lireProfilClient: vi.fn().mockResolvedValue({ ok: true, profil: null }),
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

  it.each([CHEMINS.codeSecret, CHEMINS.role])('%s affiche « Bientôt disponible »', (chemin) => {
    afficher(chemin);
    expect(screen.getByText('Bientôt disponible')).toBeInTheDocument();
  });

  it('« Bientôt disponible » a une flèche retour visible vers le Mur', () => {
    afficher(CHEMINS.role);
    expect(screen.getByRole('link', { name: 'Retour' })).toHaveAttribute('href', CHEMINS.mur);
  });

  it('/profil/prestataire affiche le profil prestataire (avec une session)', () => {
    localStorage.setItem(
      'sia.session',
      JSON.stringify({ userId: '@essai:sia', accessToken: 'faux', deviceId: 'X' }),
    );
    afficher(CHEMINS.profilPrestataire);
    expect(screen.getAllByText(/Ton profil/).length).toBeGreaterThan(0);
    localStorage.clear();
  });

  describe('Mur (avec session)', () => {
    beforeEach(() =>
      localStorage.setItem(
        'sia.session',
        JSON.stringify({ userId: '@essai:sia', accessToken: 'faux', deviceId: 'X' }),
      ),
    );
    afterEach(() => localStorage.clear());

    it('/mur affiche le Mur ; « Mon compte » mène aux bulles', () => {
      afficher(CHEMINS.mur);
      expect(screen.getByRole('heading', { name: 'Le Mur' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Mon compte' }));
      expect(screen.getByRole('link', { name: /Voir mes bulles/ })).toHaveAttribute(
        'href',
        CHEMINS.bulles,
      );
    });

    it('la liste reprend le métier et le quartier, la flèche revient au Mur avec le quartier', () => {
      afficher(cheminListeMetier('Plombier', 'Akanda'));
      expect(screen.getByRole('heading', { name: 'Plombier · Akanda' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Retour' })).toHaveAttribute(
        'href',
        '/mur?quartier=Akanda',
      );
    });

    it('la fiche prestataire a une flèche vers la liste du métier', () => {
      afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
      expect(screen.getByRole('link', { name: 'Retour' })).toHaveAttribute(
        'href',
        '/mur/metier/Plombier?quartier=Akanda',
      );
    });

    it('la fiche demande a une flèche vers la liste du métier', () => {
      afficher(cheminFicheDemande('$d1', 'Plombier'));
      expect(screen.getByRole('link', { name: 'Retour' })).toHaveAttribute(
        'href',
        '/mur/metier/Plombier',
      );
    });

    it('la flèche ramène réellement à la liste puis au Mur', () => {
      afficher(cheminFichePrestataire('$p1', 'Plombier', 'Akanda'));
      fireEvent.click(screen.getByRole('link', { name: 'Retour' }));
      expect(screen.getByRole('heading', { name: 'Plombier · Akanda' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('link', { name: 'Retour' }));
      expect(screen.getByRole('heading', { name: 'Le Mur' })).toBeInTheDocument();
    });
  });

  it.each([CHEMINS.mur, cheminListeMetier('Plombier'), cheminFicheDemande('$d', 'Plombier')])(
    '%s sans session renvoie à l accueil (E1)',
    (chemin) => {
      afficher(chemin);
      expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
    },
  );

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
