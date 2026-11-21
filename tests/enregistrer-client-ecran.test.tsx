import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { EnregistrerClient } from '../src/ecrans/bulle/EnregistrerClient';
import { useMoi } from '../src/ecrans/mur/useMoi';
import type { ContactClient } from '../src/logique/clients';
import { autreDeBulle } from '../src/matrix/bulles';
import {
  clientEnregistre,
  ecouterClients,
  enregistrerClient,
  lireClients,
} from '../src/matrix/clients';
import { clientEcran, coupureReseau, differe } from './faux-ecran';

// Jamais le vrai serveur : le client Matrix, la bulle, la liste et le profil sont simulés.
vi.mock('../src/ecrans/mur/useMoi', () => ({ useMoi: vi.fn() }));
vi.mock('../src/matrix/bulles', () => ({ autreDeBulle: vi.fn() }));
vi.mock('../src/matrix/clients', () => ({
  clientEnregistre: vi.fn(),
  ecouterClients: vi.fn(),
  enregistrerClient: vi.fn(),
  lireClients: vi.fn(),
}));

const CLIENT = clientEcran() as never;
const BULLE = '!bulle:sia.tail94dc60.ts.net';
const AUTRE = { userId: '@autre:sia.tail94dc60.ts.net', pseudo: 'palmier-48', zone: 'Akanda' };

let changerListe: (liste: ContactClient[]) => void = () => undefined;

function afficher() {
  render(
    <MemoryRouter>
      <EnregistrerClient client={CLIENT} roomId={BULLE} />
    </MemoryRouter>,
  );
}

const bouton = () => screen.getByRole('button', { name: 'Enregistrer ce client' });

describe('Bouton « Enregistrer ce client » dans la bulle', () => {
  beforeEach(() => {
    vi.mocked(useMoi).mockReturnValue({
      moi: { role: 'prestataire', pseudo: 'puma', zone: 'Nzeng' },
      userId: '@moi:sia',
      chargement: false,
    });
    vi.mocked(autreDeBulle).mockReset().mockReturnValue(AUTRE);
    vi.mocked(clientEnregistre).mockReset().mockReturnValue(false);
    vi.mocked(lireClients).mockReset().mockReturnValue([]);
    vi.mocked(ecouterClients)
      .mockReset()
      .mockImplementation((_c, rappel) => {
        changerListe = rappel;
        return () => undefined;
      });
    vi.mocked(enregistrerClient).mockReset().mockResolvedValue(undefined);
  });

  it('prestataire, l’autre a accepté : le bouton est là', () => {
    afficher();
    expect(bouton()).toBeInTheDocument();
  });

  it('rien pour un client', () => {
    vi.mocked(useMoi).mockReturnValue({
      moi: { role: 'client', pseudo: 'palmier-48', zone: 'Akanda' },
      userId: '@moi:sia',
      chargement: false,
    });
    afficher();
    expect(screen.queryByRole('button', { name: 'Enregistrer ce client' })).not.toBeInTheDocument();
    expect(autreDeBulle).not.toHaveBeenCalled();
  });

  it('rien tant que mon profil n’est pas lu', () => {
    vi.mocked(useMoi).mockReturnValue({ moi: null, userId: '@moi:sia', chargement: true });
    afficher();
    expect(screen.queryByRole('button', { name: 'Enregistrer ce client' })).not.toBeInTheDocument();
  });

  it('rien tant que l’autre n’a pas accepté de discuter', () => {
    vi.mocked(autreDeBulle).mockReturnValue(null);
    afficher();
    expect(screen.queryByRole('button', { name: 'Enregistrer ce client' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Client enregistré/)).not.toBeInTheDocument();
  });

  it('au toucher : « Client enregistré » tout de suite, avant la réponse du serveur, avec le lien vers Mes clients', async () => {
    const serveur = differe();
    vi.mocked(enregistrerClient).mockReturnValue(serveur.promesse);
    afficher();
    fireEvent.click(bouton());

    expect(screen.getByText(/Client enregistré/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer ce client' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mes clients' })).toHaveAttribute(
      'href',
      CHEMINS.clients,
    );
    expect(enregistrerClient).toHaveBeenCalledWith(CLIENT, BULLE);
    await act(async () => serveur.resoudre());
    expect(screen.getByText(/Client enregistré/)).toBeInTheDocument();
  });

  it('le serveur refuse (pas de réseau) : le bouton revient avec un message', async () => {
    const serveur = differe();
    vi.mocked(enregistrerClient).mockReturnValue(serveur.promesse);
    afficher();
    fireEvent.click(bouton());
    await act(async () => serveur.rejeter(coupureReseau()));
    expect(bouton()).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pas de réseau. Réessaie dans un instant.',
    );
    expect(screen.queryByText(/Client enregistré/)).not.toBeInTheDocument();
  });

  it('un autre refus du serveur : message général, et on peut réessayer', async () => {
    vi.mocked(enregistrerClient).mockRejectedValueOnce(new Error('refusé'));
    afficher();
    fireEvent.click(bouton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ça n’a pas marché. Réessaie.',
    );
    fireEvent.click(bouton());
    expect(screen.getByText(/Client enregistré/)).toBeInTheDocument();
    expect(enregistrerClient).toHaveBeenCalledTimes(2);
  });

  it('déjà dans ma liste : « Client enregistré » d’emblée, sans bouton', () => {
    vi.mocked(clientEnregistre).mockReturnValue(true);
    afficher();
    expect(screen.getByText(/Client enregistré/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer ce client' })).not.toBeInTheDocument();
  });

  it('la liste change (synchro) : l’affichage suit tout seul', () => {
    afficher();
    expect(bouton()).toBeInTheDocument();
    vi.mocked(clientEnregistre).mockReturnValue(true);
    act(() => changerListe([AUTRE]));
    expect(screen.getByText(/Client enregistré/)).toBeInTheDocument();
  });
});
