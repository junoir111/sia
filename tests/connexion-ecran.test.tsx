import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHEMINS } from '../src/chemins';
import { cheminApresConnexion } from '../src/coquille/apres-connexion';
import { Connexion } from '../src/ecrans/connexion/Connexion';
import { connecter } from '../src/matrix/auth';
import { enregistrerSession } from '../src/matrix/session';

// Jamais le vrai serveur : connexion, session et suite du parcours sont simulées.
vi.mock('../src/matrix/auth', () => ({ connecter: vi.fn() }));
vi.mock('../src/matrix/session', () => ({ enregistrerSession: vi.fn() }));
vi.mock('../src/coquille/apres-connexion', () => ({ cheminApresConnexion: vi.fn() }));

const SESSION = { userId: '@mangue:sia', accessToken: 'jeton-test', deviceId: 'APPAREIL' };

function afficher() {
  render(
    <MemoryRouter initialEntries={[CHEMINS.connexion]}>
      <Routes>
        <Route path={CHEMINS.connexion} element={<Connexion />} />
        <Route path={CHEMINS.accueil} element={<p>écran accueil</p>} />
        <Route path={CHEMINS.profilClient} element={<p>profil client</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function remplir() {
  fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: ' Mangue ' } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'palmier2026x' } });
}

const bouton = () => screen.getByRole('button', { name: /Entrer|Connexion/ });

describe('Écran Se connecter (E2)', () => {
  beforeEach(() => {
    vi.mocked(connecter).mockReset();
    vi.mocked(enregistrerSession).mockReset();
    vi.mocked(cheminApresConnexion)
      .mockReset()
      .mockResolvedValue({ ok: true, chemin: CHEMINS.profilClient });
  });

  it('titre, deux champs, bouton « Entrer » grisé tant que c’est vide', () => {
    afficher();
    expect(screen.getByRole('heading', { name: 'Se connecter' })).toBeInTheDocument();
    expect(bouton()).toBeDisabled();
    remplir();
    expect(bouton()).toBeEnabled();
  });

  it('succès : identifiant en minuscules, session gardée, page du profil', async () => {
    vi.mocked(connecter).mockResolvedValue({ ok: true, session: SESSION });
    afficher();
    remplir();
    fireEvent.click(bouton());
    expect(await screen.findByText('profil client')).toBeInTheDocument();
    expect(connecter).toHaveBeenCalledWith('mangue', 'palmier2026x');
    expect(enregistrerSession).toHaveBeenCalledWith(SESSION);
    expect(cheminApresConnexion).toHaveBeenCalledWith(SESSION);
  });

  it('mauvais identifiants : message rouge sous le mot de passe', async () => {
    vi.mocked(connecter).mockResolvedValue({ ok: false, erreur: 'identifiants' });
    afficher();
    remplir();
    fireEvent.click(bouton());
    expect(await screen.findByText('Identifiant ou mot de passe incorrect.')).toBeInTheDocument();
    expect(enregistrerSession).not.toHaveBeenCalled();
  });

  it('pas de réseau : bandeau', async () => {
    vi.mocked(connecter).mockResolvedValue({ ok: false, erreur: 'reseau' });
    afficher();
    remplir();
    fireEvent.click(bouton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pas de connexion. Réessaie dans un instant.',
    );
  });

  it('connecté mais profil illisible (réseau) : nouvel essai sans se reconnecter', async () => {
    vi.mocked(connecter).mockResolvedValue({ ok: true, session: SESSION });
    vi.mocked(cheminApresConnexion).mockResolvedValueOnce({ ok: false, erreur: 'reseau' });
    afficher();
    remplir();
    fireEvent.click(bouton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Pas de connexion.');
    fireEvent.click(bouton());
    expect(await screen.findByText('profil client')).toBeInTheDocument();
    expect(connecter).toHaveBeenCalledTimes(1);
  });

  it('la flèche ramène à l’accueil', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByText('écran accueil')).toBeInTheDocument();
  });
});
