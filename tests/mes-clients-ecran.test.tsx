import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { MesClients } from '../src/ecrans/clients/MesClients';
import { useMoi } from '../src/ecrans/mur/useMoi';
import type { ContactClient } from '../src/logique/clients';
import { ecrireA } from '../src/matrix/bulles';
import { ecouterClients, lireClients, retirerClientEnregistre } from '../src/matrix/clients';
import { clientEcran, coupureReseau, differe } from './faux-ecran';

// Jamais le vrai serveur : le client Matrix, la liste, les bulles et le profil sont simulés.
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/ecrans/mur/useMoi', () => ({ useMoi: vi.fn() }));
vi.mock('../src/matrix/bulles', () => ({ ecrireA: vi.fn() }));
vi.mock('../src/matrix/clients', () => ({
  lireClients: vi.fn(),
  ecouterClients: vi.fn(),
  retirerClientEnregistre: vi.fn(),
}));

const CLIENT = clientEcran() as never;
const ZOE: ContactClient = {
  userId: '@zoe:sia.tail94dc60.ts.net',
  pseudo: 'zoé-12',
  zone: 'Owendo',
};
const ABEL: ContactClient = {
  userId: '@abel:sia.tail94dc60.ts.net',
  pseudo: 'abel-7',
  zone: 'Akanda',
};
const MOI = { role: 'prestataire' as const, pseudo: 'puma', zone: 'Nzeng' };

/** Appelé quand la liste change (comme la synchro). */
let changerListe: (liste: ContactClient[]) => void = () => undefined;

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.clients]}>
      <Routes>
        <Route path={CHEMINS.clients} element={<MesClients />} />
        <Route path={CHEMINS.bulle} element={<p>écran bulle</p>} />
        <Route path={CHEMINS.mur} element={<p>écran mur</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Écran Mes clients', () => {
  beforeEach(() => {
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(useMoi).mockReturnValue({ moi: MOI, userId: '@moi:sia', chargement: false });
    vi.mocked(lireClients).mockReset().mockReturnValue([ZOE, ABEL]);
    vi.mocked(ecouterClients)
      .mockReset()
      .mockImplementation((_c, rappel) => {
        changerListe = rappel;
        return () => undefined;
      });
    vi.mocked(ecrireA).mockReset().mockResolvedValue({ roomId: '!b:sia', reutilisee: false });
    vi.mocked(retirerClientEnregistre).mockReset().mockResolvedValue(undefined);
  });

  it('titre, rappel, bouton Se déconnecter et flèche retour vers le Mur', () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'Mes clients' })).toBeInTheDocument();
    expect(
      screen.getByText('Une liste rien que pour toi. Chacun peut refuser de discuter.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByText('écran mur')).toBeInTheDocument();
  });

  it('liste vide : dit comment en ajouter', () => {
    vi.mocked(lireClients).mockReturnValue([]);
    afficher();
    expect(screen.getByText(/Aucun client enregistré/)).toBeInTheDocument();
    expect(screen.getByText(/Enregistrer ce client/)).toBeInTheDocument();
  });

  it('montre chaque client (pseudo et quartier), rangés par pseudo, sans jamais montrer son compte', () => {
    afficher();
    const lignes = screen.getAllByRole('listitem');
    expect(lignes).toHaveLength(2);
    expect(within(lignes[0] as HTMLElement).getByText('abel-7')).toBeInTheDocument();
    expect(within(lignes[0] as HTMLElement).getByText('Akanda')).toBeInTheDocument();
    expect(within(lignes[1] as HTMLElement).getByText('zoé-12')).toBeInTheDocument();
    expect(within(lignes[1] as HTMLElement).getByText('Owendo')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@zoe|@abel|sia\.tail94dc60/);
  });

  it('la liste se met à jour toute seule quand la synchro apporte un changement', () => {
    afficher();
    act(() => changerListe([ABEL]));
    expect(screen.queryByText('zoé-12')).not.toBeInTheDocument();
    expect(screen.getByText('abel-7')).toBeInTheDocument();
  });

  it('« Écrire » ouvre la bulle avec mon pseudo et mon quartier', async () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Écrire à zoé-12' }));
    expect(await screen.findByText('écran bulle')).toBeInTheDocument();
    expect(ecrireA).toHaveBeenCalledWith(CLIENT, ZOE.userId, { pseudo: 'puma', zone: 'Nzeng' });
  });

  it('pendant l’envoi, le bouton dit « Envoi… » et rien d’autre ne part ; un refus rend la main avec un message', async () => {
    const serveur = differe<{ roomId: string; reutilisee: boolean }>();
    vi.mocked(ecrireA).mockReturnValue(serveur.promesse);
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Écrire à zoé-12' }));
    expect(screen.getByRole('button', { name: 'Écrire à zoé-12' })).toHaveTextContent('Envoi…');
    expect(screen.getByRole('button', { name: 'Écrire à zoé-12' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Écrire à abel-7' })).toBeDisabled();

    await act(async () => serveur.rejeter(coupureReseau()));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pas de connexion. Réessaie dans un instant.',
    );
    expect(screen.getByRole('button', { name: 'Écrire à zoé-12' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Écrire à zoé-12' })).toHaveTextContent('Écrire');
    expect(screen.queryByText('écran bulle')).not.toBeInTheDocument();
  });

  it('un autre refus du serveur : message général', async () => {
    vi.mocked(ecrireA).mockRejectedValue(new Error('refusé'));
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Écrire à abel-7' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Un problème est survenu. Réessaie.',
    );
  });

  it('« Écrire » attend que mon profil soit lu (pas de pseudo ni de quartier à envoyer sinon)', () => {
    vi.mocked(useMoi).mockReturnValue({ moi: null, userId: '@moi:sia', chargement: true });
    afficher();
    expect(screen.getByRole('button', { name: 'Écrire à zoé-12' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Écrire à zoé-12' }));
    expect(ecrireA).not.toHaveBeenCalled();
  });

  it('« Retirer » fait disparaître le client tout de suite, avant la réponse du serveur', async () => {
    const serveur = differe();
    vi.mocked(retirerClientEnregistre).mockReturnValue(serveur.promesse);
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer zoé-12 de la liste' }));
    expect(screen.queryByText('zoé-12')).not.toBeInTheDocument();
    expect(screen.getByText('abel-7')).toBeInTheDocument();
    expect(retirerClientEnregistre).toHaveBeenCalledWith(CLIENT, ZOE.userId);
    await act(async () => serveur.resoudre());
    expect(screen.queryByText('zoé-12')).not.toBeInTheDocument();
  });

  it('« Retirer » refusé par le serveur : le client revient avec un message', async () => {
    const serveur = differe();
    vi.mocked(retirerClientEnregistre).mockReturnValue(serveur.promesse);
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer zoé-12 de la liste' }));
    expect(screen.queryByText('zoé-12')).not.toBeInTheDocument();

    await act(async () => serveur.rejeter(coupureReseau()));
    expect(screen.getByText('zoé-12')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pas de connexion. Réessaie dans un instant.',
    );
  });

  it('client Matrix pas encore prêt : « Chargement… »', () => {
    vi.mocked(useMatrix).mockReturnValue({ client: null, etat: 'demarrage' });
    afficher();
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });
});
