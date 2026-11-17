import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate, useParams } from 'react-router-dom';
import { CHEMINS, cheminBulle } from '../src/chemins';
import { cheminApresConnexion } from '../src/coquille/apres-connexion';
import { useMatrix } from '../src/coquille/FournisseurMatrix';
import { AppSia } from '../src/navigation';

const faux = vi.hoisted(() => ({
  client: { nom: 'faux-client' },
  demarrerClient: vi.fn(),
  arreterClient: vi.fn(),
  rejoindreMur: vi.fn(),
  nettoyerMesAnnonces: vi.fn(),
  lireProfil: vi.fn(),
  lireProfilClient: vi.fn(),
}));

vi.mock('../src/matrix/client', async (original) => ({
  ...(await original<typeof import('../src/matrix/client')>()),
  demarrerClient: faux.demarrerClient,
  arreterClient: faux.arreterClient,
  clientActif: () => null,
}));
vi.mock('../src/matrix/mur', async (original) => ({
  ...(await original<typeof import('../src/matrix/mur')>()),
  rejoindreMur: faux.rejoindreMur,
  nettoyerMesAnnonces: faux.nettoyerMesAnnonces,
}));
vi.mock('../src/matrix/profil', () => ({
  lireProfil: faux.lireProfil,
  lireProfilClient: faux.lireProfilClient,
}));

// Écrans remplacés par des doublures : ici on ne teste que la navigation et la coquille.
vi.mock('../src/ecrans/bandeau/Bandeau', () => ({ Bandeau: () => <p>bandeau</p> }));
vi.mock('../src/ecrans/bulles/Bulles', () => ({
  Bulles: function Bulles() {
    const { etat } = useMatrix();
    return <p>bulles {etat}</p>;
  },
}));
vi.mock('../src/ecrans/bulle/Bulle', () => ({
  Bulle: function Bulle() {
    return <p>bulle {useParams().roomId}</p>;
  },
}));
vi.mock('../src/ecrans/connexion/Connexion', () => ({
  Connexion: function Connexion() {
    const navigate = useNavigate();
    const entrer = () => {
      localStorage.setItem('sia.session', JSON.stringify(SESSION));
      navigate(CHEMINS.bulles);
    };
    return <button onClick={entrer}>Entrer</button>;
  },
}));

const SESSION = { userId: '@puma:sia.tail94dc60.ts.net', accessToken: 'jeton', deviceId: 'APP' };

function connecte() {
  localStorage.setItem('sia.session', JSON.stringify(SESSION));
}

function afficher(adresse: string) {
  return render(
    <MemoryRouter initialEntries={[adresse]}>
      <AppSia />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  faux.demarrerClient.mockResolvedValue(faux.client);
  faux.rejoindreMur.mockResolvedValue('!mur:sia');
  faux.nettoyerMesAnnonces.mockResolvedValue(undefined);
});
afterEach(() => localStorage.clear());

describe('Gardes', () => {
  it.each([CHEMINS.bulles, cheminBulle('!a:sia'), CHEMINS.profilClient, CHEMINS.profilPrestataire])(
    '%s sans session → accueil, aucun client démarré',
    (chemin) => {
      afficher(chemin);
      expect(screen.getByRole('heading', { name: 'SIA' })).toBeInTheDocument();
      expect(faux.demarrerClient).not.toHaveBeenCalled();
    },
  );

  it("/bulle/:roomId donne l'identifiant décodé à l'écran Bulle", async () => {
    connecte();
    afficher(cheminBulle('!abc:sia.tail94dc60.ts.net'));
    expect(await screen.findByText('bulle !abc:sia.tail94dc60.ts.net')).toBeInTheDocument();
  });
});

describe('FournisseurMatrix', () => {
  it('session présente → client démarré une fois, Mur rejoint, bandeau affiché', async () => {
    connecte();
    afficher(CHEMINS.bulles);
    expect(screen.getByText('bulles demarrage')).toBeInTheDocument();
    expect(screen.queryByText('bandeau')).not.toBeInTheDocument();

    expect(await screen.findByText('bulles pret')).toBeInTheDocument();
    expect(screen.getByText('bandeau')).toBeInTheDocument();
    expect(faux.demarrerClient).toHaveBeenCalledTimes(1);
    expect(faux.demarrerClient).toHaveBeenCalledWith(SESSION);
    expect(faux.rejoindreMur).toHaveBeenCalledWith(faux.client);
    expect(faux.nettoyerMesAnnonces).toHaveBeenCalledWith(faux.client);
  });

  it('connexion réussie (E2) → le client démarre sans recharger la page', async () => {
    afficher(CHEMINS.connexion);
    expect(faux.demarrerClient).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Entrer' }));
    expect(await screen.findByText('bulles pret')).toBeInTheDocument();
    expect(faux.demarrerClient).toHaveBeenCalledTimes(1);
  });

  it("jeton refusé → session effacée, retour à l'accueil, pas de bandeau", async () => {
    connecte();
    faux.demarrerClient.mockRejectedValue({ errcode: 'M_UNKNOWN_TOKEN' });
    afficher(CHEMINS.bulles);
    expect(await screen.findByRole('heading', { name: 'SIA' })).toBeInTheDocument();
    expect(localStorage.getItem('sia.session')).toBeNull();
    expect(screen.queryByText('bandeau')).not.toBeInTheDocument();
  });

  it('pas de réseau → état erreur-reseau, la session est gardée', async () => {
    connecte();
    faux.rejoindreMur.mockRejectedValue(new TypeError('Failed to fetch'));
    afficher(CHEMINS.bulles);
    expect(await screen.findByText('bulles erreur-reseau')).toBeInTheDocument();
    expect(localStorage.getItem('sia.session')).not.toBeNull();
    expect(screen.queryByText('bandeau')).not.toBeInTheDocument();
  });

  it("un ménage d'annonces raté n'empêche pas l'appli d'être prête", async () => {
    connecte();
    faux.nettoyerMesAnnonces.mockRejectedValue(new TypeError('Failed to fetch'));
    afficher(CHEMINS.bulles);
    expect(await screen.findByText('bulles pret')).toBeInTheDocument();
  });

  it('démontage → client arrêté', async () => {
    connecte();
    const { unmount } = afficher(CHEMINS.bulles);
    await screen.findByText('bulles pret');
    act(() => unmount());
    expect(faux.arreterClient).toHaveBeenCalled();
  });
});

describe('cheminApresConnexion', () => {
  it('profil prestataire → E5', async () => {
    faux.lireProfil.mockResolvedValue({ ok: true, profil: { role: 'prestataire' } });
    expect(await cheminApresConnexion(SESSION)).toEqual({
      ok: true,
      chemin: CHEMINS.profilPrestataire,
    });
  });

  it('profil client → E6', async () => {
    faux.lireProfil.mockResolvedValue({ ok: true, profil: null });
    faux.lireProfilClient.mockResolvedValue({ ok: true, profil: { role: 'client' } });
    expect(await cheminApresConnexion(SESSION)).toEqual({ ok: true, chemin: CHEMINS.profilClient });
  });

  it('pas de profil → E4 (choix du rôle)', async () => {
    faux.lireProfil.mockResolvedValue({ ok: true, profil: null });
    faux.lireProfilClient.mockResolvedValue({ ok: true, profil: null });
    expect(await cheminApresConnexion(SESSION)).toEqual({ ok: true, chemin: CHEMINS.role });
  });

  it("erreur du serveur → rendue telle quelle (l'écran reste sur E2)", async () => {
    faux.lireProfil.mockResolvedValue({ ok: false, erreur: 'reseau' });
    expect(await cheminApresConnexion(SESSION)).toEqual({ ok: false, erreur: 'reseau' });
    expect(faux.lireProfilClient).not.toHaveBeenCalled();
  });
});
