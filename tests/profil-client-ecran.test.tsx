import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { oublierChoix, signalerChoix } from '../src/ecrans/bandeau/signal';
import { ProfilClient } from '../src/ecrans/profil-client/ProfilClient';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { listerBulles } from '../src/matrix/bulles';
import type { ResumeBulle } from '../src/matrix/bulles';
import { publierDemande, retirerDemande } from '../src/matrix/mur';
import { enregistrerProfilClient, lireProfilClient } from '../src/matrix/profil';
import { lireSession } from '../src/matrix/session';
import { coupureReseau, differe } from './faux-ecran';

// Jamais le vrai serveur : tout le réseau Matrix est simulé.
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn() }));
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/matrix/profil', () => ({
  lireProfilClient: vi.fn(),
  enregistrerProfilClient: vi.fn(),
  lirePseudoEnregistre: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../src/matrix/bulles', () => ({
  ecouterBulles: vi.fn(() => () => undefined),
  listerBulles: vi.fn(() => []),
}));
vi.mock('../src/matrix/mur', () => ({ publierDemande: vi.fn(), retirerDemande: vi.fn() }));

const SESSION = {
  userId: '@palmier-48:sia.tail94dc60.ts.net',
  accessToken: 'jeton-test',
  deviceId: 'APPAREIL',
};
const CLIENT = { simule: true } as never;

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.profilClient]}>
      <Routes>
        <Route path={CHEMINS.profilClient} element={<ProfilClient />} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
        <Route path={CHEMINS.bulles} element={<p>écran bulles</p>} />
        <Route path={CHEMINS.mur} element={<p>écran mur</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Demande déjà partie, gardée sur le téléphone (la page reste ouverte dessus). */
function semerDemande() {
  localStorage.setItem(
    'sia.demande',
    JSON.stringify({
      eventId: '$demande1',
      demande: {
        pseudo: 'palmier-48',
        service: 'Plombier',
        zone: 'Akanda',
        texte: '',
        budget: 5000,
        fin: Date.now() + 3_600_000,
      },
    }),
  );
}

const boutonSia = () => screen.getByRole('button', { name: 'SIA' });

function remplir() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Quartier' }), {
    target: { value: 'Akanda' },
  });
  fireEvent.change(screen.getByLabelText('De quoi as-tu besoin ?'), {
    target: { value: 'Plombier' },
  });
  fireEvent.change(screen.getByLabelText('Ton budget, en FCFA'), { target: { value: '5000' } });
  fireEvent.change(screen.getByLabelText('Précise ton besoin (facultatif)'), {
    target: { value: "Fuite sous l'évier, ce soir" },
  });
}

describe('Écran Page client (E6)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(lireSession).mockReturnValue(SESSION);
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(listerBulles).mockReturnValue([]);
    vi.mocked(lireProfilClient).mockReset().mockResolvedValue({ ok: true, profil: null });
    vi.mocked(enregistrerProfilClient).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(publierDemande).mockReset().mockResolvedValue('$demande1');
    vi.mocked(retirerDemande).mockReset().mockResolvedValue(undefined);
  });

  it('affiche le pseudo proposé, l’initiale, « Client » et SIA inactif', () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'Ton profil' })).toBeInTheDocument();
    expect(screen.getByText('palmier-48')).toBeInTheDocument();
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('Client')).toBeInTheDocument();
    expect(boutonSia()).toBeDisabled();
  });

  it('montre le bouton Se déconnecter', () => {
    afficher();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
  });

  it('sans session : retour à l’accueil', () => {
    vi.mocked(lireSession).mockReturnValue(null);
    afficher();
    expect(screen.getByText('écran accueil')).toBeInTheDocument();
  });

  it('formate le budget en quittant le champ', () => {
    afficher();
    const budget = screen.getByLabelText('Ton budget, en FCFA');
    fireEvent.change(budget, { target: { value: '25000' } });
    fireEvent.blur(budget);
    expect(budget).toHaveValue('25 000');
  });

  it('publie la demande puis arrive sur le Mur', async () => {
    afficher();
    remplir();
    expect(boutonSia()).toBeEnabled();
    const avant = Date.now();
    fireEvent.click(boutonSia());

    expect(await screen.findByText('écran mur')).toBeInTheDocument();
    const [client, demande] = vi.mocked(publierDemande).mock.calls[0] ?? [];
    expect(client).toBe(CLIENT);
    expect(demande).toMatchObject({
      pseudo: 'palmier-48',
      zone: 'Akanda',
      service: 'Plombier',
      budget: 5000,
      texte: "Fuite sous l'évier, ce soir",
    });
    expect(demande?.fin).toBeGreaterThanOrEqual(avant + 7_200_000);
    expect(JSON.parse(localStorage.getItem('sia.demande') ?? '{}')).toMatchObject({
      eventId: '$demande1',
    });
  });

  it('demande déjà partie : un toucher sur SIA la retire', async () => {
    semerDemande();
    afficher();
    fireEvent.click(boutonSia());
    expect(await screen.findByText('Ta demande est retirée.')).toBeInTheDocument();
    expect(retirerDemande).toHaveBeenCalledWith(CLIENT, '$demande1');
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('sia.demande')).toBeNull();
  });

  it('offre acceptée dans le bandeau : la page repasse au gris « Tu as choisi. »', () => {
    semerDemande();
    afficher();
    act(() => signalerChoix());
    expect(screen.getByText('Tu as choisi.')).toBeInTheDocument();
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
    oublierChoix();
  });

  it('demande modifiée après l’envoi : l’ancienne est retirée, la nouvelle publiée', async () => {
    semerDemande();
    afficher();
    vi.mocked(publierDemande).mockResolvedValue('$demande2');
    fireEvent.change(screen.getByLabelText('Ton budget, en FCFA'), { target: { value: '8000' } });
    expect(screen.getByText('Touche SIA pour envoyer ta nouvelle demande.')).toBeInTheDocument();
    fireEvent.click(boutonSia());
    expect(await screen.findByText('écran mur')).toBeInTheDocument();
    expect(retirerDemande).toHaveBeenCalledWith(CLIENT, '$demande1');
    expect(publierDemande).toHaveBeenLastCalledWith(
      CLIENT,
      expect.objectContaining({ budget: 8000 }),
    );
  });

  it('client Matrix pas encore prêt : bandeau réseau, rien n’est publié', async () => {
    vi.mocked(useMatrix).mockReturnValue({ client: null, etat: 'demarrage' });
    afficher();
    remplir();
    fireEvent.click(boutonSia());
    expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
    expect(publierDemande).not.toHaveBeenCalled();
  });

  it('enregistre le profil client (pseudo et quartier) en publiant', async () => {
    afficher();
    remplir();
    fireEvent.click(boutonSia());
    await screen.findByText('écran mur');
    expect(enregistrerProfilClient).toHaveBeenCalledWith(SESSION, {
      version: 1,
      role: 'client',
      pseudo: 'palmier-48',
      zone: 'Akanda',
    });
  });

  it('reprend le pseudo et le quartier enregistrés', async () => {
    vi.mocked(lireProfilClient).mockResolvedValue({
      ok: true,
      profil: { version: 1, role: 'client', pseudo: 'ibis-3', zone: 'Lalala' },
    });
    afficher();
    expect(await screen.findByText('ibis-3')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Quartier' })).toHaveValue('Lalala');
  });

  it('budget illisible : SIA reste gris, rien n’est envoyé', () => {
    afficher();
    remplir();
    fireEvent.change(screen.getByLabelText('Ton budget, en FCFA'), {
      target: { value: 'pas cher' },
    });
    expect(boutonSia()).toBeDisabled();
    fireEvent.click(boutonSia());
    expect(publierDemande).not.toHaveBeenCalled();
  });

  it('pas de réseau : bandeau qui dit quoi faire, bouton reste gris', async () => {
    vi.mocked(publierDemande).mockRejectedValue(
      Object.assign(new Error('fetch failed'), { name: 'ConnectionError' }),
    );
    afficher();
    remplir();
    fireEvent.click(boutonSia());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pas de connexion. Réessaie dans un instant.',
    );
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
  });

  it('session expirée : retour à l’accueil', async () => {
    vi.mocked(publierDemande).mockRejectedValue({ errcode: 'M_UNKNOWN_TOKEN', httpStatus: 401 });
    afficher();
    remplir();
    fireEvent.click(boutonSia());
    expect(await screen.findByText('écran accueil')).toBeInTheDocument();
  });

  it('demande déjà partie (gardée sur le téléphone) : bouton vert et champs remplis', () => {
    localStorage.setItem(
      'sia.demande',
      JSON.stringify({
        eventId: '$ancienne',
        demande: {
          pseudo: 'palmier-48',
          service: 'Coiffure',
          zone: 'Owendo',
          texte: '',
          budget: 10000,
          fin: Date.now() + 60_000,
        },
      }),
    );
    afficher();
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Ta demande est partie.')).toBeInTheDocument();
    expect(screen.getByLabelText('Ton budget, en FCFA')).toHaveValue('10 000');
    expect(screen.getByLabelText('De quoi as-tu besoin ?')).toHaveValue('Coiffure');
  });

  it('demande expirée : oubliée', () => {
    localStorage.setItem(
      'sia.demande',
      JSON.stringify({
        eventId: '$vieille',
        demande: {
          pseudo: 'palmier-48',
          service: 'Coiffure',
          zone: 'Owendo',
          texte: '',
          budget: 10000,
          fin: Date.now() - 1,
        },
      }),
    );
    afficher();
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
  });

  it('prestataires qui ont dit oui à MA demande : lien vers les bulles', () => {
    localStorage.setItem(
      'sia.demande',
      JSON.stringify({
        eventId: '$mademande',
        demande: {
          pseudo: 'palmier-48',
          service: 'Plombier',
          zone: 'Akanda',
          texte: '',
          budget: 5000,
          fin: Date.now() + 60_000,
        },
      }),
    );
    const offre = (roomId: string, annonce: string): ResumeBulle => ({
      roomId,
      autre: { pseudo: 'mangue', zone: 'Owendo' },
      demande: { annonce, service: 'Plombier', zone: 'Akanda', budget: 5000, texte: '' },
      etat: 'invitation-recue',
      nonLus: 0,
      autreEcrit: false,
    });
    vi.mocked(listerBulles).mockReturnValue([
      offre('!a:sia', '$mademande'),
      offre('!b:sia', '$mademande'),
      offre('!c:sia', '$autre'),
    ]);
    afficher();
    fireEvent.click(screen.getByRole('link', { name: /2 prestataires ont dit oui/ }));
    expect(screen.getByText('écran bulles')).toBeInTheDocument();
  });

  describe('retour immédiat au toucher', () => {
    it('SIA passe au vert et dit « Ta demande est partie. » AVANT la réponse du serveur, puis le Mur s’ouvre', async () => {
      const serveur = differe<string>();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      afficher();
      remplir();
      fireEvent.click(boutonSia());

      expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Ta demande est partie.')).toBeInTheDocument();
      expect(screen.queryByText('écran mur')).not.toBeInTheDocument();
      expect(localStorage.getItem('sia.demande')).toBeNull();

      await act(async () => serveur.resoudre('$demande1'));
      expect(await screen.findByText('écran mur')).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem('sia.demande') ?? '{}')).toMatchObject({
        eventId: '$demande1',
      });
    });

    it('pas de double toucher : une seule demande part', async () => {
      const serveur = differe<string>();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      afficher();
      remplir();
      fireEvent.click(boutonSia());
      fireEvent.click(boutonSia());
      await act(async () => undefined); // laisse partir l'envoi
      expect(publierDemande).toHaveBeenCalledTimes(1);
      await act(async () => serveur.resoudre('$demande1'));
    });

    it('le serveur refuse de publier (pas de réseau) : le bouton redevient gris, avec le message', async () => {
      const serveur = differe<string>();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      afficher();
      remplir();
      fireEvent.click(boutonSia());
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');

      await act(async () => serveur.rejeter(coupureReseau()));
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByText('Ta demande est partie.')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Pas de connexion. Réessaie dans un instant.',
      );
      expect(boutonSia()).toBeEnabled();
      expect(screen.queryByText('écran mur')).not.toBeInTheDocument();
    });

    it('demande déjà partie : SIA repasse au gris tout de suite, avant la réponse du serveur', async () => {
      const serveur = differe();
      vi.mocked(retirerDemande).mockReturnValue(serveur.promesse);
      semerDemande();
      afficher();
      fireEvent.click(boutonSia());

      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Ta demande est retirée.')).toBeInTheDocument();
      expect(localStorage.getItem('sia.demande')).not.toBeNull();

      await act(async () => serveur.resoudre());
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Ta demande est retirée.')).toBeInTheDocument();
      expect(localStorage.getItem('sia.demande')).toBeNull();
    });

    it('le serveur refuse de retirer : SIA redevient vert avec un message', async () => {
      const serveur = differe();
      vi.mocked(retirerDemande).mockReturnValue(serveur.promesse);
      semerDemande();
      afficher();
      fireEvent.click(boutonSia());
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');

      await act(async () => serveur.rejeter(coupureReseau()));
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Ta demande est partie.')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(localStorage.getItem('sia.demande')).not.toBeNull();
    });

    it('demande modifiée : la phrase suit tout de suite ; refus du serveur, on retrouve l’état d’avant', async () => {
      const serveur = differe<string>();
      semerDemande();
      afficher();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      fireEvent.change(screen.getByLabelText('Ton budget, en FCFA'), { target: { value: '8000' } });
      expect(screen.getByText('Touche SIA pour envoyer ta nouvelle demande.')).toBeInTheDocument();
      fireEvent.click(boutonSia());

      expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Ta demande est partie.')).toBeInTheDocument();
      expect(
        screen.queryByText('Touche SIA pour envoyer ta nouvelle demande.'),
      ).not.toBeInTheDocument();

      await act(async () => serveur.rejeter(coupureReseau()));
      // L'ancienne demande a bien été retirée avant l'échec : le bouton est gris, on peut renvoyer.
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(boutonSia()).toBeEnabled();
    });

    it('page quittée pendant l’envoi : la confirmation ne ramène pas au Mur', async () => {
      const serveur = differe<string>();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      afficher();
      remplir();
      fireEvent.click(boutonSia());
      fireEvent.click(screen.getByRole('link', { name: 'Bulles' }));
      expect(screen.getByText('écran bulles')).toBeInTheDocument();

      await act(async () => serveur.resoudre('$demande1'));
      expect(screen.getByText('écran bulles')).toBeInTheDocument();
      expect(screen.queryByText('écran mur')).not.toBeInTheDocument();
    });
  });

  it('personne n’a dit oui : pas de lien (seulement le petit accès aux bulles)', () => {
    afficher();
    expect(screen.queryByRole('link', { name: /dit oui/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bulles' })).toBeInTheDocument();
  });
});
