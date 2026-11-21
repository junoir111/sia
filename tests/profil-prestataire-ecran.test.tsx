import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { oublierReponses } from '../src/ecrans/bandeau/reponses';
import { deposerEchec, oublierEchec } from '../src/ecrans/profil-prestataire/echec-mise-en-ligne';
import { ProfilPrestataire } from '../src/ecrans/profil-prestataire/ProfilPrestataire';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { monStatutActif, publierStatut, retirerStatut } from '../src/matrix/mur';
import { enregistrerProfil, lireProfil } from '../src/matrix/profil';
import { lireSession } from '../src/matrix/session';
import { ecrireDisponible, lireDisponible } from '../src/appareil/disponible';
import {
  reglerNotificationDemandes,
  reglerNotificationPrestataires,
} from '../src/matrix/notifications';
import { coupureReseau, differe } from './faux-ecran';

// Jamais le vrai serveur ni le vrai stockage : tout est simulé.
vi.mock('../src/matrix/profil', () => ({
  lireProfil: vi.fn(),
  enregistrerProfil: vi.fn(),
  lirePseudoEnregistre: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../src/matrix/session', () => ({ lireSession: vi.fn() }));
vi.mock('../src/coquille/FournisseurMatrix', () => ({ useMatrix: vi.fn() }));
vi.mock('../src/matrix/mur', () => ({
  monStatutActif: vi.fn(),
  publierStatut: vi.fn(),
  retirerStatut: vi.fn(),
}));
vi.mock('../src/matrix/bulles', () => ({
  ecouterBulles: vi.fn(() => () => undefined),
  listerBulles: vi.fn(() => []),
}));
vi.mock('../src/appareil/disponible', () => ({
  lireDisponible: vi.fn(),
  ecrireDisponible: vi.fn(),
}));
vi.mock('../src/matrix/notifications', () => ({
  reglerNotificationDemandes: vi.fn(async () => undefined),
  reglerNotificationPrestataires: vi.fn(async () => undefined),
}));
vi.mock('../src/appareil/photo', () => ({
  lirePhoto: vi.fn().mockResolvedValue(null),
  preparerPhoto: vi.fn(),
  enregistrerPhoto: vi.fn(),
  effacerPhoto: vi.fn(),
}));

const CLIENT = { simule: true } as never;
const SESSION = {
  userId: '@mangue-douce:sia.tail94dc60.ts.net',
  accessToken: 'jeton-test',
  deviceId: 'APPAREIL',
};

function PageMur() {
  const navigate = useNavigate();
  return (
    <>
      <p>écran mur</p>
      <Link to={CHEMINS.bulles}>Aller aux bulles</Link>
      <button type="button" onClick={() => navigate(-1)}>
        Retour arrière
      </button>
    </>
  );
}

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.profilPrestataire]}>
      <Routes>
        <Route path={CHEMINS.profilPrestataire} element={<ProfilPrestataire />} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
        <Route path={CHEMINS.bulles} element={<p>écran bulles</p>} />
        <Route path={CHEMINS.mur} element={<PageMur />} />
      </Routes>
    </MemoryRouter>,
  );
}

const boutonSia = () => screen.getByRole('button', { name: 'SIA' });

async function attendreChargement() {
  await waitFor(() => expect(screen.getByLabelText('Ton métier')).not.toBeDisabled());
}

function remplir() {
  fireEvent.change(screen.getByLabelText('Ton métier'), { target: { value: 'Plombier' } });
  fireEvent.click(screen.getByRole('button', { name: 'Je me déplace' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Quartier' }), {
    target: { value: 'Akanda' },
  });
  fireEvent.change(screen.getByLabelText('Service 1'), { target: { value: 'Réparer une fuite' } });
  fireEvent.change(screen.getByLabelText('Prix du service 1, en FCFA'), {
    target: { value: '5000' },
  });
}

describe('Écran Profil prestataire (E5)', () => {
  beforeEach(() => {
    oublierReponses();
    oublierEchec();
    vi.mocked(lireSession).mockReturnValue(SESSION);
    vi.mocked(lireProfil).mockReset().mockResolvedValue({ ok: true, profil: null });
    vi.mocked(enregistrerProfil).mockReset();
    vi.mocked(lireDisponible).mockReturnValue(false);
    vi.mocked(ecrireDisponible).mockReset();
    vi.mocked(useMatrix).mockReturnValue({ client: CLIENT, etat: 'pret' });
    vi.mocked(monStatutActif).mockReset().mockReturnValue(null);
    vi.mocked(publierStatut).mockReset().mockResolvedValue('$statut');
    vi.mocked(retirerStatut).mockReset().mockResolvedValue(undefined);
  });

  it('affiche le pseudo proposé et le bouton SIA inactif au départ', async () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'Ton profil' })).toBeInTheDocument();
    expect(screen.getByText('mangue-douce')).toBeInTheDocument();
    await attendreChargement();
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

  it('propose des quartiers et en choisit un au toucher', async () => {
    afficher();
    await attendreChargement();
    const champ = screen.getByRole('combobox', { name: 'Quartier' });
    fireEvent.change(champ, { target: { value: 'ak' } });
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Akanda', 'Akébé', 'Akournam', 'Alénakiri']);
    expect(options[0]?.querySelector('strong')).toHaveTextContent('Ak');
    expect(options[3]?.querySelector('strong')).toHaveTextContent(/^ak$/);
    fireEvent.click(screen.getByRole('option', { name: 'Akébé' }));
    expect(champ).toHaveValue('Akébé');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('SIA touché : on arrive sur le Mur, le profil est enregistré et le statut publié', async () => {
    vi.mocked(enregistrerProfil).mockResolvedValue({ ok: true });
    afficher();
    await attendreChargement();
    remplir();
    expect(boutonSia()).toBeEnabled();
    fireEvent.click(boutonSia());

    expect(await screen.findByText('écran mur')).toBeInTheDocument();
    await waitFor(() => expect(ecrireDisponible).toHaveBeenCalledWith(true));
    expect(enregistrerProfil).toHaveBeenCalledWith(SESSION, {
      version: 1,
      role: 'prestataire',
      pseudo: 'mangue-douce',
      metier: 'Plombier',
      zone: 'Akanda',
      modalite: 'deplace',
      services: [{ label: 'Réparer une fuite', prix: 5000 }],
    });
    const [client, statut] = vi.mocked(publierStatut).mock.calls[0] ?? [];
    expect(client).toBe(CLIENT);
    expect(statut).toMatchObject({
      pseudo: 'mangue-douce',
      metier: 'Plombier',
      zone: 'Akanda',
      modalite: 'deplace',
      services: [{ label: 'Réparer une fuite', prix: 5000 }],
    });
    expect(statut?.fin).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it('SIA touché : prévenu des demandes, et plus des confrères (un client devenu prestataire)', async () => {
    vi.mocked(enregistrerProfil).mockResolvedValue({ ok: true });
    afficher();
    await attendreChargement();
    remplir();
    fireEvent.click(boutonSia());

    await waitFor(() => expect(reglerNotificationDemandes).toHaveBeenCalledWith(CLIENT, true));
    expect(reglerNotificationPrestataires).toHaveBeenCalledWith(CLIENT, false);
  });

  it('déjà visible : un toucher sur SIA éteint, sans quitter la page', async () => {
    vi.mocked(lireProfil).mockResolvedValue({
      ok: true,
      profil: {
        version: 1,
        role: 'prestataire',
        pseudo: 'mangue',
        metier: 'Plombier',
        zone: 'Owendo',
        modalite: 'deplace',
        services: [],
      },
    });
    vi.mocked(monStatutActif).mockReturnValue({
      eventId: '$statut',
      statut: { pseudo: 'mangue', metier: 'Plombier', zone: 'Owendo', fin: Date.now() + 60_000 },
    });
    afficher();
    await screen.findByText('Tu es visible à Owendo.');
    fireEvent.click(boutonSia());
    expect(await screen.findByText("Tu n'es plus visible.")).toBeInTheDocument();
    expect(retirerStatut).toHaveBeenCalledWith(CLIENT);
    expect(ecrireDisponible).toHaveBeenLastCalledWith(false);
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
  });

  it('erreur de saisie : message sous les services, rien n’est envoyé', async () => {
    afficher();
    await attendreChargement();
    remplir();
    fireEvent.change(screen.getByLabelText('Prix du service 1, en FCFA'), {
      target: { value: 'cher' },
    });
    fireEvent.click(boutonSia());
    expect(screen.getByText('Écris un prix en FCFA pour chaque service.')).toBeInTheDocument();
    expect(enregistrerProfil).not.toHaveBeenCalled();
  });

  it('pas de réseau : bandeau qui dit quoi faire', async () => {
    vi.mocked(enregistrerProfil).mockResolvedValue({ ok: false, erreur: 'reseau' });
    afficher();
    await attendreChargement();
    remplir();
    fireEvent.click(boutonSia());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pas de connexion. Réessaie dans un instant.',
    );
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
    expect(ecrireDisponible).not.toHaveBeenCalled();
  });

  it('remplit les champs avec le profil déjà enregistré', async () => {
    vi.mocked(lireDisponible).mockReturnValue(true);
    vi.mocked(lireProfil).mockResolvedValue({
      ok: true,
      profil: {
        version: 1,
        role: 'prestataire',
        pseudo: 'mangue',
        metier: 'Plombier',
        zone: 'Owendo',
        modalite: 'les-deux',
        services: [{ label: 'Réparer une fuite', prix: 10000 }],
      },
    });
    afficher();
    expect(await screen.findByText('Plombier')).toBeInTheDocument();
    expect(screen.getByText('Tu es visible à Owendo.')).toBeInTheDocument();
    expect(screen.getByLabelText('Prix du service 1, en FCFA')).toHaveValue('10 000');
    expect(screen.getByRole('button', { name: 'Je reçois' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('statut encore publié sur le Mur : bouton vert dès l’ouverture', async () => {
    vi.mocked(lireProfil).mockResolvedValue({
      ok: true,
      profil: {
        version: 1,
        role: 'prestataire',
        pseudo: 'mangue',
        metier: 'Plombier',
        zone: 'Owendo',
        modalite: 'deplace',
        services: [{ label: 'Réparer une fuite', prix: 5000 }],
      },
    });
    vi.mocked(monStatutActif).mockReturnValue({
      eventId: '$statut',
      statut: { pseudo: 'mangue', metier: 'Plombier', zone: 'Owendo', fin: Date.now() + 60_000 },
    });
    afficher();
    expect(await screen.findByText('Tu es visible à Owendo.')).toBeInTheDocument();
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
  });

  it('publication du statut impossible (réseau) : bandeau, bouton reste gris', async () => {
    vi.mocked(enregistrerProfil).mockResolvedValue({ ok: true });
    vi.mocked(publierStatut).mockRejectedValue(
      Object.assign(new Error('coupé'), { name: 'ConnectionError' }),
    );
    afficher();
    await attendreChargement();
    remplir();
    fireEvent.click(boutonSia());
    expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
    expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
    expect(ecrireDisponible).not.toHaveBeenCalled();
  });

  describe('retour immédiat au toucher', () => {
    const PROFIL_ENREGISTRE = {
      version: 1 as const,
      role: 'prestataire' as const,
      pseudo: 'mangue',
      metier: 'Plombier',
      zone: 'Owendo',
      modalite: 'deplace' as const,
      services: [],
    };

    it('SIA ouvre le Mur AVANT la réponse du serveur ; la mise en ligne se termine derrière', async () => {
      const serveur = differe<{ ok: true }>();
      vi.mocked(enregistrerProfil).mockReturnValue(serveur.promesse);
      afficher();
      await attendreChargement();
      remplir();
      fireEvent.click(boutonSia());

      // Le serveur n'a rien répondu : le Mur est déjà là, rien n'est encore publié.
      expect(await screen.findByText('écran mur')).toBeInTheDocument();
      expect(publierStatut).not.toHaveBeenCalled();
      expect(ecrireDisponible).not.toHaveBeenCalled();

      await act(async () => serveur.resoudre({ ok: true }));
      await waitFor(() => expect(ecrireDisponible).toHaveBeenCalledWith(true));
      expect(publierStatut).toHaveBeenCalledTimes(1);
      expect(screen.getByText('écran mur')).toBeInTheDocument();
    });

    it('un deuxième SIA touché pendant que le premier part attend son tour : jamais deux mises en ligne à la fois', async () => {
      const premier = differe<{ ok: true }>();
      vi.mocked(enregistrerProfil)
        .mockReturnValueOnce(premier.promesse)
        .mockResolvedValue({ ok: true });
      afficher();
      await attendreChargement();
      remplir();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran mur')).toBeInTheDocument();

      // On rouvre le profil et on retouche SIA alors que le premier envoi n'a pas fini.
      afficher();
      await attendreChargement();
      remplir();
      fireEvent.click(boutonSia());
      await act(async () => undefined);
      expect(enregistrerProfil).toHaveBeenCalledTimes(1);

      await act(async () => premier.resoudre({ ok: true }));
      await waitFor(() => expect(enregistrerProfil).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(publierStatut).toHaveBeenCalledTimes(2));
    });

    it('l’enregistrement est refusé (pas de réseau) : retour au profil avec le message, rien de tapé n’est perdu', async () => {
      const serveur = differe<{ ok: false; erreur: 'reseau' }>();
      vi.mocked(enregistrerProfil).mockReturnValue(serveur.promesse);
      afficher();
      await attendreChargement();
      remplir();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran mur')).toBeInTheDocument();

      await act(async () => serveur.resoudre({ ok: false, erreur: 'reseau' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Pas de connexion. Réessaie dans un instant.',
      );
      expect(screen.queryByText('écran mur')).not.toBeInTheDocument();
      // Le formulaire est rendu tel qu'il était ; SIA est gris et prêt pour un nouvel essai.
      await waitFor(() => expect(boutonSia()).toBeEnabled());
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Plombier')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Quartier' })).toHaveValue('Akanda');
      expect(screen.getByLabelText('Service 1')).toHaveValue('Réparer une fuite');
      expect(publierStatut).not.toHaveBeenCalled();
      expect(ecrireDisponible).not.toHaveBeenCalled();
    });

    it('un refus déposé pendant que la page est ouverte (refus très rapide) : le message et ce qui était tapé sont repris tout de suite', async () => {
      afficher();
      await attendreChargement();
      remplir();
      act(() =>
        deposerEchec({
          message: 'Pas de connexion. Réessaie dans un instant.',
          saisie: {
            pseudo: 'mangue-douce',
            metier: 'Maçon',
            zone: 'Owendo',
            recoit: true,
            deplace: false,
            services: [
              { label: 'Monter un mur', prix: '20 000' },
              { label: '', prix: '' },
            ],
          },
        }),
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Pas de connexion. Réessaie dans un instant.',
      );
      expect(screen.getByText('Maçon')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Quartier' })).toHaveValue('Owendo');
      expect(screen.getByLabelText('Service 1')).toHaveValue('Monter un mur');
      expect(boutonSia()).toBeEnabled();
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
    });

    it('la publication sur le Mur est refusée : retour au profil, puis on peut réessayer', async () => {
      const serveur = differe<string>();
      vi.mocked(enregistrerProfil).mockResolvedValue({ ok: true });
      vi.mocked(publierStatut).mockReturnValueOnce(serveur.promesse);
      afficher();
      await attendreChargement();
      remplir();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran mur')).toBeInTheDocument();
      await waitFor(() => expect(publierStatut).toHaveBeenCalled());

      await act(async () => serveur.rejeter(coupureReseau()));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(ecrireDisponible).not.toHaveBeenCalled();

      await waitFor(() => expect(boutonSia()).toBeEnabled());
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran mur')).toBeInTheDocument();
      await waitFor(() => expect(ecrireDisponible).toHaveBeenCalledWith(true));
    });

    it('déjà visible : SIA repasse au gris tout de suite, avant la réponse du serveur', async () => {
      const serveur = differe();
      vi.mocked(retirerStatut).mockReturnValue(serveur.promesse);
      vi.mocked(lireProfil).mockResolvedValue({ ok: true, profil: PROFIL_ENREGISTRE });
      vi.mocked(monStatutActif).mockReturnValue({
        eventId: '$statut',
        statut: { pseudo: 'mangue', metier: 'Plombier', zone: 'Owendo', fin: Date.now() + 60_000 },
      });
      afficher();
      await screen.findByText('Tu es visible à Owendo.');
      fireEvent.click(boutonSia());

      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText("Tu n'es plus visible.")).toBeInTheDocument();
      expect(ecrireDisponible).not.toHaveBeenCalled();

      await act(async () => serveur.resoudre());
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');
      expect(ecrireDisponible).toHaveBeenLastCalledWith(false);
    });

    it('déjà visible : le serveur refuse d’éteindre, SIA redevient vert avec un message', async () => {
      const serveur = differe();
      vi.mocked(retirerStatut).mockReturnValue(serveur.promesse);
      vi.mocked(lireProfil).mockResolvedValue({ ok: true, profil: PROFIL_ENREGISTRE });
      vi.mocked(monStatutActif).mockReturnValue({
        eventId: '$statut',
        statut: { pseudo: 'mangue', metier: 'Plombier', zone: 'Owendo', fin: Date.now() + 60_000 },
      });
      afficher();
      await screen.findByText('Tu es visible à Owendo.');
      fireEvent.click(boutonSia());
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'false');

      await act(async () => serveur.rejeter(coupureReseau()));
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Tu es visible à Owendo.')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(ecrireDisponible).not.toHaveBeenCalled();
    });

    it('quartier modifié alors qu’on est visible : le Mur s’ouvre tout de suite ; si le serveur refuse, le nouveau quartier attend d’être enregistré', async () => {
      const serveur = differe<{ ok: false; erreur: 'reseau' }>();
      vi.mocked(lireProfil).mockResolvedValue({ ok: true, profil: PROFIL_ENREGISTRE });
      vi.mocked(monStatutActif).mockReturnValue({
        eventId: '$statut',
        statut: { pseudo: 'mangue', metier: 'Plombier', zone: 'Owendo', fin: Date.now() + 60_000 },
      });
      vi.mocked(enregistrerProfil).mockReturnValue(serveur.promesse);
      afficher();
      await screen.findByText('Tu es visible à Owendo.');
      fireEvent.change(screen.getByRole('combobox', { name: 'Quartier' }), {
        target: { value: 'Akanda' },
      });
      expect(screen.getByText('Touche SIA pour enregistrer.')).toBeInTheDocument();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran mur')).toBeInTheDocument();

      await act(async () => serveur.resoudre({ ok: false, erreur: 'reseau' }));
      // Retour au profil : toujours visible à Owendo côté serveur, avec le nouveau quartier à enregistrer.
      expect(await screen.findByText('Touche SIA pour enregistrer.')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Quartier' })).toHaveValue('Akanda');
      expect(boutonSia()).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent('Pas de connexion.');
    });

    it('le refus n’est jamais perdu : même passé aux bulles, on est ramené au profil', async () => {
      const serveur = differe<{ ok: false; erreur: 'reseau' }>();
      vi.mocked(enregistrerProfil).mockReturnValue(serveur.promesse);
      afficher();
      await attendreChargement();
      remplir();
      fireEvent.click(boutonSia());
      fireEvent.click(await screen.findByRole('link', { name: 'Aller aux bulles' }));
      expect(screen.getByText('écran bulles')).toBeInTheDocument();

      await act(async () => serveur.resoudre({ ok: false, erreur: 'reseau' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
      expect(screen.queryByText('écran bulles')).not.toBeInTheDocument();
    });

    it('après un refus, un retour arrière ne ramène pas l’ancien message', async () => {
      vi.mocked(enregistrerProfil)
        .mockResolvedValueOnce({ ok: false, erreur: 'reseau' })
        .mockResolvedValue({ ok: true });
      afficher();
      await attendreChargement();
      remplir();
      fireEvent.click(boutonSia());
      expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
      await waitFor(() => expect(boutonSia()).toBeEnabled());

      // Deuxième essai : ça passe. Un retour arrière rouvre le profil, sans le vieux message.
      fireEvent.click(boutonSia());
      fireEvent.click(await screen.findByRole('button', { name: 'Retour arrière' }));
      expect(await screen.findByRole('heading', { name: 'Ton profil' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('la session a expiré pendant l’envoi : retour à l’accueil', async () => {
      vi.mocked(enregistrerProfil).mockResolvedValue({ ok: false, erreur: 'session' });
      afficher();
      await attendreChargement();
      remplir();
      fireEvent.click(boutonSia());
      expect(await screen.findByText('écran accueil')).toBeInTheDocument();
    });
  });

  it('petit accès aux bulles en haut', async () => {
    afficher();
    await attendreChargement();
    fireEvent.click(screen.getByRole('link', { name: 'Bulles' }));
    expect(screen.getByText('écran bulles')).toBeInTheDocument();
  });
});
