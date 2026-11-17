import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { Bandeau } from '../src/ecrans/bandeau/Bandeau';
import { lireDisponible } from '../src/appareil/disponible';
import { accepterOffre, direOui, ecouterBulles, refuserOffre } from '../src/matrix/bulles';
import type { ResumeBulle } from '../src/matrix/bulles';
import { demandesActives, ecouterDemandes, monStatutActif } from '../src/matrix/mur';
import type { DemandeRecue } from '../src/matrix/mur';

// Jamais le vrai serveur : Mur, bulles et client Matrix sont simulés.
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/appareil/disponible', () => ({ lireDisponible: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn(() => null) }));
vi.mock('../src/matrix/profil', () => ({ lireProfil: vi.fn() }));
vi.mock('../src/matrix/mur', () => ({
  ecouterDemandes: vi.fn(),
  demandesActives: vi.fn(),
  monStatutActif: vi.fn(),
}));
vi.mock('../src/matrix/bulles', () => ({
  ecouterBulles: vi.fn(),
  direOui: vi.fn(),
  accepterOffre: vi.fn(),
  refuserOffre: vi.fn(),
}));

const MOI = '@mangue:sia';
const CLIENT = { getUserId: () => MOI } as never;
let nouvelleDemande: (d: DemandeRecue) => void = () => undefined;
let demandeRetiree: (id: string) => void = () => undefined;
let bullesChangent: (b: ResumeBulle[]) => void = () => undefined;

function demande(id: string, pseudo = 'palmier-48'): DemandeRecue {
  const d = {
    pseudo,
    service: 'Plombier',
    zone: 'Akanda',
    texte: '',
    budget: 5000,
    fin: Date.now() + 3_600_000,
  };
  return { eventId: id, expediteur: '@client:sia', demande: d, contenu: { role: 'client', ...d } };
}

function offre(roomId: string, pseudo: string): ResumeBulle {
  return {
    roomId,
    autre: { pseudo, zone: 'Owendo' },
    demande: null,
    etat: 'invitation-recue',
    nonLus: 0,
    autreEcrit: false,
  };
}

function afficher() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Bandeau />
      <Routes>
        <Route path="/" element={<p>écran du dessous</p>} />
        <Route path={CHEMINS.bulle} element={<p>écran bulle</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Bandeau de mise en relation (M1 / M2)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(lireDisponible).mockReturnValue(false);
    vi.mocked(monStatutActif).mockReturnValue({
      eventId: '$statut',
      statut: { pseudo: 'mangue', metier: 'Plombier', zone: 'Owendo', fin: Date.now() + 60_000 },
    });
    vi.mocked(demandesActives).mockReset().mockResolvedValue([]);
    vi.mocked(ecouterDemandes).mockImplementation((_c, rappel, retrait) => {
      nouvelleDemande = rappel;
      demandeRetiree = retrait ?? (() => undefined);
      return () => undefined;
    });
    vi.mocked(ecouterBulles).mockImplementation((_c, rappel) => {
      bullesChangent = rappel;
      return () => undefined;
    });
    vi.mocked(direOui).mockReset().mockResolvedValue('!bulle:sia');
    vi.mocked(accepterOffre).mockReset().mockResolvedValue(undefined);
    vi.mocked(refuserOffre).mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('rien tant qu’il n’y a rien', () => {
    afficher();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('prestataire disponible : la demande s’affiche, vibre, Oui crée la bulle', async () => {
    afficher();
    act(() => nouvelleDemande(demande('$d1')));
    expect(screen.getByText(/palmier-48 · Akanda · 5\s000 FCFA · Plombier/)).toBeInTheDocument();
    expect(screen.getByText("D'accord ?")).toBeInTheDocument();
    expect(navigator.vibrate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    await vi.waitFor(() => expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument());
    expect(direOui).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ pseudo: 'palmier-48', budget: 5000 }),
      '$d1',
      {
        pseudo: 'mangue',
        zone: 'Owendo',
      },
    );
    expect(JSON.parse(localStorage.getItem('sia.vues') ?? '[]')).toEqual(['$d1']);
  });

  it('Non : marquée vue, plus jamais proposée', async () => {
    afficher();
    act(() => nouvelleDemande(demande('$d1')));
    fireEvent.click(screen.getByRole('button', { name: 'Non' }));
    await vi.waitFor(() => expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument());
    act(() => nouvelleDemande(demande('$d1')));
    expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument();
    expect(direOui).not.toHaveBeenCalled();
  });

  it('pas disponible : rien', () => {
    vi.mocked(monStatutActif).mockReturnValue(null);
    afficher();
    act(() => nouvelleDemande(demande('$d1')));
    expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument();
  });

  it('un seul bandeau à la fois, les suivants attendent', async () => {
    afficher();
    act(() => {
      nouvelleDemande(demande('$d1', 'palmier-48'));
      nouvelleDemande(demande('$d2', 'ibis-3'));
    });
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByText(/palmier-48/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Non' }));
    expect(await screen.findByText(/ibis-3/)).toBeInTheDocument();
  });

  it('demande retirée par le client : le bandeau s’en va', () => {
    afficher();
    act(() => nouvelleDemande(demande('$d1')));
    act(() => demandeRetiree('$d1'));
    expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument();
  });

  it('pas de réseau en disant oui : le bandeau reste avec un message', async () => {
    vi.mocked(direOui).mockRejectedValue(
      Object.assign(new Error('x'), { name: 'ConnectionError' }),
    );
    afficher();
    act(() => nouvelleDemande(demande('$d1')));
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    expect(await screen.findByText('Pas de connexion. Réessaie.')).toBeInTheDocument();
  });

  it('client : offre reçue, Oui accepte et ouvre la bulle', async () => {
    afficher();
    act(() => bullesChangent([offre('!o:sia', 'mangue-douce')]));
    expect(screen.getByText('mangue-douce (Owendo) dit oui')).toBeInTheDocument();
    expect(screen.getByText('Tu veux discuter ?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    expect(await screen.findByText('écran bulle')).toBeInTheDocument();
    expect(accepterOffre).toHaveBeenCalledWith(CLIENT, '!o:sia');
  });

  it('client : Oui prévient la page client que le choix est fait', async () => {
    const surChoix = vi.fn();
    window.addEventListener('sia:choisi', surChoix);
    afficher();
    act(() => bullesChangent([offre('!o:sia', 'mangue-douce')]));
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    await screen.findByText('écran bulle');
    window.removeEventListener('sia:choisi', surChoix);
    expect(surChoix).toHaveBeenCalledTimes(1);
  });

  it('client : Non refuse l’offre', async () => {
    afficher();
    act(() => bullesChangent([offre('!o:sia', 'mangue-douce')]));
    fireEvent.click(screen.getByRole('button', { name: 'Non' }));
    await vi.waitFor(() => expect(refuserOffre).toHaveBeenCalledWith(CLIENT, '!o:sia'));
  });

  it('offre acceptée ailleurs (liste des bulles) : le bandeau disparaît', () => {
    afficher();
    act(() => bullesChangent([offre('!o:sia', 'mangue-douce')]));
    act(() => bullesChangent([]));
    expect(screen.queryByText('Tu veux discuter ?')).not.toBeInTheDocument();
  });
});
