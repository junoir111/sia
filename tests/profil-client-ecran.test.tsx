import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { oublierReponses } from '../src/ecrans/bandeau/reponses';
import { oublierChoix, signalerChoix } from '../src/ecrans/bandeau/signal';
import { deposerEchec, oublierEchec } from '../src/ecrans/profil-client/echec-publication';
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
        <Route
          path={CHEMINS.mur}
          element={
            <>
              <p>écran mur</p>
              <Link to={CHEMINS.bulles}>Aller aux bulles</Link>
            </>
          }
        />
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
    oublierReponses();
    oublierEchec();
    oublierChoix();
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
    await waitFor(() => expect(publierDemande).toHaveBeenCalled());
    const [client, demande] = vi.mocked(publierDemande).mock.calls[0] ?? [];
    expect(client).toBe(CLIENT);
    expect(demande).toMatchObject({
      pseudo: 'palmier-48',
      zone: 'Akanda',
      service: 'Plombier',
      budget: 5000,
      texte: "Fuite sous l'évier, ce soir",
    });
    expect(demande?.fin).toBeGreaterThanOrEqual(avant + 23 * 60 * 60_000);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('sia.demande') ?? '{}')).toMatchObject({
        eventId: '$demande1',
      }),
    );
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
    await waitFor(() => expect(publierDemande).toHaveBeenCalled());
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
    await waitFor(() => expect(enregistrerProfilClient).toHaveBeenCalled());
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
    it('SIA ouvre le Mur AVANT la réponse du serveur ; la publication se termine derrière', async () => {
      const serveur = differe<string>();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      afficher();
      remplir();
      fireEvent.click(boutonSia());

      // Le serveur n'a rien répondu : le Mur est déjà là, rien n'est encore gardé.
      expect(await screen.findByText('écran mur')).toBeInTheDocument();
      expect(localStorage.getItem('sia.demande')).toBeNull();

      await act(async () => serveur.resoudre('$demande1'));
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem('sia.demande') ?? '{}')).toMatchObject({
          eventId: '$demande1',
        }),
      );
      expect(screen.getByText('écran mur')).toBeInTheDocument();
    });

    it('un deuxième SIA touché pendant que le premier part attend son tour et retire la première demande', async () => {
      const premiere = differe<string>();
      vi.mocked(publierDemande)
        .mockReturnValueOnce(premiere.promesse)
        .mockResolvedValue('$demande2');
      afficher();
      remplir();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran mur')).toBeInTheDocument();

      // On rouvre la page et on retouche SIA alors que le premier envoi n'a pas fini.
      afficher();
      remplir();
      fireEvent.click(boutonSia());
      await act(async () => undefined);
      expect(publierDemande).toHaveBeenCalledTimes(1);
      expect(retirerDemande).not.toHaveBeenCalled();

      await act(async () => premiere.resoudre('$demande1'));
      await waitFor(() => expect(publierDemande).toHaveBeenCalledTimes(2));
      // La deuxième retire la première avant de publier : jamais deux demandes en même temps.
      expect(retirerDemande).toHaveBeenCalledWith(CLIENT, '$demande1');
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem('sia.demande') ?? '{}')).toMatchObject({
          eventId: '$demande2',
        }),
      );
    });

    it('le serveur refuse de publier (pas de réseau) : retour à la page avec le message, rien de tapé n’est perdu', async () => {
      const serveur = differe<string>();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      afficher();
      remplir();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran mur')).toBeInTheDocument();

      await act(async () => serveur.rejeter(coupureReseau()));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Pas de connexion. Réessaie dans un instant.',
      );
      expect(screen.queryByText('écran mur')).not.toBeInTheDocument();
      // Le formulaire est rendu tel qu'il était ; SIA est gris et prêt pour un nouvel essai.
      expect(screen.getByRole('combobox', { name: 'Quartier' })).toHaveValue('Akanda');
      expect(screen.getByLabelText('De quoi as-tu besoin ?')).toHaveValue('Plombier');
      expect(screen.getByLabelText('Ton budget, en FCFA')).toHaveValue('5000');
      expect(screen.getByLabelText('Précise ton besoin (facultatif)')).toHaveValue(
        "Fuite sous l'évier, ce soir",
      );
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(boutonSia()).toBeEnabled();
      expect(localStorage.getItem('sia.demande')).toBeNull();
    });

    it('après un refus, la copie du serveur n’écrase pas ce qui était tapé', async () => {
      vi.mocked(lireProfilClient).mockResolvedValue({
        ok: true,
        profil: { version: 1, role: 'client', pseudo: 'ibis-3', zone: 'Lalala' },
      });
      vi.mocked(publierDemande).mockRejectedValue(coupureReseau());
      afficher();
      await screen.findByText('ibis-3');
      remplir();
      fireEvent.click(boutonSia());

      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
      // La page rouverte relit le profil sur le serveur : ce qui était tapé doit rester.
      await act(async () => undefined);
      expect(screen.getByRole('combobox', { name: 'Quartier' })).toHaveValue('Akanda');
      expect(screen.getByText('ibis-3')).toBeInTheDocument();
    });

    it('un refus déposé pendant que la page est ouverte (refus très rapide) : le message et ce qui était tapé sont repris tout de suite', () => {
      afficher();
      remplir();
      act(() =>
        deposerEchec({
          message: 'Pas de connexion. Réessaie dans un instant.',
          saisie: {
            pseudo: 'palmier-48',
            zone: 'Owendo',
            service: 'Coiffure',
            budget: '10 000',
            texte: 'Demain matin',
          },
        }),
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Pas de connexion. Réessaie dans un instant.',
      );
      expect(screen.getByRole('combobox', { name: 'Quartier' })).toHaveValue('Owendo');
      expect(screen.getByLabelText('De quoi as-tu besoin ?')).toHaveValue('Coiffure');
      expect(screen.getByLabelText('Ton budget, en FCFA')).toHaveValue('10 000');
      expect(boutonSia()).toBeEnabled();
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
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

    it('demande modifiée : le Mur s’ouvre tout de suite ; refus du serveur, retour à la page avec la nouvelle demande à envoyer', async () => {
      const serveur = differe<string>();
      semerDemande();
      afficher();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      fireEvent.change(screen.getByLabelText('Ton budget, en FCFA'), { target: { value: '8000' } });
      expect(screen.getByText('Touche SIA pour envoyer ta nouvelle demande.')).toBeInTheDocument();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran mur')).toBeInTheDocument();

      await act(async () => serveur.rejeter(coupureReseau()));
      // L'ancienne demande a bien été retirée avant l'échec : le bouton est gris, la nouvelle demande reste à envoyer.
      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(boutonSia()).toBeEnabled();
      expect(screen.getByLabelText('Ton budget, en FCFA')).toHaveValue('8000');
      expect(retirerDemande).toHaveBeenCalledWith(CLIENT, '$demande1');
      expect(localStorage.getItem('sia.demande')).toBeNull();
    });

    it('l’ancienne demande ne peut pas être retirée : retour à la page, elle reste partie, la nouvelle reste à envoyer', async () => {
      vi.mocked(retirerDemande).mockRejectedValue(coupureReseau());
      semerDemande();
      afficher();
      fireEvent.change(screen.getByLabelText('Ton budget, en FCFA'), { target: { value: '8000' } });
      fireEvent.click(boutonSia());

      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(screen.getByText('Touche SIA pour envoyer ta nouvelle demande.')).toBeInTheDocument();
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('Ton budget, en FCFA')).toHaveValue('8000');
      expect(publierDemande).not.toHaveBeenCalled();
      expect(localStorage.getItem('sia.demande')).not.toBeNull();
    });

    it('le refus n’est jamais perdu : même passé aux bulles, on est ramené à la page', async () => {
      const serveur = differe<string>();
      vi.mocked(publierDemande).mockReturnValue(serveur.promesse);
      afficher();
      remplir();
      fireEvent.click(boutonSia());
      fireEvent.click(await screen.findByRole('link', { name: 'Aller aux bulles' }));
      expect(screen.getByText('écran bulles')).toBeInTheDocument();

      await act(async () => serveur.rejeter(coupureReseau()));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(screen.queryByText('écran bulles')).not.toBeInTheDocument();
    });

    it('la session a expiré pendant l’envoi : retour à l’accueil', async () => {
      vi.mocked(enregistrerProfilClient).mockResolvedValue({ ok: false, erreur: 'session' });
      afficher();
      remplir();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran accueil')).toBeInTheDocument();
    });
  });

  it('personne n’a dit oui : pas de lien (seulement le petit accès aux bulles)', () => {
    afficher();
    expect(screen.queryByRole('link', { name: /dit oui/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bulles' })).toBeInTheDocument();
  });
});
