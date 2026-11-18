import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { Bulles } from '../src/ecrans/bulles/Bulles';
import { accepterOffre, listerBulles, refuserOffre } from '../src/matrix/bulles';
import type { ResumeBulle } from '../src/matrix/bulles';

// Jamais le vrai serveur : le client Matrix et les bulles sont simulés.
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/matrix/bulles', () => ({
  ecouterBulles: vi.fn(() => () => undefined),
  listerBulles: vi.fn(),
  accepterOffre: vi.fn(),
  refuserOffre: vi.fn(),
}));

const CLIENT = { simule: true } as never;

function bulle(o: Partial<ResumeBulle> & { roomId: string; pseudo: string }): ResumeBulle {
  return {
    roomId: o.roomId,
    autre: { pseudo: o.pseudo, zone: 'Owendo' },
    demande: o.demande ?? {
      annonce: '$d',
      service: 'Plombier',
      zone: 'Akanda',
      budget: 5000,
      texte: '',
    },
    etat: o.etat ?? 'ouverte',
    nonLus: o.nonLus ?? 0,
    autreEcrit: o.autreEcrit ?? false,
  };
}

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.bulles]}>
      <Routes>
        <Route path={CHEMINS.bulles} element={<Bulles />} />
        <Route path={CHEMINS.bulle} element={<p>écran bulle</p>} />
        <Route path={CHEMINS.mur} element={<p>écran mur</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Écran Bulles (M3)', () => {
  beforeEach(() => {
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(listerBulles).mockReset().mockReturnValue([]);
    vi.mocked(accepterOffre).mockReset().mockResolvedValue(undefined);
    vi.mocked(refuserOffre).mockReset().mockResolvedValue(undefined);
  });

  it('montre le bouton Se déconnecter', () => {
    afficher();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
  });

  it('titre, rappel et liste vide', () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'Bulles' })).toBeInTheDocument();
    expect(screen.getByText("Les messages s'effacent après 1 minute.")).toBeInTheDocument();
    expect(screen.getByText("Aucune bulle pour l'instant.")).toBeInTheDocument();
  });

  it('lignes : pseudo, quartier · somme, états et non lus', () => {
    vi.mocked(listerBulles).mockReturnValue([
      bulle({ roomId: '!a:sia', pseudo: 'palmier-48', autreEcrit: true, nonLus: 2 }),
      bulle({ roomId: '!b:sia', pseudo: 'cocotier-12', etat: 'en-attente' }),
    ]);
    afficher();
    const lignes = screen.getAllByRole('listitem');
    expect(lignes).toHaveLength(2);
    const [premiere, seconde] = lignes as [HTMLElement, HTMLElement];
    expect(within(premiere).getByText('palmier-48')).toBeInTheDocument();
    expect(within(premiere).getByText(/Akanda · 5\s000 FCFA/)).toBeInTheDocument();
    expect(within(premiere).getByText("en train d'écrire…")).toBeInTheDocument();
    expect(within(premiere).getByText('2')).toBeInTheDocument();
    expect(within(seconde).getByText('en attente')).toBeInTheDocument();
  });

  it('toucher une bulle ouvre la bulle', () => {
    vi.mocked(listerBulles).mockReturnValue([bulle({ roomId: '!a:sia', pseudo: 'palmier-48' })]);
    afficher();
    fireEvent.click(screen.getByRole('button', { name: /palmier-48/ }));
    expect(screen.getByText('écran bulle')).toBeInTheDocument();
  });

  it('offre reçue : toucher montre Non / Oui ; Oui accepte et ouvre la bulle', async () => {
    vi.mocked(listerBulles).mockReturnValue([
      bulle({ roomId: '!o:sia', pseudo: 'mangue', etat: 'invitation-recue' }),
    ]);
    afficher();
    fireEvent.click(screen.getByRole('button', { name: /mangue/ }));
    expect(screen.getByText('Tu veux discuter ?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    expect(await screen.findByText('écran bulle')).toBeInTheDocument();
    expect(accepterOffre).toHaveBeenCalledWith(CLIENT, '!o:sia');
  });

  it('invitation directe (un client te demande) : « vous demande » au lieu de « dit oui »', () => {
    vi.mocked(listerBulles).mockReturnValue([
      {
        ...bulle({ roomId: '!d:sia', pseudo: 'palmier-48', etat: 'invitation-recue' }),
        demande: null,
        invitationDirecte: true,
      },
      bulle({ roomId: '!o:sia', pseudo: 'mangue', etat: 'invitation-recue' }),
    ]);
    afficher();
    expect(screen.getByText('vous demande')).toBeInTheDocument();
    expect(screen.getByText('dit oui')).toBeInTheDocument();
  });

  it('offre reçue : Non la refuse', async () => {
    vi.mocked(listerBulles).mockReturnValue([
      bulle({ roomId: '!o:sia', pseudo: 'mangue', etat: 'invitation-recue' }),
    ]);
    afficher();
    fireEvent.click(screen.getByRole('button', { name: /mangue/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Non' }));
    await vi.waitFor(() => expect(refuserOffre).toHaveBeenCalledWith(CLIENT, '!o:sia'));
  });

  it('pas de réseau au démarrage : bandeau', () => {
    vi.mocked(useMatrix).mockReturnValue({ client: null, etat: 'erreur-reseau' });
    afficher();
    expect(screen.getByRole('alert')).toHaveTextContent('Pas de connexion.');
  });

  it('flèche retour : le Mur', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByText('écran mur')).toBeInTheDocument();
  });
});
