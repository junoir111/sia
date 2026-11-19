import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { Bandeau } from '../src/ecrans/bandeau/Bandeau';
import { oublierReponses } from '../src/ecrans/bandeau/reponses';
import { lireDisponible } from '../src/appareil/disponible';
import { accepterOffre, direOui, ecouterBulles, refuserOffre } from '../src/matrix/bulles';
import type { ResumeBulle } from '../src/matrix/bulles';
import { demandesActives, ecouterDemandes, monStatutActif } from '../src/matrix/mur';
import type { DemandeRecue } from '../src/matrix/mur';
import { coupureReseau, differe } from './faux-ecran';

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

const cartes = () => screen.queryAllByRole('region');
const vuesGardees = () => JSON.parse(localStorage.getItem('sia.vues') ?? '[]') as string[];

describe('Bandeau de mise en relation (M1 / M2)', () => {
  beforeEach(() => {
    localStorage.clear();
    oublierReponses();
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
    vi.mocked(direOui).mockReset().mockResolvedValue({ roomId: '!bulle:sia', reutilisee: false });
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
    await vi.waitFor(() => expect(cartes()).toHaveLength(0));
    expect(direOui).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ pseudo: 'palmier-48', budget: 5000 }),
      '$d1',
      {
        pseudo: 'mangue',
        zone: 'Owendo',
      },
    );
    expect(vuesGardees()).toEqual(['$d1']);
  });

  it('Oui avec une bulle déjà ouverte avec ce client : on va dans cette bulle', async () => {
    vi.mocked(direOui).mockResolvedValue({ roomId: '!vieille:sia', reutilisee: true });
    afficher();
    act(() => nouvelleDemande(demande('$d1')));
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    expect(await screen.findByText('écran bulle')).toBeInTheDocument();
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

  it('demande retirée par le client : le bandeau s’en va', () => {
    afficher();
    act(() => nouvelleDemande(demande('$d1')));
    act(() => demandeRetiree('$d1'));
    expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument();
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

  it('invitation directe (« Demander ») : le bandeau dit « vous demande », pas « dit oui »', () => {
    afficher();
    act(() => bullesChangent([{ ...offre('!d:sia', 'mangue-douce'), invitationDirecte: true }]));
    expect(screen.getByText('mangue-douce (Owendo) vous demande')).toBeInTheDocument();
    expect(screen.queryByText(/dit oui/)).not.toBeInTheDocument();
  });

  it('un prestataire t’écrit : le bandeau dit « vous écrit » et Oui ouvre la bulle', async () => {
    afficher();
    act(() =>
      bullesChangent([
        { ...offre('!e:sia', 'mangue-douce'), invitationDirecte: true, invitationEcrit: true },
      ]),
    );
    expect(screen.getByText('mangue-douce (Owendo) vous écrit')).toBeInTheDocument();
    expect(screen.getByText('Tu veux discuter ?')).toBeInTheDocument();
    expect(screen.queryByText(/vous demande|dit oui/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    expect(await screen.findByText('écran bulle')).toBeInTheDocument();
    expect(accepterOffre).toHaveBeenCalledWith(CLIENT, '!e:sia');
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

  describe('retour immédiat au toucher', () => {
    it('Oui sur une demande : la carte passe à « Réponse envoyée… » AVANT la réponse du serveur, puis disparaît', async () => {
      const serveur = differe<{ roomId: string; reutilisee: boolean }>();
      vi.mocked(direOui).mockReturnValue(serveur.promesse);
      afficher();
      act(() => nouvelleDemande(demande('$d1')));

      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));

      // Le serveur n'a pas répondu : l'écran a déjà changé.
      expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();
      expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Oui' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Non' })).not.toBeInTheDocument();
      expect(cartes()).toHaveLength(1);
      expect(vuesGardees()).toEqual([]);

      await act(async () => serveur.resoudre({ roomId: '!bulle:sia', reutilisee: false }));
      expect(cartes()).toHaveLength(0);
      expect(vuesGardees()).toEqual(['$d1']);
    });

    it('pas de double toucher : une seule réponse part', async () => {
      const serveur = differe<{ roomId: string; reutilisee: boolean }>();
      vi.mocked(direOui).mockReturnValue(serveur.promesse);
      afficher();
      act(() => nouvelleDemande(demande('$d1')));
      const oui = screen.getByRole('button', { name: 'Oui' });
      fireEvent.click(oui);
      fireEvent.click(oui);
      await act(async () => undefined); // laisse partir l'envoi
      expect(direOui).toHaveBeenCalledTimes(1);
      await act(async () => serveur.resoudre({ roomId: '!bulle:sia', reutilisee: false }));
      expect(direOui).toHaveBeenCalledTimes(1);
    });

    it('le serveur refuse (pas de réseau) : la carte revient avec un message, et on peut réessayer', async () => {
      const serveur = differe<{ roomId: string; reutilisee: boolean }>();
      vi.mocked(direOui).mockReturnValueOnce(serveur.promesse);
      afficher();
      act(() => nouvelleDemande(demande('$d1')));
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();

      await act(async () => serveur.rejeter(coupureReseau()));
      expect(screen.getByText('Pas de connexion. Réessaie.')).toBeInTheDocument();
      expect(screen.queryByText('Réponse envoyée…')).not.toBeInTheDocument();
      expect(cartes()).toHaveLength(1);
      expect(vuesGardees()).toEqual([]); // pas marquée vue : on peut encore répondre

      // Réessai : cette fois le serveur répond.
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      await vi.waitFor(() => expect(cartes()).toHaveLength(0));
      expect(direOui).toHaveBeenCalledTimes(2);
      expect(vuesGardees()).toEqual(['$d1']);
    });

    it('demande déjà retirée ou expirée côté serveur : la carte s’en va et ne revient pas', async () => {
      vi.mocked(direOui).mockRejectedValue(new Error('Demande introuvable.'));
      afficher();
      act(() => nouvelleDemande(demande('$d1')));
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      await vi.waitFor(() => expect(cartes()).toHaveLength(0));
      expect(vuesGardees()).toEqual(['$d1']);
      act(() => nouvelleDemande(demande('$d1')));
      expect(cartes()).toHaveLength(0);
    });

    it('une demande répondue ne réapparaît jamais, ni par un nouvel envoi du Mur, ni par une relecture', async () => {
      vi.mocked(demandesActives).mockResolvedValue([demande('$d1')]);
      afficher();
      act(() => nouvelleDemande(demande('$d1')));
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      await vi.waitFor(() => expect(cartes()).toHaveLength(0));

      act(() => nouvelleDemande(demande('$d1')));
      await act(async () => {
        window.dispatchEvent(new Event('sia:disponible')); // relecture des demandes en cours
      });
      expect(cartes()).toHaveLength(0);
      expect(screen.queryByText("D'accord ?")).not.toBeInTheDocument();
    });

    it('pendant l’envoi, la même demande reçue de nouveau ne fait pas de seconde carte', async () => {
      const serveur = differe<{ roomId: string; reutilisee: boolean }>();
      vi.mocked(direOui).mockReturnValue(serveur.promesse);
      afficher();
      act(() => nouvelleDemande(demande('$d1')));
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      act(() => nouvelleDemande(demande('$d1')));
      expect(cartes()).toHaveLength(1);
      expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();
      await act(async () => serveur.resoudre({ roomId: '!bulle:sia', reutilisee: false }));
      expect(cartes()).toHaveLength(0);
    });

    it('Non sur une demande : la carte s’en va tout de suite, sans rien envoyer', () => {
      afficher();
      act(() => nouvelleDemande(demande('$d1')));
      fireEvent.click(screen.getByRole('button', { name: 'Non' }));
      expect(cartes()).toHaveLength(0);
      expect(direOui).not.toHaveBeenCalled();
      expect(vuesGardees()).toEqual(['$d1']);
    });

    it('offre : Oui montre « Réponse envoyée… » tout de suite, puis ouvre la bulle quand le serveur confirme', async () => {
      const serveur = differe();
      vi.mocked(accepterOffre).mockReturnValue(serveur.promesse);
      afficher();
      act(() => bullesChangent([offre('!o:sia', 'mangue-douce')]));
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();
      expect(screen.queryByText('écran bulle')).not.toBeInTheDocument();

      await act(async () => serveur.resoudre());
      expect(await screen.findByText('écran bulle')).toBeInTheDocument();
      expect(cartes()).toHaveLength(0);
    });

    it('offre : Non montre « Réponse envoyée… » tout de suite, puis la carte s’en va', async () => {
      const serveur = differe();
      vi.mocked(refuserOffre).mockReturnValue(serveur.promesse);
      afficher();
      act(() => bullesChangent([offre('!o:sia', 'mangue-douce')]));
      fireEvent.click(screen.getByRole('button', { name: 'Non' }));
      expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();
      expect(cartes()).toHaveLength(1);
      await act(async () => serveur.resoudre());
      expect(cartes()).toHaveLength(0);
      expect(refuserOffre).toHaveBeenCalledWith(CLIENT, '!o:sia');
    });

    it('offre : le serveur refuse (pas de réseau) : la carte revient avec un message', async () => {
      const serveur = differe();
      vi.mocked(accepterOffre).mockReturnValueOnce(serveur.promesse);
      afficher();
      act(() => bullesChangent([offre('!o:sia', 'mangue-douce')]));
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      await act(async () => serveur.rejeter(coupureReseau()));
      expect(screen.getByText('Pas de connexion. Réessaie.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Oui' })).toBeInTheDocument();
      expect(screen.queryByText('écran bulle')).not.toBeInTheDocument();
    });

    it('deux offres : Oui sur chacune, les acceptations partent une par une', async () => {
      const premiere = differe();
      vi.mocked(accepterOffre).mockReturnValueOnce(premiere.promesse).mockResolvedValue(undefined);
      afficher();
      act(() => bullesChangent([offre('!a:sia', 'mangue-douce'), offre('!b:sia', 'baobab-12')]));
      const [haut, bas] = cartes() as [HTMLElement, HTMLElement];
      fireEvent.click(within(haut).getByRole('button', { name: 'Oui' }));
      fireEvent.click(within(bas).getByRole('button', { name: 'Oui' }));
      // Les deux cartes ont changé d'état tout de suite ; une seule acceptation est partie.
      expect(screen.getAllByText('Réponse envoyée…')).toHaveLength(2);
      await act(async () => undefined); // laisse partir l'envoi
      expect(accepterOffre).toHaveBeenCalledTimes(1);

      await act(async () => premiere.resoudre());
      await vi.waitFor(() => expect(accepterOffre).toHaveBeenCalledTimes(2));
    });
  });

  describe('pile d’alertes', () => {
    it('deux alertes s’empilent : la plus récente en haut', () => {
      afficher();
      act(() => {
        nouvelleDemande(demande('$d1', 'palmier-48'));
        nouvelleDemande(demande('$d2', 'ibis-3'));
      });
      const pile = cartes();
      expect(pile).toHaveLength(2);
      expect(within(pile[0] as HTMLElement).getByText(/ibis-3/)).toBeInTheDocument();
      expect(within(pile[1] as HTMLElement).getByText(/palmier-48/)).toBeInTheDocument();
    });

    it('trois au plus visibles : les plus récentes ; la plus ancienne attend son tour', () => {
      afficher();
      act(() => {
        nouvelleDemande(demande('$d1', 'ancien-1'));
        nouvelleDemande(demande('$d2', 'milieu-2'));
        nouvelleDemande(demande('$d3', 'milieu-3'));
        nouvelleDemande(demande('$d4', 'recent-4'));
      });
      const pile = cartes();
      expect(pile).toHaveLength(3);
      expect(pile.map((c) => /recent-4|milieu-3|milieu-2/.exec(c.textContent ?? '')?.[0])).toEqual([
        'recent-4',
        'milieu-3',
        'milieu-2',
      ]);
      expect(screen.queryByText(/ancien-1/)).not.toBeInTheDocument();

      // Une place se libère : la plus ancienne arrive, en bas de la pile.
      fireEvent.click(within(pile[0] as HTMLElement).getByRole('button', { name: 'Non' }));
      const suite = cartes();
      expect(suite).toHaveLength(3);
      expect(within(suite[2] as HTMLElement).getByText(/ancien-1/)).toBeInTheDocument();
    });

    it('répondre à une carte ne touche pas les autres', async () => {
      const serveur = differe<{ roomId: string; reutilisee: boolean }>();
      vi.mocked(direOui).mockReturnValue(serveur.promesse);
      afficher();
      act(() => {
        nouvelleDemande(demande('$d1', 'palmier-48'));
        nouvelleDemande(demande('$d2', 'ibis-3'));
      });
      const [haut, bas] = cartes() as [HTMLElement, HTMLElement];
      fireEvent.click(within(haut).getByRole('button', { name: 'Oui' }));
      expect(within(haut).getByText('Réponse envoyée…')).toBeInTheDocument();
      expect(within(bas).getByText("D'accord ?")).toBeInTheDocument();
      expect(within(bas).getByRole('button', { name: 'Oui' })).toBeEnabled();
      await act(async () => serveur.resoudre({ roomId: '!bulle:sia', reutilisee: false }));
      expect(cartes()).toHaveLength(1);
    });

    it('une vibration par nouvelle alerte, pas quand une autre s’en va', () => {
      afficher();
      act(() => nouvelleDemande(demande('$d1', 'palmier-48')));
      expect(navigator.vibrate).toHaveBeenCalledTimes(1);
      act(() => nouvelleDemande(demande('$d2', 'ibis-3')));
      expect(navigator.vibrate).toHaveBeenCalledTimes(2);
      fireEvent.click(within(cartes()[0] as HTMLElement).getByRole('button', { name: 'Non' }));
      expect(navigator.vibrate).toHaveBeenCalledTimes(2);
    });
  });
});
