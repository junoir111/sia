import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { commencerReponse, oublierReponses } from '../src/ecrans/bandeau/reponses';
import { Bulles } from '../src/ecrans/bulles/Bulles';
import { accepterOffre, ecouterBulles, listerBulles, refuserOffre } from '../src/matrix/bulles';
import type { ResumeBulle } from '../src/matrix/bulles';
import { clientEcran, coupureReseau, differe } from './faux-ecran';

// Jamais le vrai serveur : le client Matrix et les bulles sont simulés.
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/matrix/bulles', () => ({
  ecouterBulles: vi.fn(() => () => undefined),
  listerBulles: vi.fn(),
  accepterOffre: vi.fn(),
  refuserOffre: vi.fn(),
}));

const FAUX = clientEcran();
const CLIENT = FAUX as never;

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
    oublierReponses();
    FAUX.changerSynchro('SYNCING');
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(ecouterBulles)
      .mockReset()
      .mockImplementation(() => () => undefined);
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

  describe('retour immédiat au toucher', () => {
    const offreRecue = () =>
      vi
        .mocked(listerBulles)
        .mockReturnValue([bulle({ roomId: '!o:sia', pseudo: 'mangue', etat: 'invitation-recue' })]);

    it('Oui : « Réponse envoyée… » tout de suite, la bulle s’ouvre quand le serveur confirme', async () => {
      const serveur = differe();
      vi.mocked(accepterOffre).mockReturnValue(serveur.promesse);
      offreRecue();
      afficher();
      fireEvent.click(screen.getByRole('button', { name: /mangue/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));

      expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Oui' })).not.toBeInTheDocument();
      expect(screen.queryByText('écran bulle')).not.toBeInTheDocument();

      await act(async () => serveur.resoudre());
      expect(await screen.findByText('écran bulle')).toBeInTheDocument();
    });

    it('pas de double toucher : une seule réponse part', async () => {
      const serveur = differe();
      vi.mocked(accepterOffre).mockReturnValue(serveur.promesse);
      offreRecue();
      afficher();
      fireEvent.click(screen.getByRole('button', { name: /mangue/ }));
      const oui = screen.getByRole('button', { name: 'Oui' });
      fireEvent.click(oui);
      fireEvent.click(oui);
      await act(async () => undefined); // laisse partir l'envoi
      expect(accepterOffre).toHaveBeenCalledTimes(1);
      await act(async () => serveur.resoudre());
    });

    it('Non : « Réponse envoyée… » tout de suite, la ligne s’efface dès que le serveur confirme', async () => {
      const serveur = differe();
      vi.mocked(refuserOffre).mockReturnValue(serveur.promesse);
      offreRecue();
      afficher();
      fireEvent.click(screen.getByRole('button', { name: /mangue/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Non' }));
      expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /mangue/ })).toBeInTheDocument();

      await act(async () => serveur.resoudre());
      expect(screen.queryByRole('button', { name: /mangue/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Réponse envoyée…')).not.toBeInTheDocument();
    });

    it('le serveur refuse (pas de réseau) : la ligne revient avec un message, on peut réessayer', async () => {
      const serveur = differe();
      vi.mocked(accepterOffre).mockReturnValueOnce(serveur.promesse);
      offreRecue();
      afficher();
      fireEvent.click(screen.getByRole('button', { name: /mangue/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      await act(async () => serveur.rejeter(coupureReseau()));

      expect(screen.getByText('Pas de connexion. Réessaie.')).toBeInTheDocument();
      expect(screen.queryByText('Réponse envoyée…')).not.toBeInTheDocument();
      expect(screen.queryByText('écran bulle')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
      expect(await screen.findByText('écran bulle')).toBeInTheDocument();
      expect(accepterOffre).toHaveBeenCalledTimes(2);
    });

    it('autre problème du serveur : la ligne le dit et reste', async () => {
      vi.mocked(refuserOffre).mockRejectedValue(new Error('refusé'));
      offreRecue();
      afficher();
      fireEvent.click(screen.getByRole('button', { name: /mangue/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Non' }));
      expect(await screen.findByText('Un problème est survenu. Réessaie.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Non' })).toBeInTheDocument();
    });

    it('réponse donnée depuis le bandeau : la ligne la montre aussi, sans second envoi possible', () => {
      offreRecue();
      afficher();
      act(() => {
        commencerReponse('!o:sia');
      });
      expect(screen.getByText('Réponse envoyée…')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Oui' })).not.toBeInTheDocument();
      expect(accepterOffre).not.toHaveBeenCalled();
    });
  });

  describe('liste vivante', () => {
    it('une bulle qui arrive s’ajoute seule, sans toucher ni recharger', () => {
      let changer: (liste: ResumeBulle[]) => void = () => undefined;
      vi.mocked(ecouterBulles).mockImplementation((_c, rappel) => {
        changer = rappel;
        return () => undefined;
      });
      afficher();
      expect(screen.getByText("Aucune bulle pour l'instant.")).toBeInTheDocument();
      act(() => changer([bulle({ roomId: '!n:sia', pseudo: 'ibis-3' })]));
      expect(screen.getByRole('button', { name: /ibis-3/ })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /actualiser|recharger/i }),
      ).not.toBeInTheDocument();
    });

    it('« Mise à jour… » pendant que le client rattrape ses événements, puis plus rien', () => {
      afficher();
      expect(screen.queryByText('Mise à jour…')).not.toBeInTheDocument();
      act(() => FAUX.changerSynchro('CATCHUP'));
      expect(screen.getByText('Mise à jour…')).toBeInTheDocument();
      act(() => FAUX.changerSynchro('SYNCING'));
      expect(screen.queryByText('Mise à jour…')).not.toBeInTheDocument();
    });

    it('« Mise à jour… » aussi pendant que le client se reconnecte', () => {
      afficher();
      act(() => FAUX.changerSynchro('RECONNECTING'));
      expect(screen.getByText('Mise à jour…')).toBeInTheDocument();
    });

    it('la zone de « Mise à jour… » existe déjà : le titre ne bouge pas quand le texte arrive', () => {
      afficher();
      const zone = screen.getByRole('heading', { name: 'Bulles' }).nextElementSibling;
      expect(zone).toHaveAttribute('aria-live', 'polite');
      act(() => FAUX.changerSynchro('CATCHUP'));
      expect(screen.getByRole('heading', { name: 'Bulles' }).nextElementSibling).toBe(zone);
    });
  });
});
